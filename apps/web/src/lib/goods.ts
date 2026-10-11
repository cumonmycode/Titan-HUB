'use client'
/**
 * Раздел «Товары» (apps/api/src/modules/goods, миграции 070–071) — та же логика, что в
 * приложении (apps/mobile/src/lib/goods-api.ts): меню, ингредиенты и склад одним
 * разделом. Позиция меню и ингредиент — одна сущность каталога; остаток меняют только
 * документы (приход, списание, ревизия) и продажи кассы. Себестоимость считает склад.
 *
 * Ингредиенты и штучные товары учитываются целым числом в своей единице (шт, г, мл);
 * у штук бывает имя («пачка»), у закупки — фасовка («пачка ≈ 25 шт»); граммы
 * показываем килограммами, миллилитры — литрами, когда их много.
 */
import { useQuery, type QueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

export type Unit = 'pcs' | 'g' | 'ml'
export type StockMode = 'none' | 'pieces' | 'recipe'
export type GoodsRole = 'menu' | 'tariff' | 'rental' | 'ingredient'
export type RecipeLine = { componentId: string; quantity: number }

export interface GoodsCategory {
  id: string
  name: string
  icon: string
  color: string
  isActive: boolean
  isTabletVisible: boolean
  sortOrder: number
}

export interface GoodsItem {
  id: string
  name: string
  kind: 'goods' | 'ingredient'
  unit: Unit
  /** Имя штуки (pack — «пачка») для unit = 'pcs'; null — «шт». */
  unitLabel: PieceName | null
  /** Фасовка при закупке: «пачка ≈ 25 шт» (размер — в базовых единицах). */
  packName: PieceName | null
  packSize: number | null
  role: GoodsRole
  stockMode: StockMode
  category: string | null
  price: number
  costPrice: number
  stockQuantity: number
  reorderPoint: number | null
  parLevel: number | null
  isActive: boolean
  isTop: boolean
  isTabletVisible: boolean
  isScreenVisible: boolean
  searchTags: string[]
  linkedSpaceId: string | null
  sortOrder: number
  recipe: RecipeLine[]
  hasReceipts: boolean
  dailyUse: number
}

export interface Catalog {
  categories: GoodsCategory[]
  items: GoodsItem[]
  byId: Map<string, GoodsItem>
}

export type MovementType = 'opening' | 'receipt' | 'sale' | 'return' | 'adjustment' | 'write_off' | 'count' | 'transfer'

export interface GoodsMovement {
  id: string
  type: MovementType
  delta: number
  qtyAfter: number
  unitCost: string | null
  sourceType: string | null
  sourceId: string | null
  reason: string | null
  createdAt: string
  author: string | null
  soldItemName: string | null
}

export type DaySeries = { date: string; qty: number }[]

export interface GoodsCard {
  movements: GoodsMovement[]
  sales: { qty: number; revenue: number; series: DaySeries }
  usage: { qty: number; series: DaySeries }
  lastSupply: { date: string; supplier: string | null; supplyId: string; quantity: number; costPerUnit: number } | null
  usedIn: { id: string; name: string; quantity: number }[]
}

export type DocType = 'supply' | 'write_off' | 'revision'

export interface GoodsDocument {
  type: DocType
  id: string
  status: 'draft' | 'posted'
  createdAt: string
  updatedAt: string | null
  author: string | null
  positions: number
  amount: number
  title: string | null
  fromRegister?: boolean
  surplus?: number
  shortage?: number
}

/* ─── Единицы ─────────────────────────────────────────────────────────────── */

export const UNIT_LABEL: Record<Unit, string> = { pcs: 'шт', g: 'г', ml: 'мл' }
export const BIG_UNIT: Record<Unit, { label: string; factor: number }> = {
  pcs: { label: 'шт', factor: 1 },
  g: { label: 'кг', factor: 1000 },
  ml: { label: 'л', factor: 1000 },
}
export const UNIT_CHOICES: { unit: Unit; title: string }[] = [
  { unit: 'g', title: 'Граммы' },
  { unit: 'ml', title: 'Миллилитры' },
  { unit: 'pcs', title: 'Штуки' },
]

/** Как называется штука или упаковка — со склонениями; `per` — «₽ за пачку», `in` — «в пачке». */
export type PieceName = 'pcs' | 'pack' | 'bottle' | 'can' | 'box' | 'bag' | 'portion'
export const PIECE_NAMES: Record<PieceName, { title: string; forms: [string, string, string]; per: string; in: string }> = {
  pcs: { title: 'Штука', forms: ['шт', 'шт', 'шт'], per: 'шт', in: 'штуке' },
  pack: { title: 'Пачка', forms: ['пачка', 'пачки', 'пачек'], per: 'пачку', in: 'пачке' },
  bottle: { title: 'Бутылка', forms: ['бутылка', 'бутылки', 'бутылок'], per: 'бутылку', in: 'бутылке' },
  can: { title: 'Банка', forms: ['банка', 'банки', 'банок'], per: 'банку', in: 'банке' },
  box: { title: 'Коробка', forms: ['коробка', 'коробки', 'коробок'], per: 'коробку', in: 'коробке' },
  bag: { title: 'Пакет', forms: ['пакет', 'пакета', 'пакетов'], per: 'пакет', in: 'пакете' },
  portion: { title: 'Порция', forms: ['порция', 'порции', 'порций'], per: 'порцию', in: 'порции' },
}
export const PIECE_CHOICES = Object.keys(PIECE_NAMES) as PieceName[]

/** Быстрый выбор единицы нового ингредиента: «Пачки» — штуки с именем «пачка». */
export const QUICK_UNITS: { unit: Unit; label: PieceName | null; title: string }[] = [
  { unit: 'g', label: null, title: 'Граммы' },
  { unit: 'ml', label: null, title: 'Миллилитры' },
  { unit: 'pcs', label: null, title: 'Штуки' },
  { unit: 'pcs', label: 'pack', title: 'Пачки' },
]

const decimal = (n: number, digits: number) => n.toLocaleString('ru-RU', { maximumFractionDigits: digits })

function pluralForm(n: number, forms: [string, string, string]): string {
  if (!Number.isInteger(n)) return forms[1]
  return plural(n, forms)
}

/** «3 пачки», «1 коробка». */
export function pieceText(n: number, name: PieceName | null | undefined): string {
  return `${decimal(n, 2).replace('-', '−')} ${pluralForm(n, PIECE_NAMES[name ?? 'pcs'].forms)}`
}

/** «24 шт», «38 пачек», «850 г», «1,25 кг», «1,5 л», «−3 шт». */
export function formatQty(qty: number, unit: Unit, label?: PieceName | null): string {
  if (unit === 'pcs') return pieceText(qty, label)
  if (Math.abs(qty) < 1000) return `${decimal(qty, 0).replace('-', '−')} ${UNIT_LABEL[unit]}`
  return `${decimal(qty / 1000, 2).replace('-', '−')} ${BIG_UNIT[unit].label}`
}

/** Количество в единице позиции, с именем штуки: «38 пачек», «1,2 кг». */
export const itemQty = (item: Pick<GoodsItem, 'unit' | 'unitLabel'>, qty: number) => formatQty(qty, item.unit, item.unitLabel)

/** Единица рядом с числом в поле: «1 пачка», «3 пачки», «18 г» — форма по набранному числу. */
export function unitWord(unit: Unit, label: PieceName | null | undefined, text: string): string {
  if (unit !== 'pcs') return UNIT_LABEL[unit]
  return pluralForm(parseDecimal(text) ?? 5, PIECE_NAMES[label ?? 'pcs'].forms)
}

/** Крупная единица для полей прихода и запаса: «шт», «пачек», «кг», «л». */
export const bigWord = (unit: Unit, label: PieceName | null | undefined) => (unit === 'pcs' ? PIECE_NAMES[label ?? 'pcs'].forms[2] : BIG_UNIT[unit].label)

/** Фасовка словами: «пачка ≈ 25 шт»; null — фасовка не задана. */
export function packText(item: Pick<GoodsItem, 'unit' | 'unitLabel' | 'packName' | 'packSize'>): string | null {
  if (!item.packSize) return null
  return `${PIECE_NAMES[item.packName ?? 'pack'].forms[0]} ≈ ${itemQty(item, item.packSize)}`
}

/** Цена единицы так, как её привыкли видеть: за штуку (пачку), за килограмм, за литр. */
export function unitPrice(costPerBase: number, unit: Unit, label?: PieceName | null): { value: number; label: string } {
  return { value: costPerBase * BIG_UNIT[unit].factor, label: `за ${unit === 'pcs' ? PIECE_NAMES[label ?? 'pcs'].per : BIG_UNIT[unit].label}` }
}

/** Число для поля ввода: «1,25» — с запятой, без хвостовых нулей и пробелов. */
export function numberText(n: number, digits = 3): string {
  return decimal(n, digits).replace(/\s/g, '')
}

/** Строка из поля → число (запятая или точка); пусто или мусор → null. */
export function parseDecimal(text: string): number | null {
  const normalized = text.replace(/\s/g, '').replace(',', '.')
  if (!normalized) return null
  const n = Number(normalized)
  return Number.isFinite(n) && n >= 0 ? n : null
}

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
export const round4 = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000

/* ─── Остатки ─────────────────────────────────────────────────────────────── */

export type StockLevel = 'out' | 'low' | 'ok'
export const LEVEL_LOOK: Record<StockLevel, { label: string; color: string }> = {
  out: { label: 'Нет', color: '#FB7185' },
  low: { label: 'Заканчивается', color: '#F59E0B' },
  ok: { label: 'В наличии', color: '#34D399' },
}

/** Ведётся ли остаток: штучный товар меню или сырьё (не тариф). */
export const isStockItem = (i: GoodsItem) => i.kind === 'ingredient' || (i.stockMode === 'pieces' && (i.role === 'menu' || i.role === 'rental'))
/** Позиция меню, которую правят в «Товарах» (тарифы — в «Тарифах и аренде»). */
export const isMenuItem = (i: GoodsItem) => i.kind === 'goods' && i.role !== 'tariff'
export const isTariffCategory = (c: Pick<GoodsCategory, 'name'>) => c.name.toLowerCase().includes('тариф')

export function stockLevel(i: Pick<GoodsItem, 'stockQuantity' | 'reorderPoint'>): StockLevel {
  if (i.stockQuantity <= 0) return 'out'
  if (i.reorderPoint && i.stockQuantity <= i.reorderPoint) return 'low'
  return 'ok'
}

export function daysLeft(i: Pick<GoodsItem, 'stockQuantity' | 'dailyUse'>): number | null {
  if (i.dailyUse <= 0 || i.stockQuantity <= 0) return null
  return Math.floor(i.stockQuantity / i.dailyUse)
}

/** Сколько порций можно приготовить по составу и какой ингредиент кончится первым. */
export function servings(item: GoodsItem, byId: Map<string, GoodsItem>): { count: number; limitedBy: GoodsItem | null } | null {
  if (item.stockMode !== 'recipe' || item.recipe.length === 0) return null
  let count = Infinity
  let limitedBy: GoodsItem | null = null
  for (const line of item.recipe) {
    const c = byId.get(line.componentId)
    if (!c) continue
    const n = Math.max(0, Math.floor(c.stockQuantity / line.quantity))
    if (n < count) { count = n; limitedBy = c }
  }
  return Number.isFinite(count) ? { count, limitedBy } : null
}

export const recipeCost = (recipe: RecipeLine[], byId: Map<string, GoodsItem>) =>
  recipe.reduce((s, l) => s + l.quantity * (byId.get(l.componentId)?.costPrice ?? 0), 0)

/** Сколько дозаказать: до целевого уровня (или вдвое выше точки заказа). */
export function reorderQuantity(i: GoodsItem): number {
  const target = i.parLevel ?? (i.reorderPoint ? i.reorderPoint * 2 : 0)
  return Math.max(0, target - Math.max(0, i.stockQuantity))
}

export const margin = (price: number, cost: number) => (price > 0 && cost > 0 ? Math.round(((price - cost) / price) * 100) : null)

export function plural(n: number, forms: [string, string, string]): string {
  const a = Math.abs(n) % 100
  const b = a % 10
  if (a > 10 && a < 20) return forms[2]
  if (b > 1 && b < 5) return forms[1]
  if (b === 1) return forms[0]
  return forms[2]
}
export const positionsText = (n: number) => `${n} ${plural(n, ['позиция', 'позиции', 'позиций'])}`

export function matches(item: GoodsItem, q: string): boolean {
  if (!q) return true
  return item.name.toLowerCase().includes(q) || item.searchTags.some(t => t.toLowerCase().includes(q))
}

/* ─── Запросы ─────────────────────────────────────────────────────────────── */

export function useGoods() {
  return useQuery({
    queryKey: ['goods', 'catalog'],
    queryFn: () => api.get<{ categories: GoodsCategory[]; items: GoodsItem[] }>('/goods'),
    select: (d): Catalog => {
      const items = (d.items ?? []).map(i => ({
        ...i,
        unitLabel: i.unitLabel ?? null,
        packName: i.packName ?? null,
        packSize: i.packSize ?? null,
        recipe: i.recipe ?? [],
        searchTags: i.searchTags ?? [],
      }))
      return { categories: d.categories ?? [], items, byId: new Map(items.map(i => [i.id, i])) }
    },
    staleTime: 15_000,
  })
}

export function useGoodsCard(itemId: string | null) {
  return useQuery({
    queryKey: ['goods', 'card', itemId],
    queryFn: () => api.get<GoodsCard>(`/goods/items/${itemId}/card`),
    enabled: !!itemId,
    staleTime: 15_000,
  })
}

export function useGoodsDocuments() {
  return useQuery({
    queryKey: ['goods', 'documents'],
    queryFn: () => api.get<{ documents: GoodsDocument[] }>('/goods/documents?limit=150').then(r => r.documents),
    staleTime: 15_000,
  })
}

export function useSuppliers() {
  return useQuery({
    queryKey: ['goods', 'suppliers'],
    queryFn: () => api.get<{ suppliers: { name: string }[] }>('/goods/suppliers').then(r => r.suppliers.map(s => s.name)),
    staleTime: 5 * 60_000,
  })
}

/** Касса и старые экраны тоже читают остатки — обновляем всё, что их показывает. */
export function refreshGoods(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: ['goods'] })
  void qc.invalidateQueries({ queryKey: ['menu'] })
  void qc.invalidateQueries({ queryKey: ['inventory'] })
}

export interface ItemInput {
  name: string
  category?: string | null
  price?: number
  isActive?: boolean
  isTop?: boolean
  isTabletVisible?: boolean
  isScreenVisible?: boolean
  searchTags?: string[]
  linkedSpaceId?: string | null
  stockMode?: StockMode
  recipe?: RecipeLine[]
  costPrice?: number
  reorderPoint?: number | null
  parLevel?: number | null
  unit?: Unit
  unitLabel?: PieceName | null
  packName?: PieceName | null
  packSize?: number | null
}

export const createItem = (kind: 'goods' | 'ingredient', input: ItemInput) => api.post<{ id: string }>('/goods/items', { kind, ...input }).then(r => r.id)
export const updateItem = (id: string, input: Partial<ItemInput>) => api.patch(`/goods/items/${id}`, input)
export const deleteItem = (id: string) => api.delete(`/goods/items/${id}`)

/** Ключ идемпотентности проведения: двойной клик не задвоит приход или списание. */
export function newIdempotencyKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}
