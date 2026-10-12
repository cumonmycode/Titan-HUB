/**
 * Поставка со слов: «кола 24, сахар 2 кило по 90, сигареты 3 пачки» → черновик
 * прихода в HUB (те же /api/supplies/draft и /apply, что у экрана «Приход»).
 *
 * Названия сопоставляются со складом здесь (раскладка, транслит, похожие слова);
 * сомнительные строки помечаются, и к ним даются варианты. Черновик правится
 * карточкой (HUB) или кнопками (Telegram) и проводится нажатием «Принять».
 */
import { inventory, supplies, supplyItems, eq, isNull, desc, type Database } from '@titan/database'
import { getSharedRedis } from '../../../lib/redis.js'
import { searchVariants } from '../../../lib/searchVariants.js'
import type { TaiSupplyCard, TaiSupplyLine } from './blocks.js'
import type { ApiCaller } from './internal.js'

const META_TTL_SEC = 24 * 3600
const ALTERNATIVES = 5
const CONFIDENT = 1.6
const UNIT_TEXT: Record<string, string> = { pcs: 'шт', g: 'г', ml: 'мл' }

export interface DraftLine {
  itemId?: string
  name?: string
  unit: string
  quantity: number
  costPerUnit: number
  packs?: number
}
interface LineMeta { said?: string; uncertain?: boolean; alternatives?: { itemId: string; name: string }[] }
interface Draft { status: string; supplier: string | null; fromRegister: boolean; paymentMethod?: 'cash' | 'card' | 'transfer'; items: DraftLine[] }

type Stock = { id: string; name: string; unit: 'pcs' | 'g' | 'ml'; packName: string | null; packSize: number | null; costPrice: string | null; searchTags: string[] | null }

/** Что сказал человек об одной строке (модель разбирает фразу на строки). */
export interface SpokenLine {
  name: string
  /** Сколько: штук, упаковок, килограммов… — в единицах unit. */
  count: number
  /** pcs — штуки, pack — упаковки (пачки, блоки, коробки), kg, g, l, ml. */
  unit?: 'pcs' | 'pack' | 'kg' | 'g' | 'l' | 'ml'
  /** Цена за названную единицу (за штуку, за пачку, за кило). */
  price?: number
  /** Сумма за всю строку. */
  total?: number
  /** Если модель уже знает карточку (повторная правка). */
  itemId?: string
}

const metaKey = (clubKey: string, id: string) => `tai:supply:${clubKey}:${id}`
const round2 = (n: number) => Math.round(n * 100) / 100
const round4 = (n: number) => Math.round(n * 10_000) / 10_000
const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/g, ' ').trim()

function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 3
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)])
  for (let j = 1; j <= b.length; j += 1) dp[0]![j] = j
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
  }
  return dp[a.length]![b.length]!
}

/** Похожесть названия со склада на сказанное: 0 — ничего общего, ≥ 1.6 — уверенно. */
function score(query: string, item: Stock): number {
  const q = norm(query)
  const words = norm([item.name, ...(item.searchTags ?? [])].join(' ')).split(' ').filter(Boolean)
  const tokens = q.split(' ').filter((t) => t.length > 1 || /\d/.test(t))
  if (!tokens.length || !words.length) return 0
  let total = 0
  for (const token of tokens) {
    const variants = [token, ...searchVariants(token).map(norm)]
    let best = 0
    for (const v of variants) {
      for (const w of words) {
        if (w === v) best = Math.max(best, 3)
        else if (v.length >= 3 && w.startsWith(v)) best = Math.max(best, 2.2)
        else if (v.length >= 4 && (w.includes(v) || v.includes(w))) best = Math.max(best, 1.6)
        else if (v.length >= 4 && editDistance(v, w) <= 1) best = Math.max(best, 1.4)
      }
    }
    total += /^\d/.test(token) ? best * 0.5 : best
  }
  return total / tokens.length + (norm(item.name).includes(q) ? 0.6 : 0)
}

async function loadStock(db: Database): Promise<Stock[]> {
  return db.select({
    id: inventory.id, name: inventory.name, unit: inventory.unit, packName: inventory.packName,
    packSize: inventory.packSize, costPrice: inventory.costPrice, searchTags: inventory.searchTags,
  }).from(inventory).where(isNull(inventory.deletedAt))
}

function match(stock: Stock[], name: string): { item: Stock | null; meta: LineMeta } {
  const ranked = stock.map((item) => ({ item, s: score(name, item) })).filter((r) => r.s > 0.6).sort((a, b) => b.s - a.s)
  const best = ranked[0]
  const second = ranked[1]
  const alternatives = ranked.slice(0, ALTERNATIVES).map((r) => ({ itemId: r.item.id, name: r.item.name }))
  if (!best) return { item: null, meta: { said: name, uncertain: true, alternatives } }
  const uncertain = best.s < CONFIDENT || (!!second && second.s >= best.s - 0.25)
  return { item: best.item, meta: { said: name, uncertain, alternatives: uncertain ? alternatives : undefined } }
}

async function lastPrice(db: Database, itemId: string): Promise<number | null> {
  const [row] = await db.select({ cost: supplyItems.costPerUnit }).from(supplyItems)
    .innerJoin(supplies, eq(supplies.id, supplyItems.supplyId))
    .where(eq(supplyItems.itemId, itemId)).orderBy(desc(supplies.createdAt)).limit(1)
  return row ? Number(row.cost) : null
}

/** Строка черновика из сказанного: единицы → базовая единица, цена → за единицу. */
async function lineOf(db: Database, spoken: SpokenLine, item: Stock | null): Promise<DraftLine> {
  const count = Math.max(Number(spoken.count) || 0, 0)
  const unit = spoken.unit ?? 'pcs'
  if (!item) {
    const lineTotal = spoken.total ?? (spoken.price ?? 0) * count
    return { name: spoken.name.trim(), unit: 'шт', quantity: count, costPerUnit: count > 0 ? round4(lineTotal / count) : 0 }
  }
  let quantity = count
  let packs: number | undefined
  if (unit === 'pack' && item.packSize) {
    packs = count
    quantity = count * item.packSize
  } else if ((unit === 'kg' && item.unit === 'g') || (unit === 'l' && item.unit === 'ml')) {
    quantity = count * 1000
  }
  quantity = Math.max(Math.round(quantity), 0)
  const lineTotal = spoken.total ?? (spoken.price !== undefined ? spoken.price * count : null)
  const costPerUnit = lineTotal !== null && quantity > 0
    ? lineTotal / quantity
    : (await lastPrice(db, item.id)) ?? (Number(item.costPrice) || 0)
  return { itemId: item.id, name: item.name, unit: UNIT_TEXT[item.unit] ?? 'шт', quantity, costPerUnit: round4(costPerUnit), ...(packs ? { packs } : {}) }
}

async function readDraft(db: Database, id: string): Promise<Draft | null> {
  const [row] = await db.select().from(supplies).where(eq(supplies.id, id)).limit(1)
  if (!row) return null
  if (row.status !== 'draft') {
    const items = await db.select().from(supplyItems).where(eq(supplyItems.supplyId, id))
    return {
      status: row.status, supplier: row.supplier, fromRegister: !!row.cashOperationId,
      items: items.map((i) => ({ itemId: i.itemId ?? undefined, name: i.name ?? undefined, unit: i.unit, quantity: Number(i.quantity), costPerUnit: Number(i.costPerUnit), ...(i.packs ? { packs: Number(i.packs) } : {}) })),
    }
  }
  const d = row.draftData ?? { items: [] }
  return {
    status: 'draft', supplier: d.supplier ?? row.supplier, fromRegister: !!d.fromRegister, paymentMethod: d.paymentMethod,
    items: (d.items ?? []).map((i) => ({ itemId: i.itemId ?? undefined, name: i.name ?? undefined, unit: i.unit ?? 'шт', quantity: Number(i.quantity) || 0, costPerUnit: Number(i.costPerUnit) || 0, ...(i.packs ? { packs: Number(i.packs) } : {}) })),
  }
}

async function readMeta(clubKey: string, id: string): Promise<LineMeta[]> {
  const raw = await getSharedRedis().get(metaKey(clubKey, id)).catch(() => null)
  return raw ? (JSON.parse(raw) as LineMeta[]) : []
}

async function writeMeta(clubKey: string, id: string, meta: LineMeta[]): Promise<void> {
  await getSharedRedis().set(metaKey(clubKey, id), JSON.stringify(meta), 'EX', META_TTL_SEC).catch(() => {})
}

async function saveDraft(api: ApiCaller, id: string | null, draft: Pick<Draft, 'supplier' | 'fromRegister' | 'paymentMethod' | 'items'>): Promise<string> {
  const r = await api.post<{ id: string }>('/api/supplies/draft', {
    ...(id ? { id } : {}),
    supplier: draft.supplier ?? undefined,
    fromRegister: draft.fromRegister,
    paymentMethod: draft.paymentMethod,
    items: draft.items,
  })
  return r.id
}

export interface SupplyCtx { db: Database; api: ApiCaller; clubKey: string }

/** Карточка поставки для HUB и Telegram. null — черновика нет (удалён). */
export async function supplyCard(ctx: SupplyCtx, id: string, result?: string): Promise<TaiSupplyCard | null> {
  const draft = await readDraft(ctx.db, id)
  if (!draft) return null
  const meta = await readMeta(ctx.clubKey, id)
  const ids = draft.items.map((i) => i.itemId).filter((x): x is string => !!x)
  const stock = ids.length ? (await loadStock(ctx.db)).filter((s) => ids.includes(s.id)) : []
  const byId = new Map(stock.map((s) => [s.id, s]))
  const lines: TaiSupplyLine[] = draft.items.map((it, index) => {
    const item = it.itemId ? byId.get(it.itemId) : undefined
    const m = meta[index] ?? {}
    return {
      index,
      itemId: it.itemId ?? null,
      name: item?.name ?? it.name ?? '—',
      said: m.said && norm(m.said) !== norm(item?.name ?? it.name ?? '') ? m.said : undefined,
      quantity: it.quantity,
      unit: it.unit,
      packs: it.packs,
      packName: item?.packName ?? null,
      packSize: item?.packSize ?? null,
      costPerUnit: it.costPerUnit,
      sum: round2(it.quantity * it.costPerUnit),
      uncertain: !it.itemId || !!m.uncertain,
      alternatives: m.alternatives,
    }
  })
  return {
    id,
    status: draft.status === 'draft' ? 'draft' : 'posted',
    supplier: draft.supplier,
    fromRegister: draft.fromRegister,
    lines,
    total: round2(lines.reduce((s, l) => s + l.sum, 0)),
    ...(result ? { result } : {}),
  }
}

/** Новый черновик из сказанного. */
export async function createSupply(ctx: SupplyCtx, spoken: SpokenLine[], supplier: string | null): Promise<TaiSupplyCard> {
  const stock = await loadStock(ctx.db)
  const lines: DraftLine[] = []
  const meta: LineMeta[] = []
  for (const s of spoken) {
    const known = s.itemId ? stock.find((x) => x.id === s.itemId) ?? null : null
    const m = known ? { item: known, meta: { said: s.name } } : match(stock, s.name)
    lines.push(await lineOf(ctx.db, s, m.item))
    meta.push(m.meta)
  }
  const id = await saveDraft(ctx.api, null, { supplier, fromRegister: false, items: lines })
  await writeMeta(ctx.clubKey, id, meta)
  return (await supplyCard(ctx, id))!
}

export type SupplyOp =
  | { op: 'quantity'; line: number; quantity: number }
  | { op: 'step'; line: number; direction: 1 | -1 }
  | { op: 'price'; line: number; costPerUnit: number }
  | { op: 'remove'; line: number }
  | { op: 'match'; line: number; itemId: string }
  | { op: 'add'; spoken: SpokenLine }
  | { op: 'respeak'; line: number; spoken: SpokenLine }
  | { op: 'payment'; fromRegister: boolean }
  | { op: 'supplier'; supplier: string }

/** Шаг «±» строки: упаковка, 100 г/мл или штука. */
function stepOf(line: DraftLine, item: Stock | undefined): number {
  if (item?.packSize) return item.packSize
  return line.unit === 'г' || line.unit === 'мл' ? 100 : 1
}

/** Правки черновика (кнопки HUB/Telegram и слова «колы не 12, а 24»). */
export async function editSupply(ctx: SupplyCtx, id: string, ops: SupplyOp[]): Promise<TaiSupplyCard> {
  const draft = await readDraft(ctx.db, id)
  if (!draft) throw new Error('Черновик поставки не найден — возможно, его удалили')
  if (draft.status !== 'draft') throw new Error('Поставка уже принята — правьте её в HUB')
  const stock = await loadStock(ctx.db)
  const byId = new Map(stock.map((s) => [s.id, s]))
  const items = [...draft.items]
  const meta = [...(await readMeta(ctx.clubKey, id))]
  let { fromRegister, supplier } = draft
  for (const op of ops) {
    if ('line' in op && (op.line < 0 || op.line >= items.length)) continue
    switch (op.op) {
      case 'quantity':
      case 'step': {
        const line = items[op.line]!
        const item = line.itemId ? byId.get(line.itemId) : undefined
        const raw = op.op === 'quantity' ? op.quantity : line.quantity + op.direction * stepOf(line, item)
        const quantity = Math.max(line.itemId ? Math.round(raw) : raw, 0)
        items[op.line] = { ...line, quantity, ...(item?.packSize ? { packs: round2(quantity / item.packSize) } : {}) }
        break
      }
      case 'price':
        items[op.line] = { ...items[op.line]!, costPerUnit: round4(Math.max(op.costPerUnit, 0)) }
        break
      case 'remove':
        items.splice(op.line, 1)
        meta.splice(op.line, 1)
        break
      case 'match': {
        const item = byId.get(op.itemId)
        if (!item) break
        const old = items[op.line]!
        const said = meta[op.line]?.said ?? old.name ?? item.name
        const total = old.costPerUnit > 0 ? old.quantity * old.costPerUnit : undefined
        items[op.line] = await lineOf(ctx.db, { name: said, count: old.packs ?? old.quantity, unit: old.packs ? 'pack' : 'pcs', total }, item)
        meta[op.line] = { said }
        break
      }
      case 'add':
      case 'respeak': {
        const known = op.spoken.itemId ? byId.get(op.spoken.itemId) ?? null : null
        const m = known ? { item: known, meta: { said: op.spoken.name } } : match(stock, op.spoken.name)
        const line = await lineOf(ctx.db, op.spoken, m.item)
        if (op.op === 'add') {
          items.push(line)
          meta[items.length - 1] = m.meta
        } else {
          items[op.line] = line
          meta[op.line] = m.meta
        }
        break
      }
      case 'payment':
        fromRegister = op.fromRegister
        break
      case 'supplier':
        supplier = op.supplier.trim() || null
        break
    }
  }
  await saveDraft(ctx.api, id, { supplier, fromRegister, paymentMethod: draft.paymentMethod, items })
  await writeMeta(ctx.clubKey, id, meta)
  return (await supplyCard(ctx, id))!
}

/** Принять: провести черновик (остатки, себестоимость, выдача из кассы при оплате из кассы). */
export async function acceptSupply(ctx: SupplyCtx, id: string): Promise<TaiSupplyCard> {
  const draft = await readDraft(ctx.db, id)
  if (!draft) throw new Error('Черновик поставки не найден')
  if (draft.status !== 'draft') return (await supplyCard(ctx, id, 'Поставка уже принята'))!
  const items = draft.items.filter((i) => i.quantity > 0)
  if (!items.length) throw new Error('В поставке нет позиций с количеством')
  await ctx.api.post(`/api/supplies/${id}/apply`, { supplier: draft.supplier ?? undefined, fromRegister: draft.fromRegister, paymentMethod: draft.paymentMethod, items })
  await getSharedRedis().del(metaKey(ctx.clubKey, id)).catch(() => {})
  return (await supplyCard(ctx, id, 'Поставка принята'))!
}

/** Отменить: удалить черновик. */
export async function cancelSupply(ctx: SupplyCtx, id: string): Promise<TaiSupplyCard | null> {
  const card = await supplyCard(ctx, id)
  if (!card || card.status !== 'draft') return card
  await ctx.api.delete(`/api/supplies/${id}`)
  await getSharedRedis().del(metaKey(ctx.clubKey, id)).catch(() => {})
  return { ...card, status: 'cancelled', result: 'Черновик удалён' }
}

/** Коротко для памяти диалога: какие строки в карточке и под какими номерами. */
export function supplyMemo(card: TaiSupplyCard): string {
  const lines = card.lines.map((l) => `${l.index + 1}) ${l.name} ${l.packs ? `${l.packs} уп = ` : ''}${l.quantity} ${l.unit} по ${l.costPerUnit}`).join('; ')
  return `черновик поставки ${card.id} (${card.status}): ${lines}; итого ${card.total} ₽`
}
