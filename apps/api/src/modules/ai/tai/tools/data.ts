/**
 * Инструменты чтения: выручка, ритм, товары, гости, чеки, склад, мероприятия.
 * Данные — из тех же маршрутов, что экраны аналитики (права и модули клуба
 * проверяются там), блоки интерфейса — из этих же данных.
 */
import { and, eq, gt, inventory, isNull, profiles, sql } from '@titan/database'
import { permissionOn } from '../../../../lib/permissions.js'
import { quantityText } from '../../../inventory/ledger.js'
import type { TaiBlock, TaiPoint, TaiRow } from '../blocks.js'
import { addDays, checksWord, dayLabel, daysBetween, isDateKey, methodLabel, METHOD_COLORS, mskTime, num, periodLabel, rub, TIER_LABELS } from '../format.js'
import { PERIOD_PARAMS, type ToolContext, type ToolDef } from './types.js'

type Period = { from: string; to: string }

/** Период из аргументов модели: проверенные даты, from ≤ to, не длиннее ~13 месяцев. */
function period(args: Record<string, unknown>, ctx: ToolContext): Period {
  let from = isDateKey(args['from']) ? args['from'] : ctx.dates.today
  let to = isDateKey(args['to']) ? args['to'] : from
  if (from > to) [from, to] = [to, from]
  if (to > ctx.dates.today) to = ctx.dates.today
  if (from > to) from = to
  if (daysBetween(from, to) > 400) from = addDays(to, -399)
  return { from, to }
}

const q = (p: Period) => `from=${p.from}&to=${p.to}`

type NetBreakdown = { revenueNet: number; checks: number; avgCheck: number; eventRevenue: number; eventChecks: number; net?: number; cogs?: number; expenses?: number; commission?: number }
type Overview = {
  current: NetBreakdown & { margin?: number | null }
  previous: NetBreakdown
  deltas: { revenue: number; checks: number; profit?: number }
  paymentBreakdown: { method: string; total: string | number }[]
}

const salesOverview: ToolDef = {
  name: 'sales_overview',
  description: 'Итоги периода: выручка, чеки, средний чек, прибыль (владельцу), способы оплаты, мероприятия и изменение к прошлому такому же периоду. Показывает карточку с показателями.',
  parameters: { type: 'object', properties: PERIOD_PARAMS, required: ['from', 'to'] },
  status: () => 'Считаю выручку…',
  run: async (args, ctx) => {
    const p = period(args, ctx)
    const o = await ctx.api.get<Overview>(`/api/analytics/overview?${q(p)}`)
    const cur = o.current
    const payments = o.paymentBreakdown.map((b) => ({ method: b.method, total: num(b.total) })).filter((b) => b.total > 0).sort((a, b) => b.total - a.total)
    const paidTotal = payments.reduce((s, b) => s + b.total, 0)
    const blocks: TaiBlock[] = [
      {
        type: 'metrics',
        title: periodLabel(p.from, p.to),
        items: [
          { label: 'Выручка', value: rub(cur.revenueNet), delta: o.deltas.revenue },
          { label: 'Чеки', value: String(cur.checks), delta: o.deltas.checks },
          { label: 'Средний чек', value: rub(Math.round(cur.avgCheck)) },
          ...(cur.net !== undefined ? [{ label: cur.net >= 0 ? 'Прибыль' : 'Убыток', value: rub(cur.net), delta: o.deltas.profit }] : []),
        ],
        link: { label: 'Открыть аналитику', to: { screen: 'analytics', from: p.from, to: p.to } },
      },
    ]
    if (payments.length > 1) {
      blocks.push({
        type: 'breakdown',
        title: 'Способы оплаты',
        total: rub(paidTotal),
        parts: payments.map((b) => ({
          key: b.method,
          label: methodLabel(b.method),
          value: b.total,
          share: paidTotal > 0 ? Math.round((b.total / paidTotal) * 100) : 0,
          color: METHOD_COLORS[b.method],
          to: { screen: 'analytics-checks', from: p.from, to: p.to, method: b.method },
        })),
      })
    }
    return {
      blocks,
      memo: `итоги ${periodLabel(p.from, p.to)}: выручка ${rub(cur.revenueNet)}, ${checksWord(cur.checks)}`,
      data: {
        period: p,
        revenue: Math.round(cur.revenueNet),
        checks: cur.checks,
        avgCheck: Math.round(cur.avgCheck),
        ...(cur.net !== undefined ? { profit: Math.round(cur.net), margin: cur.margin, cogs: cur.cogs, expenses: cur.expenses, acquiring: cur.commission } : {}),
        events: { checks: cur.eventChecks, revenue: Math.round(cur.eventRevenue) },
        previousPeriod: { revenue: Math.round(o.previous.revenueNet), checks: o.previous.checks, avgCheck: Math.round(o.previous.avgCheck) },
        changePercent: o.deltas,
        payments: Object.fromEntries(payments.map((b) => [methodLabel(b.method), Math.round(b.total)])),
      },
    }
  },
}

type Revenue = { revenue: { date: string; revenue: number; count: number }[] }

const salesByDay: ToolDef = {
  name: 'sales_by_day',
  description: 'Выручка и число чеков по дням периода — график по дням с лучшим днём. Для динамики и сравнения дней.',
  parameters: { type: 'object', properties: PERIOD_PARAMS, required: ['from', 'to'] },
  status: () => 'Строю динамику по дням…',
  run: async (args, ctx) => {
    const p = period(args, ctx)
    const r = await ctx.api.get<Revenue>(`/api/analytics/revenue?${q(p)}`)
    const byDate = new Map(r.revenue.map((d) => [d.date, d]))
    const days = Array.from({ length: Math.min(daysBetween(p.from, p.to), 92) }, (_, i) => addDays(p.from, i))
    const points: TaiPoint[] = days.map((date) => {
      const day = byDate.get(date)
      const revenue = Math.max(0, Math.round(num(day?.revenue)))
      const count = day?.count ?? 0
      return {
        key: date,
        label: dayLabel(date),
        value: revenue,
        detail: `${dayLabel(date, true)} · ${rub(revenue)} · ${checksWord(count)}`,
        to: { screen: 'analytics-checks', from: date, to: date },
        toLabel: `Чеки за ${dayLabel(date)}`,
      }
    })
    const best = points.reduce((max, point) => (point.value > max.value ? point : max), points[0] ?? { key: '', label: '', value: 0 })
    const active = points.filter((point) => point.value > 0)
    const avg = active.length ? Math.round(active.reduce((s, point) => s + point.value, 0) / points.length) : 0
    return {
      blocks: [{ type: 'chart', title: `Выручка по дням · ${periodLabel(p.from, p.to)}`, unit: 'money', points, caption: best.value > 0 ? `Лучший день — ${best.label}: ${rub(best.value)}. В среднем ${rub(avg)} в день.` : undefined }],
      memo: `выручка по дням ${periodLabel(p.from, p.to)}, лучший ${best.label}`,
      data: { period: p, days: points.map((point) => ({ date: point.key, revenue: point.value, checks: byDate.get(point.key)?.count ?? 0 })), bestDay: best.key, averagePerDay: avg },
    }
  },
}

type Insights = {
  structure: { bar: number; games: number; rental: number; events: number; discounts: number; total: number }
  hours: { hour: number; checks: number; revenue: number }[]
  weekdays: { dow: number; days: number; checks: number; revenue: number; avgRevenue: number }[]
  guests: { unique: number; new: number; returning: number; anonymousChecks: number }
}
const WEEKDAY_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

const clubRhythm: ToolDef = {
  name: 'club_rhythm',
  description: 'Когда клуб зарабатывает: выручка по часам (время открытия чека) и средняя выручка по дням недели. Для «часы пик», «какой день лучший».',
  parameters: { type: 'object', properties: { ...PERIOD_PARAMS, view: { type: 'string', enum: ['hours', 'weekdays'], description: 'hours — по часам, weekdays — по дням недели' } }, required: ['from', 'to'] },
  status: () => 'Смотрю ритм клуба…',
  run: async (args, ctx) => {
    const p = period(args, ctx)
    const ins = await ctx.api.get<Insights>(`/api/analytics/insights?${q(p)}`)
    const view = args['view'] === 'weekdays' ? 'weekdays' : 'hours'
    const order = Array.from({ length: 24 }, (_, i) => (ctx.dates.startHour + i) % 24)
    const withData = order.filter((h) => ins.hours.some((x) => x.hour === h && x.checks > 0))
    const first = withData.length ? order.indexOf(withData[0]!) : 0
    const last = withData.length ? order.indexOf(withData[withData.length - 1]!) : -1
    const hours = order.slice(first, last + 1).map((h) => ins.hours.find((x) => x.hour === h) ?? { hour: h, checks: 0, revenue: 0 })
    const hh = (h: number) => `${String(h).padStart(2, '0')}:00`
    const blocks: TaiBlock[] =
      view === 'hours'
        ? [{
            type: 'chart',
            title: `По часам · ${periodLabel(p.from, p.to)}`,
            unit: 'money',
            points: hours.map((h) => ({
              key: String(h.hour),
              label: String(h.hour).padStart(2, '0'),
              value: Math.round(h.revenue),
              detail: `${hh(h.hour)}–${hh((h.hour + 1) % 24)} · ${rub(h.revenue)} · ${checksWord(h.checks)}`,
              to: { screen: 'analytics-checks', from: p.from, to: p.to, hour: h.hour },
              toLabel: `Чеки с ${hh(h.hour)}`,
            })),
          }]
        : [{
            type: 'chart',
            title: `Дни недели · в среднем за день`,
            unit: 'money',
            points: ins.weekdays.map((d) => ({ key: String(d.dow), label: WEEKDAY_SHORT[d.dow - 1] ?? String(d.dow), value: Math.round(d.avgRevenue), detail: `${WEEKDAY_SHORT[d.dow - 1]} · в среднем ${rub(d.avgRevenue)} · дней в периоде ${d.days}` })),
          }]
    const peak = hours.reduce((max, h) => (h.revenue > max.revenue ? h : max), hours[0] ?? { hour: 0, checks: 0, revenue: 0 })
    return {
      blocks,
      memo: `ритм ${periodLabel(p.from, p.to)} (${view === 'hours' ? 'по часам' : 'по дням недели'})`,
      data: {
        period: p,
        hours: hours.filter((h) => h.checks > 0).map((h) => ({ hour: h.hour, revenue: Math.round(h.revenue), checks: h.checks })),
        peakHour: peak.hour,
        weekdays: ins.weekdays.map((d) => ({ day: WEEKDAY_SHORT[d.dow - 1], avgRevenue: Math.round(d.avgRevenue), days: d.days })),
      },
    }
  },
}

const STRUCTURE = [
  { key: 'bar', label: 'Бар и меню', color: '#FF9500' },
  { key: 'games', label: 'Игры (тарифы)', color: '#8B5CF6' },
  { key: 'rental', label: 'Аренда зон', color: '#30B0C7' },
  { key: 'events', label: 'Мероприятия', color: '#FF2D55' },
] as const

const revenueStructure: ToolDef = {
  name: 'revenue_structure',
  description: 'Из чего сложилась выручка: бар, игры (тарифы), аренда зон, мероприятия, скидки; плюс гости периода (уникальные, новые, вернувшиеся).',
  parameters: { type: 'object', properties: PERIOD_PARAMS, required: ['from', 'to'] },
  status: () => 'Разбираю структуру выручки…',
  run: async (args, ctx) => {
    const p = period(args, ctx)
    const ins = await ctx.api.get<Insights>(`/api/analytics/insights?${q(p)}`)
    const parts = STRUCTURE.map((s) => ({ ...s, value: Math.round(ins.structure[s.key]) })).filter((s) => s.value > 0)
    const gross = parts.reduce((s, part) => s + part.value, 0)
    return {
      blocks: gross > 0
        ? [{
            type: 'breakdown',
            title: `Структура выручки · ${periodLabel(p.from, p.to)}`,
            total: rub(gross),
            parts: parts.map((part) => ({ key: part.key, label: part.label, value: part.value, share: Math.round((part.value / gross) * 100), color: part.color, to: part.key === 'bar' ? { screen: 'analytics-products', from: p.from, to: p.to } : undefined })),
          }]
        : [],
      memo: `структура выручки ${periodLabel(p.from, p.to)}`,
      data: { period: p, structure: Object.fromEntries(parts.map((part) => [part.label, part.value])), discounts: Math.round(ins.structure.discounts), guests: ins.guests },
    }
  },
}

type ProductRow = { itemId: string; name: string | null; category: string | null; totalQty: string | number; totalRev: string | number; share: number; abc: string }

const topProducts: ToolDef = {
  name: 'top_products',
  description: 'Лучшие позиции бара и меню за период: количество, выручка, доля, ABC-класс.',
  parameters: { type: 'object', properties: { ...PERIOD_PARAMS, limit: { type: 'integer', description: 'Сколько позиций, по умолчанию 10' } }, required: ['from', 'to'] },
  status: () => 'Смотрю продажи бара…',
  run: async (args, ctx) => {
    const p = period(args, ctx)
    const limit = Math.min(Math.max(num(args['limit']) || 10, 3), 25)
    const r = await ctx.api.get<{ products: ProductRow[]; totalRev: number }>(`/api/analytics/products?${q(p)}`)
    const rows = r.products.slice(0, limit)
    return {
      blocks: [{
        type: 'list',
        title: `Топ позиций · ${periodLabel(p.from, p.to)}`,
        rows: rows.map((row, i) => ({ id: row.itemId, title: `${i + 1}. ${row.name ?? 'Позиция'}`, subtitle: `${num(row.totalQty)} шт · ${row.share}% выручки бара`, value: rub(row.totalRev) })),
        more: { label: 'Все позиции и ABC', to: { screen: 'analytics-products', from: p.from, to: p.to } },
        empty: 'Продаж за период нет',
      }],
      memo: `топ позиций ${periodLabel(p.from, p.to)}: ${rows.slice(0, 3).map((row) => row.name).join(', ')}`,
      data: { period: p, totalRevenue: Math.round(num(r.totalRev)), items: rows.map((row) => ({ name: row.name, category: row.category, qty: num(row.totalQty), revenue: Math.round(num(row.totalRev)), share: row.share, abc: row.abc })) },
    }
  },
}

type Clients = {
  total: number
  newThisPeriod: number
  retentionRate: number
  segments: { new: number; active: number; sleeping: number }
  topSpenders: { playerId: string; nickname: string | null; clientTier: string | null; photoUrl: string | null; total: number; visits: number }[]
}

const playersStats: ToolDef = {
  name: 'players_stats',
  description: 'Игроки за период: сколько всего, новых, удержание, сегменты и топ гостей по тратам.',
  parameters: { type: 'object', properties: PERIOD_PARAMS, required: ['from', 'to'] },
  status: () => 'Смотрю гостей…',
  run: async (args, ctx) => {
    const p = period(args, ctx)
    const r = await ctx.api.get<Clients>(`/api/analytics/clients?${q(p)}`)
    const top = r.topSpenders.slice(0, 8)
    return {
      blocks: [
        { type: 'metrics', items: [{ label: 'Новых', value: String(r.newThisPeriod) }, { label: 'Активных', value: String(r.segments.active) }, { label: 'Спящих', value: String(r.segments.sleeping), invert: true }, { label: 'Удержание', value: `${r.retentionRate}%` }] },
        {
          type: 'list',
          title: `Топ гостей · ${periodLabel(p.from, p.to)}`,
          rows: top.map((s) => ({ id: s.playerId, title: s.nickname ?? 'Гость', subtitle: `${s.visits} визит. · ${TIER_LABELS[s.clientTier ?? ''] ?? 'без статуса'}`, value: rub(s.total), avatar: { name: s.nickname ?? '?', url: s.photoUrl }, to: { screen: 'player', playerId: s.playerId } })),
          more: { label: 'Игроки и сегменты', to: { screen: 'analytics-players', from: p.from, to: p.to } },
          empty: 'Гостей с чеками нет',
        },
      ],
      memo: `игроки ${periodLabel(p.from, p.to)}`,
      data: { period: p, totalClients: r.total, new: r.newThisPeriod, retentionRate: r.retentionRate, segments: r.segments, top: top.map((s) => ({ nickname: s.nickname, total: Math.round(s.total), visits: s.visits })) },
    }
  },
}

type AnalyticsCheck = { id: string; createdAt: string; totalAmount: number; guestName: string | null; playerPhoto: string | null; staffNickname: string | null; payments: { method: string; amount: number }[]; itemCount: number; hasRental: boolean }

const checksList: ToolDef = {
  name: 'checks_list',
  description: 'Закрытые чеки за период: время, гость, сумма, способы оплаты. Можно отфильтровать по способу оплаты (cash, card — перевод, transfer — СБП, deposit, bonus, debt, certificate) или по гостю.',
  parameters: {
    type: 'object',
    properties: { ...PERIOD_PARAMS, method: { type: 'string', description: 'Способ оплаты' }, guest: { type: 'string', description: 'Часть имени гостя' } },
    required: ['from', 'to'],
  },
  status: () => 'Собираю чеки…',
  run: async (args, ctx) => {
    const p = period(args, ctx)
    const r = await ctx.api.get<{ checks: AnalyticsCheck[] }>(`/api/analytics/checks?${q(p)}`)
    const method = typeof args['method'] === 'string' ? args['method'] : null
    const guest = typeof args['guest'] === 'string' ? args['guest'].toLowerCase() : null
    const list = r.checks.filter((c) => (!method || c.payments.some((x) => x.method === method)) && (!guest || (c.guestName ?? '').toLowerCase().includes(guest)))
    const total = list.reduce((s, c) => s + num(c.totalAmount), 0)
    const rows: TaiRow[] = list.slice(0, 40).map((c) => ({
      id: c.id,
      title: c.guestName ?? 'Гость',
      subtitle: `${p.from === p.to ? '' : `${dayLabel(c.createdAt.slice(0, 10))}, `}${mskTime(c.createdAt)} · ${c.payments.map((x) => methodLabel(x.method)).join(' + ') || '—'}`,
      value: rub(c.totalAmount),
      avatar: { name: c.guestName ?? '?', url: c.playerPhoto },
      to: { screen: 'analytics-check', checkId: c.id },
    }))
    return {
      blocks: [{
        type: 'list',
        title: `${checksWord(list.length)} · ${rub(total)}${method ? ` · ${methodLabel(method)}` : ''}`,
        rows,
        more: list.length > rows.length ? { label: `Все ${checksWord(list.length)}`, to: { screen: 'analytics-checks', from: p.from, to: p.to, ...(method ? { method } : {}) } } : undefined,
        empty: 'Чеков за период нет',
      }],
      memo: `чеки ${periodLabel(p.from, p.to)}: ${list.length}`,
      data: { period: p, count: list.length, total: Math.round(total), checks: list.slice(0, 25).map((c) => ({ time: mskTime(c.createdAt), guest: c.guestName, total: Math.round(num(c.totalAmount)), payments: c.payments.map((x) => methodLabel(x.method)), staff: c.staffNickname })) },
    }
  },
}

type PlayerCard = {
  profile: { id: string; nickname: string; fullName: string | null; clientTier: string; balance: string | number; bonusPoints: string | number }
  allTime: { spend: number; visitDays: number; avgCheck: number; lastVisit: string | null; daysSinceLast: number | null; visitsPerMonth: number }
  last30: { spend: number; checksCount: number }
  recentChecks: { id: string; createdAt: string; totalAmount: string | number }[]
}

const clientCard: ToolDef = {
  name: 'client_card',
  description: 'Карточка гостя по playerId (из find_clients): траты, визиты, средний чек, баланс (депозит или долг), бонусы, последние чеки.',
  parameters: { type: 'object', properties: { playerId: { type: 'string' } }, required: ['playerId'] },
  status: () => 'Открываю карточку гостя…',
  run: async (args, ctx) => {
    const id = String(args['playerId'] ?? '')
    const r = await ctx.api.get<PlayerCard>(`/api/analytics/players/${encodeURIComponent(id)}`)
    const balance = num(r.profile.balance)
    return {
      blocks: [
        {
          type: 'metrics',
          title: r.profile.nickname,
          items: [
            { label: 'Всего потратил', value: rub(r.allTime.spend) },
            { label: 'Визитов', value: String(r.allTime.visitDays), hint: `${r.allTime.visitsPerMonth}/мес` },
            { label: 'Средний чек', value: rub(Math.round(r.allTime.avgCheck)) },
            { label: balance < 0 ? 'Долг' : 'Депозит', value: rub(Math.abs(balance)), invert: balance < 0 },
          ],
          link: { label: 'Карточка гостя', to: { screen: 'player', playerId: r.profile.id } },
        },
        {
          type: 'list',
          title: 'Последние чеки',
          rows: r.recentChecks.slice(0, 5).map((c) => ({ id: c.id, title: dayLabel(c.createdAt.slice(0, 10), true), subtitle: mskTime(c.createdAt), value: rub(c.totalAmount), to: { screen: 'analytics-check', checkId: c.id } })),
          empty: 'Чеков ещё не было',
        },
      ],
      memo: `карточка гостя ${r.profile.nickname} (playerId ${r.profile.id})`,
      data: {
        playerId: r.profile.id,
        nickname: r.profile.nickname,
        fullName: r.profile.fullName,
        tier: TIER_LABELS[r.profile.clientTier] ?? r.profile.clientTier,
        balance,
        bonusPoints: num(r.profile.bonusPoints),
        allTime: r.allTime,
        last30Days: r.last30,
      },
    }
  },
}

const stockStatus: ToolDef = {
  name: 'stock_status',
  description: 'Склад: что закончилось и что заканчивается (остаток ниже точки заказа).',
  parameters: { type: 'object', properties: {} },
  status: () => 'Проверяю склад…',
  run: async (_args, ctx) => {
    if (!ctx.isOwner && !permissionOn(ctx.permissions, 'inventory')) return { data: { error: 'Склад скрыт для этого сотрудника' } }
    const rows = await ctx.db
      .select({ id: inventory.id, name: inventory.name, stock: inventory.stockQuantity, unit: inventory.unit, threshold: sql<number>`coalesce(${inventory.reorderPoint}, ${inventory.minThreshold}, 0)` })
      .from(inventory)
      .where(and(eq(inventory.trackStock, true), isNull(inventory.deletedAt), sql`${inventory.stockQuantity} <= coalesce(${inventory.reorderPoint}, ${inventory.minThreshold}, 0)`))
      .orderBy(inventory.stockQuantity)
      .limit(40)
    const out = rows.filter((r) => num(r.stock) <= 0)
    const low = rows.filter((r) => num(r.stock) > 0)
    const qty = (value: unknown, unit: string | null) => quantityText(num(value), unit === 'g' || unit === 'ml' ? unit : 'pcs')
    return {
      blocks: [{
        type: 'list',
        title: out.length || low.length ? `Закончилось ${out.length} · заканчивается ${low.length}` : 'Склад в порядке',
        rows: [...out, ...low].map((r) => ({ id: r.id, title: r.name, subtitle: num(r.stock) <= 0 ? 'закончилось' : `точка заказа ${qty(r.threshold, r.unit)}`, value: qty(r.stock, r.unit) })),
        more: { label: 'Открыть склад', to: { screen: 'inventory' } },
        empty: 'Всё в наличии',
      }],
      memo: `склад: закончилось ${out.length}, заканчивается ${low.length}`,
      data: { outOfStock: out.map((r) => r.name), low: low.map((r) => ({ name: r.name, stock: qty(r.stock, r.unit), reorderPoint: qty(r.threshold, r.unit) })) },
    }
  },
}

const debtors: ToolDef = {
  name: 'debtors',
  description: 'Должники клуба (отрицательный баланс) и общая сумма долга; депозиты клиентов.',
  parameters: { type: 'object', properties: {} },
  status: () => 'Смотрю долги…',
  run: async (_args, ctx) => {
    if (!ctx.isOwner && !permissionOn(ctx.permissions, 'debtors')) return { data: { error: 'Долги и депозиты скрыты для этого сотрудника' } }
    const rows = await ctx.db
      .select({ id: profiles.id, nickname: profiles.nickname, balance: profiles.balance, photo: sql<string | null>`coalesce(${profiles.photoUrl}, ${profiles.tgPhotoUrl}, ${profiles.gomafiaPhotoUrl})` })
      .from(profiles)
      .where(and(isNull(profiles.deletedAt), sql`${profiles.balance}::numeric < 0`))
      .orderBy(sql`${profiles.balance}::numeric asc`)
      .limit(60)
    const [dep] = await ctx.db
      .select({ total: sql<string>`coalesce(sum(${profiles.balance}::numeric), 0)` })
      .from(profiles)
      .where(and(isNull(profiles.deletedAt), gt(sql`${profiles.balance}::numeric`, 0)))
    const total = rows.reduce((s, r) => s + Math.abs(num(r.balance)), 0)
    return {
      blocks: [{
        type: 'list',
        title: `Должников ${rows.length} · ${rub(total)}`,
        rows: rows.slice(0, 25).map((r) => ({ id: r.id, title: r.nickname, value: rub(Math.abs(num(r.balance))), avatar: { name: r.nickname, url: r.photo }, to: { screen: 'player', playerId: r.id } })),
        empty: 'Долгов нет',
      }],
      memo: `долги: ${rows.length} должников на ${rub(total)}`,
      data: { debtorsCount: rows.length, totalDebt: Math.round(total), deposits: Math.round(num(dep?.total)), top: rows.slice(0, 15).map((r) => ({ nickname: r.nickname, debt: Math.abs(num(r.balance)) })) },
    }
  },
}

type EventRow = { id: string; title: string | null; type: string; date: string; startTime: string; endTime: string | null; status: string; location: string | null; customerName: string | null }

const upcomingEvents: ToolDef = {
  name: 'upcoming_events',
  description: 'Ближайшие мероприятия на 30 дней: дата, время, формат, заказчик.',
  parameters: { type: 'object', properties: {} },
  status: () => 'Смотрю мероприятия…',
  run: async (_args, ctx) => {
    const r = await ctx.api.get<{ events: EventRow[] }>(`/api/events?from=${ctx.dates.today}&to=${addDays(ctx.dates.today, 30)}`)
    const list = r.events.filter((e) => e.status === 'planned' || e.status === 'active').sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime)).slice(0, 12)
    return {
      blocks: [{
        type: 'list',
        title: 'Ближайшие мероприятия',
        rows: list.map((e) => ({ id: e.id, title: e.title || e.customerName || 'Мероприятие', subtitle: `${dayLabel(e.date, true)}, ${e.startTime}${e.endTime ? `–${e.endTime}` : ''}${e.location ? ` · ${e.location}` : ''}`, to: { screen: 'events' } })),
        empty: 'В ближайший месяц мероприятий нет',
      }],
      memo: `мероприятия: ${list.length} ближайших`,
      data: { events: list.map((e) => ({ title: e.title, date: e.date, time: e.startTime, type: e.type, customer: e.customerName, status: e.status })) },
    }
  },
}

export const DATA_TOOLS: ToolDef[] = [salesOverview, salesByDay, clubRhythm, revenueStructure, topProducts, playersStats, checksList, clientCard, stockStatus, debtors, upcomingEvents]
