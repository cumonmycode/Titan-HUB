/**
 * Инструменты кассы: смена, открытые чеки, поиск гостей и позиций и подготовка
 * действий. Сами действия здесь не выполняются — propose_* проверяет данные,
 * собирает карточку и сохраняет план (actions.ts); выполнит его нажатие сотрудника.
 */
import { searchVariants } from '../../../../lib/searchVariants.js'
import { registerAction, type PlanItem } from '../actions.js'
import type { TaiBlock } from '../blocks.js'
import { mskTime, normalize, num, rub, TIER_LABELS } from '../format.js'
import { cached, type ToolContext, type ToolDef, type ToolResult } from './types.js'

/* ─────────────────────────── Справочники ─────────────────────────── */

type MenuItem = { id: string; name: string; price: string | number; category: string | null; trackStock: boolean; stockQuantity: number; searchTags: string[] | null }
type Tariff = { id: string; name: string; key: string | null; price: string | number; isActive: boolean; itemId: string | null }
type Space = { id: string; name: string; hourlyRate: string | number; isActive: boolean }
type Player = { id: string; nickname: string; role?: string; clientTier: string; balance: string | number; bonusPoints: string | number; photoUrl: string | null }

const menu = (ctx: ToolContext) => cached(ctx, 'menu', () => ctx.api.get<{ items: MenuItem[] }>('/api/menu/items').then((r) => r.items))
const tariffs = (ctx: ToolContext) => cached(ctx, 'tariffs', () => ctx.api.get<{ tariffs: Tariff[] }>('/api/pricing/tariffs').then((r) => r.tariffs.filter((t) => t.isActive !== false)))
const spaces = (ctx: ToolContext) => cached(ctx, 'spaces', () => ctx.api.get<{ spaces: Space[] }>('/api/pos/spaces').then((r) => r.spaces))

/**
 * Фонетический ключ для сопоставления «кола» ↔ «Coca-Cola»: всё в латиницу, c→k,
 * без дефисов и повторов. Вместе с вариантами раскладки/транслита покрывает и
 * опечатки, и названия латиницей.
 */
const LAT: Record<string, string> = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'zh', з: 'z', и: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sh', ъ: '', ы: 'i', ь: '', э: 'e', ю: 'u', я: 'ya' }
function phonetic(value: string): string {
  return normalize(value)
    .split('')
    .map((ch) => LAT[ch] ?? ch)
    .join('')
    .replace(/ph/g, 'f')
    .replace(/c/g, 'k')
    .replace(/w/g, 'v')
    .replace(/y/g, 'i')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/(.)\1+/g, '$1')
}

function matchScore(name: string, tags: string[] | null, query: string): number {
  const n = normalize(name)
  const q = normalize(query)
  if (!q) return 0
  if (n === q) return 100
  if (n.startsWith(q)) return 80
  if (n.includes(q)) return 70
  const words = q.split(' ').filter(Boolean)
  if (words.length > 1 && words.every((w) => n.includes(w))) return 65
  if (searchVariants(q).some((v) => v !== q && n.includes(v))) return 55
  const pn = phonetic(name)
  const pq = phonetic(query)
  if (pq.length >= 3 && pn.includes(pq)) return 50
  if ((tags ?? []).some((t) => normalize(t).includes(q))) return 45
  return 0
}

/** Лучший кандидат по названию — для тарифа или зоны, заданных словами. */
function pickByName<T extends { name: string }>(list: T[], query: string): T | null {
  const scored = list.map((x) => ({ x, s: matchScore(x.name, null, query) })).filter((r) => r.s > 0).sort((a, b) => b.s - a.s)
  return scored[0]?.x ?? null
}

/* ─────────────────────────── Чтение ─────────────────────────── */

type ShiftSummary = { shift: { id: string; openedAt: string } | null; openChecks?: { count: number; total: number }; cashInRegister?: number; forecast?: { amount: number } | null }

const shiftStatus: ToolDef = {
  name: 'shift_status',
  description: 'Текущая смена: открыта ли, сколько открытых чеков и на какую сумму, сколько наличных в кассе, прогноз выручки вечера.',
  parameters: { type: 'object', properties: {} },
  status: () => 'Смотрю смену…',
  run: async (_args, ctx) => {
    const s = await ctx.api.get<ShiftSummary>('/api/pos/shift-summary')
    if (!s.shift) {
      return { data: { shift: null }, blocks: [{ type: 'links', links: [{ label: 'Открыть смену', to: { screen: 'shift' } }] }], memo: 'смена закрыта' }
    }
    return {
      blocks: [{
        type: 'metrics',
        title: `Смена с ${mskTime(s.shift.openedAt)}`,
        items: [
          { label: 'Открытых чеков', value: String(s.openChecks?.count ?? 0) },
          { label: 'На сумму', value: rub(s.openChecks?.total ?? 0) },
          { label: 'В кассе', value: rub(s.cashInRegister ?? 0) },
          ...(s.forecast ? [{ label: 'Прогноз вечера', value: rub(s.forecast.amount) }] : []),
        ],
        link: { label: 'Касса', to: { screen: 'pos' } },
      }],
      memo: `смена открыта с ${mskTime(s.shift.openedAt)}, открытых чеков ${s.openChecks?.count ?? 0}`,
      data: { shiftOpenedAt: mskTime(s.shift.openedAt), openChecks: s.openChecks, cashInRegister: s.cashInRegister, forecast: s.forecast?.amount ?? null },
    }
  },
}

type OpenCheck = { id: string; guestName: string | null; guestPhotoUrl: string | null; totalAmount: string | number; items: string[]; itemCount: number; spaceName: string | null; createdAt: string }

const openChecks: ToolDef = {
  name: 'open_checks',
  description: 'Открытые чеки текущей смены: checkId, гость, сумма, позиции. Нужен, чтобы найти чек гостя по имени.',
  parameters: { type: 'object', properties: {} },
  status: () => 'Смотрю открытые чеки…',
  run: async (_args, ctx) => {
    const r = await ctx.api.get<{ checks: OpenCheck[] }>('/api/pos/checks')
    return {
      blocks: [{
        type: 'list',
        title: `Открытые чеки · ${r.checks.length}`,
        rows: r.checks.map((c) => ({ id: c.id, title: c.guestName ?? 'Гость', subtitle: [c.spaceName, c.items.slice(0, 3).join(', ')].filter(Boolean).join(' · ') || 'пустой', value: rub(c.totalAmount), avatar: { name: c.guestName ?? '?', url: c.guestPhotoUrl }, to: { screen: 'check', checkId: c.id } })),
        empty: 'Открытых чеков нет',
      }],
      memo: `открытые чеки: ${r.checks.map((c) => `${c.guestName ?? 'Гость'} (checkId ${c.id})`).join(', ') || 'нет'}`,
      data: { checks: r.checks.map((c) => ({ checkId: c.id, guest: c.guestName ?? 'Гость', total: num(c.totalAmount), items: c.items, space: c.spaceName, openedAt: mskTime(c.createdAt) })) },
    }
  },
}

type CheckDetail = {
  id: string
  status: string
  totalAmount: string | number
  guestName: string | null
  items: { checkItem: { id: string; itemId: string; quantity: number; priceAtTime: string | number }; item: { name: string } | null }[]
  discounts: { name: string; amount: string | number }[]
}

async function loadCheck(ctx: ToolContext, checkId: string): Promise<CheckDetail> {
  return cached(ctx, `check:${checkId}`, () => ctx.api.get<{ check: CheckDetail }>(`/api/pos/checks/${encodeURIComponent(checkId)}`).then((r) => r.check))
}

const checkIdArg = (args: Record<string, unknown>, ctx: ToolContext): string | null => {
  const id = typeof args['checkId'] === 'string' && args['checkId'] ? args['checkId'] : ctx.screenCheckId
  return id && /^[0-9a-f-]{36}$/i.test(id) ? id : null
}

const checkDetails: ToolDef = {
  name: 'check_details',
  description: 'Позиции открытого чека (checkItemId, название, количество, цена), скидки и сумма. Без checkId — чек на экране.',
  parameters: { type: 'object', properties: { checkId: { type: 'string' } } },
  status: () => 'Открываю чек…',
  run: async (args, ctx) => {
    const id = checkIdArg(args, ctx)
    if (!id) return { data: { error: 'Не указан чек. Найди его через open_checks.' } }
    const c = await loadCheck(ctx, id)
    return {
      blocks: [{
        type: 'list',
        title: `${c.guestName ?? 'Гость'} · ${rub(c.totalAmount)}`,
        rows: c.items.map((i) => ({ id: i.checkItem.id, title: i.item?.name ?? 'Позиция', subtitle: `${i.checkItem.quantity} × ${rub(i.checkItem.priceAtTime)}`, value: rub(num(i.checkItem.priceAtTime) * i.checkItem.quantity) })),
        more: { label: 'Открыть чек', to: { screen: 'check', checkId: c.id } },
        empty: 'В чеке пока пусто',
      }],
      memo: `чек ${c.guestName ?? 'Гость'} (checkId ${c.id})`,
      data: {
        checkId: c.id,
        status: c.status,
        guest: c.guestName,
        total: num(c.totalAmount),
        items: c.items.map((i) => ({ checkItemId: i.checkItem.id, itemId: i.checkItem.itemId, name: i.item?.name, quantity: i.checkItem.quantity, price: num(i.checkItem.priceAtTime) })),
        discounts: c.discounts.map((d) => ({ name: d.name, amount: num(d.amount) })),
      },
    }
  },
}

const findClients: ToolDef = {
  name: 'find_clients',
  description: 'Найти гостя (клиента) по имени, нику или телефону. Возвращает playerId, ник, статус, баланс.',
  parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  status: (args) => `Ищу «${String(args['query'] ?? '').slice(0, 30)}»…`,
  run: async (args, ctx) => {
    const query = String(args['query'] ?? '').trim()
    if (!query) return { data: { players: [] } }
    const r = await ctx.api.get<{ players: Player[] }>(`/api/pos/players/search?q=${encodeURIComponent(query)}`)
    return {
      data: {
        players: r.players.slice(0, 6).map((p) => ({ playerId: p.id, nickname: p.nickname, tier: TIER_LABELS[p.clientTier] ?? p.clientTier, balance: num(p.balance), bonus: num(p.bonusPoints) })),
      },
    }
  },
}

const findMenuItems: ToolDef = {
  name: 'find_menu_items',
  description: 'Найти позиции меню по названию (одно-два ключевых слова: «кола», «пиво», «чипсы»). Возвращает itemId, название, цену, остаток. Ничего не нашлось — попробуй синоним или латиницу.',
  parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  status: (args) => `Ищу в меню «${String(args['query'] ?? '').slice(0, 30)}»…`,
  run: async (args, ctx) => {
    const query = String(args['query'] ?? '')
    const items = await menu(ctx)
    const found = items
      .map((item) => ({ item, score: matchScore(item.name, item.searchTags, query) }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
    return {
      data: {
        items: found.map(({ item }) => ({ itemId: item.id, name: item.name, price: num(item.price), category: item.category, stock: item.trackStock ? item.stockQuantity : null })),
      },
    }
  },
}

/* ─────────────────────────── Действия ─────────────────────────── */

const ITEMS_PARAM = {
  type: 'array',
  description: 'Позиции из find_menu_items',
  items: { type: 'object', properties: { itemId: { type: 'string' }, quantity: { type: 'integer' } }, required: ['itemId', 'quantity'] },
}

/** Позиции от модели → проверенные позиции меню с ценой. Неизвестный itemId — ошибка. */
async function resolveItems(raw: unknown, ctx: ToolContext): Promise<{ items: (PlanItem & { price: number; stockNote?: string })[] } | { error: string }> {
  const list = Array.isArray(raw) ? raw : []
  const byId = new Map((await menu(ctx)).map((item) => [item.id, item]))
  const out: (PlanItem & { price: number; stockNote?: string })[] = []
  for (const entry of list) {
    const id = String((entry as { itemId?: unknown }).itemId ?? '')
    const quantity = Math.round(num((entry as { quantity?: unknown }).quantity) || 1)
    const item = byId.get(id)
    if (!item) return { error: `Позиции ${id} нет в меню — найди её через find_menu_items` }
    if (quantity < 1 || quantity > 50) return { error: `Количество «${item.name}» должно быть от 1 до 50` }
    const stockNote = item.trackStock && item.stockQuantity < quantity ? `на складе ${Math.max(0, item.stockQuantity)}` : undefined
    out.push({ itemId: item.id, quantity, name: item.name, price: num(item.price), stockNote })
  }
  return { items: out }
}

const itemRows = (items: { name: string; quantity: number; price: number; stockNote?: string }[]) =>
  items.map((i) => ({ label: `${i.name}${i.quantity > 1 ? ` × ${i.quantity}` : ''}${i.stockNote ? ` · ${i.stockNote}` : ''}`, value: rub(i.price * i.quantity) }))

function card(block: Awaited<ReturnType<typeof registerAction>>, memo: string, data: unknown): ToolResult {
  const blocks: TaiBlock[] = [{ type: 'action', action: block }]
  return { blocks, memo, data: { ...(data as object), shown: 'Карточка показана, ждём подтверждения пользователя' }, terminal: true }
}

const proposeOpenCheck: ToolDef = {
  name: 'propose_open_check',
  description:
    'Подготовить открытие чека (пользователь подтвердит карточкой). Гость: playerId из find_clients или guestName для гостя без карточки. ' +
    'tariff: "auto" — тариф по статусу гостя (по умолчанию), "none" — без тарифа, либо название тарифа. space — название зоны для аренды (необязательно). items — позиции сразу в чек.',
  parameters: {
    type: 'object',
    properties: {
      playerId: { type: 'string' },
      guestName: { type: 'string' },
      tariff: { type: 'string' },
      space: { type: 'string' },
      items: ITEMS_PARAM,
    },
  },
  status: () => 'Готовлю чек…',
  run: async (args, ctx) => {
    const summary = await ctx.api.get<ShiftSummary>('/api/pos/shift-summary')
    if (!summary.shift) return { data: { error: 'Смена не открыта — чек открыть нельзя' }, blocks: [{ type: 'links', links: [{ label: 'Открыть смену', to: { screen: 'shift' } }] }] }

    let player: Player | null = null
    if (typeof args['playerId'] === 'string' && args['playerId']) {
      player = await ctx.api.get<{ player: Player }>(`/api/pos/players/${encodeURIComponent(args['playerId'])}`).then((r) => r.player).catch(() => null)
      if (!player) return { data: { error: 'Гость с таким playerId не найден — поищи через find_clients' } }
    }
    const guestName = player ? undefined : String(args['guestName'] ?? '').trim().slice(0, 60) || 'Гость'

    // Тариф как в кассе: по статусу гостя; гость без карточки — тариф «Гость».
    const tier = player?.clientTier ?? 'guest'
    // Чек сотрудника — без игрового тарифа (он работает, а не играет), как и в кассе.
    const isTeam = player?.role === 'staff' || player?.role === 'owner'
    const tariffArg = isTeam && args['tariff'] === 'auto' ? 'none' : typeof args['tariff'] === 'string' ? args['tariff'].trim() : isTeam ? 'none' : 'auto'
    const allTariffs = await tariffs(ctx)
    let tariff: Tariff | null = null
    if (tariffArg && tariffArg !== 'none') {
      if (tariffArg === 'auto') {
        tariff = allTariffs.find((t) => t.key === tier) ?? (tier !== 'newbie' ? allTariffs.find((t) => normalize(t.name) === normalize(TIER_LABELS[tier] ?? '')) ?? null : null)
      } else {
        tariff = pickByName(allTariffs, tariffArg)
        if (!tariff) return { data: { error: `Тариф «${tariffArg}» не найден`, tariffs: allTariffs.map((t) => t.name) } }
      }
    }

    let space: Space | null = null
    if (typeof args['space'] === 'string' && args['space'].trim()) {
      const active = (await spaces(ctx)).filter((s) => s.isActive)
      space = pickByName(active, args['space'])
      if (!space) return { data: { error: `Зона «${args['space']}» не найдена`, spaces: active.map((s) => s.name) } }
    }

    const resolved = await resolveItems(args['items'], ctx)
    if ('error' in resolved) return { data: resolved }

    const tariffItem = tariff?.itemId ? { itemId: tariff.itemId, quantity: 1, name: `Тариф «${tariff.name}»`, price: num(tariff.price) } : null
    const all = [...(tariffItem ? [tariffItem] : []), ...resolved.items]
    const total = all.reduce((s, i) => s + i.price * i.quantity, 0)
    const guestLabel = player ? `${player.nickname} · ${TIER_LABELS[player.clientTier] ?? player.clientTier}` : guestName!
    const action = await registerAction(
      ctx.clubKey,
      ctx.userSub,
      { kind: 'open_check', playerId: player?.id, guestName, spaceId: space?.id, items: all.map(({ itemId, quantity, name }) => ({ itemId, quantity, name })) },
      {
        kind: 'open_check',
        title: 'Открыть чек',
        rows: [
          { label: 'Гость', value: guestLabel },
          { label: 'Тариф', value: tariff ? `${tariff.name} · ${rub(tariff.price)}` : 'без тарифа' },
          ...(space ? [{ label: 'Аренда', value: `${space.name} · ${rub(space.hourlyRate)}/ч` }] : []),
          ...itemRows(resolved.items),
        ],
        total: rub(total),
        confirmLabel: 'Открыть чек',
      },
    )
    return card(action, `подготовил карточку «Открыть чек» на ${player?.nickname ?? guestName}`, { guest: guestLabel, tariff: tariff?.name ?? null, total })
  },
}

async function openCheckOrError(args: Record<string, unknown>, ctx: ToolContext): Promise<CheckDetail | { error: string }> {
  const id = checkIdArg(args, ctx)
  if (!id) return { error: 'Не указан чек. Найди его через open_checks.' }
  const check = await loadCheck(ctx, id).catch(() => null)
  if (!check) return { error: 'Чек не найден' }
  if (check.status !== 'open') return { error: 'Чек уже закрыт или отменён' }
  return check
}

const proposeAddItems: ToolDef = {
  name: 'propose_add_items',
  description: 'Подготовить добавление позиций в открытый чек (пользователь подтвердит). Без checkId — чек на экране.',
  parameters: { type: 'object', properties: { checkId: { type: 'string' }, items: ITEMS_PARAM }, required: ['items'] },
  status: () => 'Готовлю позиции…',
  run: async (args, ctx) => {
    const check = await openCheckOrError(args, ctx)
    if ('error' in check) return { data: check }
    const resolved = await resolveItems(args['items'], ctx)
    if ('error' in resolved) return { data: resolved }
    if (!resolved.items.length) return { data: { error: 'Нет позиций для добавления' } }
    const sum = resolved.items.reduce((s, i) => s + i.price * i.quantity, 0)
    const action = await registerAction(
      ctx.clubKey,
      ctx.userSub,
      { kind: 'add_items', checkId: check.id, items: resolved.items.map(({ itemId, quantity, name }) => ({ itemId, quantity, name })) },
      {
        kind: 'add_items',
        title: `Добавить в чек · ${check.guestName ?? 'Гость'}`,
        rows: itemRows(resolved.items),
        total: `+${rub(sum)} → ${rub(num(check.totalAmount) + sum)}`,
        confirmLabel: 'Добавить',
      },
    )
    return card(action, `подготовил добавление в чек ${check.guestName ?? 'Гость'}`, { sum })
  },
}

const proposeChangeItem: ToolDef = {
  name: 'propose_change_item',
  description: 'Подготовить изменение количества позиции в открытом чеке или её удаление (quantity 0). Позицию указывай checkItemId из check_details или названием.',
  parameters: { type: 'object', properties: { checkId: { type: 'string' }, checkItemId: { type: 'string' }, itemName: { type: 'string' }, quantity: { type: 'integer' } }, required: ['quantity'] },
  status: () => 'Готовлю изменение…',
  run: async (args, ctx) => {
    const check = await openCheckOrError(args, ctx)
    if ('error' in check) return { data: check }
    const byId = typeof args['checkItemId'] === 'string' ? check.items.find((i) => i.checkItem.id === args['checkItemId']) : undefined
    const byName = !byId && typeof args['itemName'] === 'string' ? check.items.map((i) => ({ i, s: matchScore(i.item?.name ?? '', null, String(args['itemName'])) })).filter((r) => r.s > 0).sort((a, b) => b.s - a.s)[0]?.i : undefined
    const line = byId ?? byName
    if (!line) return { data: { error: 'Такой позиции в чеке нет', items: check.items.map((i) => ({ checkItemId: i.checkItem.id, name: i.item?.name, quantity: i.checkItem.quantity })) } }
    const quantity = Math.max(0, Math.min(50, Math.round(num(args['quantity']))))
    const name = line.item?.name ?? 'Позиция'
    if (quantity === line.checkItem.quantity) return { data: { error: `В чеке уже ${quantity}` } }
    const action = await registerAction(
      ctx.clubKey,
      ctx.userSub,
      { kind: 'change_item', checkId: check.id, checkItemId: line.checkItem.id, quantity, name },
      {
        kind: 'change_item',
        title: quantity === 0 ? `Убрать из чека · ${check.guestName ?? 'Гость'}` : `Изменить позицию · ${check.guestName ?? 'Гость'}`,
        rows: [{ label: name, value: quantity === 0 ? `${line.checkItem.quantity} → убрать` : `${line.checkItem.quantity} → ${quantity}` }],
        confirmLabel: quantity === 0 ? 'Убрать' : 'Изменить',
        destructive: quantity === 0,
      },
    )
    return card(action, `подготовил изменение «${name}» в чеке ${check.guestName ?? 'Гость'}`, { name, quantity })
  },
}

const proposeDiscount: ToolDef = {
  name: 'propose_discount',
  description: 'Подготовить скидку на весь открытый чек: type percent (процент) или fixed (рубли). Лимит скидки сотрудника проверит касса.',
  parameters: { type: 'object', properties: { checkId: { type: 'string' }, type: { type: 'string', enum: ['percent', 'fixed'] }, value: { type: 'number' } }, required: ['type', 'value'] },
  status: () => 'Готовлю скидку…',
  run: async (args, ctx) => {
    const check = await openCheckOrError(args, ctx)
    if ('error' in check) return { data: check }
    const type = args['type'] === 'fixed' ? 'fixed' : 'percent'
    const value = num(args['value'])
    if (value <= 0 || (type === 'percent' && value > 100)) return { data: { error: 'Скидка должна быть больше нуля и не больше 100%' } }
    const total = num(check.totalAmount)
    const amount = type === 'percent' ? Math.round((total * value) / 100) : Math.min(value, total)
    const action = await registerAction(
      ctx.clubKey,
      ctx.userSub,
      { kind: 'discount', checkId: check.id, type, value },
      {
        kind: 'discount',
        title: `Скидка · ${check.guestName ?? 'Гость'}`,
        rows: [
          { label: 'Сумма чека', value: rub(total) },
          { label: type === 'percent' ? `Скидка ${value}%` : 'Скидка', value: `−${rub(amount)}` },
        ],
        total: rub(total - amount),
        confirmLabel: 'Применить',
      },
    )
    return card(action, `подготовил скидку для чека ${check.guestName ?? 'Гость'}`, { amount })
  },
}

const proposeCancelCheck: ToolDef = {
  name: 'propose_cancel_check',
  description: 'Подготовить отмену открытого чека (позиции вернутся на склад). Только по явной просьбе.',
  parameters: { type: 'object', properties: { checkId: { type: 'string' } } },
  status: () => 'Готовлю отмену…',
  run: async (args, ctx) => {
    const check = await openCheckOrError(args, ctx)
    if ('error' in check) return { data: check }
    const action = await registerAction(
      ctx.clubKey,
      ctx.userSub,
      { kind: 'cancel_check', checkId: check.id },
      {
        kind: 'cancel_check',
        title: `Отменить чек · ${check.guestName ?? 'Гость'}`,
        rows: [
          { label: 'Позиций', value: String(check.items.length) },
          { label: 'Сумма', value: rub(check.totalAmount) },
        ],
        confirmLabel: 'Отменить чек',
        destructive: true,
      },
    )
    return card(action, `подготовил отмену чека ${check.guestName ?? 'Гость'}`, {})
  },
}

export const POS_TOOLS: ToolDef[] = [shiftStatus, openChecks, checkDetails, findClients, findMenuItems, proposeOpenCheck, proposeAddItems, proposeChangeItem, proposeDiscount, proposeCancelCheck]
