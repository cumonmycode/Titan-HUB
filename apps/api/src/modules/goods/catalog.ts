import type { Database } from '@titan/database'
import { inventory, menuCategories, recipeItems, stockMovements, tariffs, eq, and, asc, gte, isNull, inArray, isNotNull, sql } from '@titan/database'

// Каталог раздела «Товары» одним ответом: категории, позиции меню и сырьё с
// техкартами, ролью позиции и расходом за 30 дней. Из него приложение строит все три
// вкладки (Меню, Остатки, Операции) и карточки, не дёргая сервер на каждый экран.

export type GoodsRole = 'menu' | 'tariff' | 'rental' | 'ingredient'
export type StockMode = 'none' | 'pieces' | 'recipe'

export interface GoodsItem {
  id: string
  name: string
  kind: 'goods' | 'ingredient'
  unit: 'pcs' | 'g' | 'ml'
  /** Имя штуки (pack — «пачка»…) для unit = 'pcs'; null — «шт». */
  unitLabel: string | null
  /** Фасовка при закупке: «пачка ≈ 25 шт» (в базовых единицах). */
  packName: string | null
  packSize: number | null
  /** menu — обычная позиция; tariff — скрытая позиция тарифа (правится в «Тарифах»);
   *  rental — аренда зоны; ingredient — сырьё. */
  role: GoodsRole
  /** Как позиция учитывается: не учитывается, штучно или по техкарте. */
  stockMode: StockMode
  category: string | null
  price: number
  /** Себестоимость единицы: WAC по приходам, у позиции с техкартой — сумма состава. */
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
  recipe: { componentId: string; quantity: number }[]
  /** Был ли приход: до первого прихода себестоимость штучного товара задаётся вручную. */
  hasReceipts: boolean
  /** Средний расход в день за 30 дней (продажи минус возвраты, в единице товара). */
  dailyUse: number
}

const USE_WINDOW_DAYS = 30

const num = (v: unknown) => parseFloat(String(v ?? 0)) || 0

/** Режим учёта: состав важнее флага — позиция с техкартой сама остаток не ведёт. */
export function stockModeOf(trackStock: boolean, recipeSize: number): StockMode {
  if (recipeSize > 0) return 'recipe'
  return trackStock ? 'pieces' : 'none'
}

export async function loadCatalog(db: Database) {
  const since = new Date(Date.now() - USE_WINDOW_DAYS * 86400000)
  const [categories, rows, recipes, tariffRows, receiptRows, useRows] = await Promise.all([
    db.select().from(menuCategories).orderBy(asc(menuCategories.sortOrder), asc(menuCategories.name)),
    db.select().from(inventory).where(isNull(inventory.deletedAt)).orderBy(asc(inventory.sortOrder), asc(inventory.name)),
    db.select().from(recipeItems).orderBy(asc(recipeItems.sortOrder)),
    db.select({ itemId: tariffs.itemId }).from(tariffs).where(isNotNull(tariffs.itemId)),
    db.selectDistinct({ itemId: stockMovements.itemId }).from(stockMovements).where(eq(stockMovements.type, 'receipt')),
    db.select({ itemId: stockMovements.itemId, used: sql<string>`sum(0 - ${stockMovements.delta})` })
      .from(stockMovements)
      .where(and(inArray(stockMovements.type, ['sale', 'return']), gte(stockMovements.createdAt, since)))
      .groupBy(stockMovements.itemId),
  ])

  const tariffItems = new Set(tariffRows.map((t) => t.itemId))
  const received = new Set(receiptRows.map((r) => r.itemId))
  const useById = new Map(useRows.map((u) => [u.itemId, Math.max(0, num(u.used))]))
  const recipeById = new Map<string, { componentId: string; quantity: number }[]>()
  for (const r of recipes) {
    const list = recipeById.get(r.productId) ?? []
    list.push({ componentId: r.componentId, quantity: r.quantity })
    recipeById.set(r.productId, list)
  }

  const items: GoodsItem[] = rows.map((r) => {
    const recipe = recipeById.get(r.id) ?? []
    const role: GoodsRole = r.kind === 'ingredient' ? 'ingredient' : tariffItems.has(r.id) ? 'tariff' : r.linkedSpaceId ? 'rental' : 'menu'
    return {
      id: r.id,
      name: r.name,
      kind: r.kind,
      unit: r.unit,
      unitLabel: r.unitLabel,
      packName: r.packName,
      packSize: r.packSize,
      role,
      stockMode: r.kind === 'ingredient' ? 'pieces' : stockModeOf(r.trackStock, recipe.length),
      category: r.category,
      price: num(r.price),
      costPrice: num(r.costPrice),
      stockQuantity: r.stockQuantity ?? 0,
      reorderPoint: r.reorderPoint ?? (r.minThreshold ? r.minThreshold : null),
      parLevel: r.parLevel,
      isActive: r.isActive,
      isTop: r.isTop,
      isTabletVisible: r.isTabletVisible,
      isScreenVisible: r.isScreenVisible,
      searchTags: r.searchTags ?? [],
      linkedSpaceId: r.linkedSpaceId,
      sortOrder: r.sortOrder,
      recipe,
      hasReceipts: received.has(r.id),
      dailyUse: Math.round(((useById.get(r.id) ?? 0) / USE_WINDOW_DAYS) * 100) / 100,
    }
  })

  return { categories, items }
}
