import { z } from 'zod'
import type { Database } from '@titan/database'
import { inventory, recipeItems, stockMovements, tariffs, eq, and, inArray, isNull } from '@titan/database'
import { refreshRecipeCosts, round4 } from '../inventory/ledger.js'

// Создание и правка позиции раздела «Товары» одним запросом: поля меню, режим учёта
// (не учитывать / штучно / по техкарте), состав, точка заказа. Остаток здесь НЕ
// меняется — только документами (приход, списание, ревизия).

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0]

/** Имена штуки и упаковки — со склонениями на клиенте («пачка, пачки, пачек»). */
const PIECE_NAMES = ['pcs', 'pack', 'bottle', 'can', 'box', 'bag', 'portion'] as const

const RecipeLine = z.object({
  componentId: z.string().uuid(),
  quantity: z.number().int().positive().max(1_000_000),
})

const Fields = {
  name: z.string().trim().min(1, 'Укажите название').max(120),
  unit: z.enum(['pcs', 'g', 'ml']),
  unitLabel: z.enum(PIECE_NAMES).nullable(),
  packName: z.enum(PIECE_NAMES).nullable(),
  packSize: z.number().int().positive().max(1_000_000).nullable(),
  category: z.string().uuid().nullable(),
  price: z.number().min(0).max(10_000_000),
  isActive: z.boolean(),
  isTop: z.boolean(),
  isTabletVisible: z.boolean(),
  isScreenVisible: z.boolean(),
  searchTags: z.array(z.string().trim().min(1).max(40)).max(20),
  linkedSpaceId: z.string().uuid().nullable(),
  stockMode: z.enum(['none', 'pieces', 'recipe']),
  recipe: z.array(RecipeLine).max(30),
  costPrice: z.number().min(0).max(1_000_000),
  reorderPoint: z.number().int().min(0).max(10_000_000).nullable(),
  parLevel: z.number().int().min(0).max(10_000_000).nullable(),
}

export const ItemCreateSchema = z.object({ kind: z.enum(['goods', 'ingredient']).default('goods'), ...Fields })
  .partial({ unit: true, unitLabel: true, packName: true, packSize: true, category: true, price: true, isActive: true, isTop: true, isTabletVisible: true, isScreenVisible: true, searchTags: true, linkedSpaceId: true, stockMode: true, recipe: true, costPrice: true, reorderPoint: true, parLevel: true })
export const ItemPatchSchema = z.object(Fields).partial()

export type ItemCreate = z.infer<typeof ItemCreateSchema>
export type ItemPatch = z.infer<typeof ItemPatchSchema>

/** Ошибка, понятная пользователю: роутер отдаёт её текстом с указанным статусом. */
export class GoodsError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 = 400) {
    super(message)
  }
}

type Row = typeof inventory.$inferSelect

async function hasMovements(tx: Tx, itemId: string, type?: 'receipt'): Promise<boolean> {
  const where = type ? and(eq(stockMovements.itemId, itemId), eq(stockMovements.type, type)) : eq(stockMovements.itemId, itemId)
  const [row] = await tx.select({ id: stockMovements.id }).from(stockMovements).where(where).limit(1)
  return !!row
}

/** Позиции (не удалённые), в чьём составе есть itemId. */
async function usedIn(tx: Tx, itemId: string): Promise<string[]> {
  const rows = await tx
    .select({ name: inventory.name })
    .from(recipeItems)
    .innerJoin(inventory, eq(inventory.id, recipeItems.productId))
    .where(and(eq(recipeItems.componentId, itemId), isNull(inventory.deletedAt)))
  return rows.map((r) => r.name)
}

/**
 * Проверить состав: компоненты существуют, учитываются на складе (сырьё или штучный
 * товар) и сами не собираются по техкарте — вложенных техкарт нет, чтобы продажа
 * списывала ровно то, что видно в составе.
 */
async function validateRecipe(tx: Tx, productId: string | null, recipe: { componentId: string; quantity: number }[]) {
  if (!recipe.length) throw new GoodsError('Добавьте в состав хотя бы один ингредиент')
  const ids = recipe.map((r) => r.componentId)
  if (new Set(ids).size !== ids.length) throw new GoodsError('Ингредиент повторяется в составе')
  if (productId && ids.includes(productId)) throw new GoodsError('Позиция не может входить в свой состав')
  const components = await tx.select().from(inventory).where(and(inArray(inventory.id, ids), isNull(inventory.deletedAt)))
  if (components.length !== ids.length) throw new GoodsError('Ингредиент не найден — обновите список', 404)
  for (const c of components) {
    if (c.kind !== 'ingredient' && !c.trackStock) throw new GoodsError(`«${c.name}» не учитывается на складе — включите учёт или выберите ингредиент`)
  }
  const nested = await tx.select({ productId: recipeItems.productId }).from(recipeItems).where(inArray(recipeItems.productId, ids)).limit(1)
  if (nested.length) throw new GoodsError('В составе есть позиция со своей техкартой — укажите её ингредиенты напрямую')
}

/** Итоговое значение после правки: что пришло в теле, иначе — как было. */
function merged<T>(next: T | undefined, current: T): T {
  return next === undefined ? current : next
}

/**
 * Создать (existing = null) или изменить позицию. Возвращает id. Бросает GoodsError.
 */
export async function saveGoodsItem(tx: Tx, existing: Row | null, body: ItemCreate | ItemPatch): Promise<string> {
  const kind = existing?.kind ?? ('kind' in body && body.kind ? body.kind : 'goods')
  const isIngredient = kind === 'ingredient'

  if (existing) {
    const [tariff] = await tx.select({ id: tariffs.id }).from(tariffs).where(eq(tariffs.itemId, existing.id)).limit(1)
    if (tariff) throw new GoodsError('Позиция тарифа правится в «Тарифах и аренде»', 409)
  }

  // Единица: у позиции меню — штуки; у сырья меняется, пока по нему не было движений.
  const unit = isIngredient ? merged(body.unit, existing?.unit ?? 'g') : 'pcs'
  if (existing && unit !== existing.unit && await hasMovements(tx, existing.id)) {
    throw new GoodsError('Единицу нельзя сменить: по товару уже были движения', 409)
  }
  // Количество в составе блюд записано в прежней единице (18 г ≠ 18 мл) — смена единицы
  // молча исказила бы списание и себестоимость техкарт.
  if (existing && unit !== existing.unit) {
    const owners = await usedIn(tx, existing.id)
    if (owners.length) throw new GoodsError(`Единицу нельзя сменить: ингредиент входит в состав (${owners.slice(0, 3).join(', ')}) — сначала уберите его оттуда`, 409)
  }

  const currentRecipe = existing ? await tx.select().from(recipeItems).where(eq(recipeItems.productId, existing.id)) : []
  const currentMode = currentRecipe.length ? 'recipe' : existing?.trackStock ? 'pieces' : 'none'
  const mode = isIngredient ? 'pieces' : merged(body.stockMode, currentMode)
  const recipe = mode === 'recipe' ? merged(body.recipe, currentRecipe.map((r) => ({ componentId: r.componentId, quantity: r.quantity }))) : []

  if (mode === 'recipe') {
    await validateRecipe(tx, existing?.id ?? null, recipe)
    if (existing && (await usedIn(tx, existing.id)).length) {
      throw new GoodsError('Позиция сама входит в чужой состав — техкарту ей задать нельзя', 409)
    }
  }
  if (existing && mode !== 'pieces') {
    const owners = await usedIn(tx, existing.id)
    if (owners.length) throw new GoodsError(`Позиция входит в состав: ${owners.slice(0, 3).join(', ')} — она должна учитываться на складе`, 409)
  }

  // Себестоимость вручную — только пока её не считает склад: до первого прихода
  // (приход пересчитывает среднюю при любом режиме учёта). У техкарты — сумма состава.
  if (body.costPrice !== undefined) {
    if (mode === 'recipe') throw new GoodsError('Себестоимость позиции с техкартой считается по составу')
    if (existing && await hasMovements(tx, existing.id, 'receipt')) {
      throw new GoodsError('Себестоимость считается по приходам — её меняет новый приход')
    }
  }

  const reorderPoint = merged(body.reorderPoint, existing?.reorderPoint ?? null)
  const values: Partial<typeof inventory.$inferInsert> = {
    name: merged(body.name, existing?.name ?? ''),
    kind,
    unit,
    trackStock: mode === 'pieces',
    reorderPoint,
    // Старый порог держим равным точке заказа — его читают прежние версии веба.
    minThreshold: reorderPoint ?? 0,
    parLevel: merged(body.parLevel, existing?.parLevel ?? null),
    updatedAt: new Date(),
  }
  if (body.costPrice !== undefined) values.costPrice = String(round4(body.costPrice))
  // Фасовка — у всего, что закупают (сырьё и штучный товар); имя штуки — только у штук.
  if (body.packName !== undefined) values.packName = body.packName
  if (body.packSize !== undefined) values.packSize = body.packSize
  if (body.unitLabel !== undefined) values.unitLabel = unit === 'pcs' ? body.unitLabel : null
  else if (unit !== 'pcs') values.unitLabel = null
  if (isIngredient) {
    // Сырьё нигде не показывается гостям и не продаётся.
    Object.assign(values, { category: null, price: '0', isActive: true, isTop: false, isTabletVisible: false, isScreenVisible: false, isService: false, linkedSpaceId: null })
    if (body.searchTags !== undefined) values.searchTags = body.searchTags
  } else {
    if (body.category !== undefined) values.category = body.category
    if (body.price !== undefined) values.price = String(body.price)
    if (body.isActive !== undefined) values.isActive = body.isActive
    if (body.isTop !== undefined) values.isTop = body.isTop
    if (body.isTabletVisible !== undefined) values.isTabletVisible = body.isTabletVisible
    if (body.isScreenVisible !== undefined) values.isScreenVisible = body.isScreenVisible
    if (body.searchTags !== undefined) values.searchTags = body.searchTags
    if (body.linkedSpaceId !== undefined) values.linkedSpaceId = body.linkedSpaceId
  }

  let id = existing?.id
  if (existing) {
    await tx.update(inventory).set(values).where(eq(inventory.id, existing.id))
  } else {
    // Новая позиция — в конец своего списка; остаток всегда 0 (его меняют документы).
    const [row] = await tx.insert(inventory).values({ ...values, name: values.name!, stockQuantity: 0, sortOrder: 10_000 }).returning({ id: inventory.id })
    id = row!.id
  }

  const recipeChanged = mode === 'recipe' ? body.recipe !== undefined || currentRecipe.length === 0 : currentRecipe.length > 0
  if (recipeChanged) {
    await tx.delete(recipeItems).where(eq(recipeItems.productId, id!))
    if (recipe.length) {
      await tx.insert(recipeItems).values(recipe.map((r, i) => ({ productId: id!, componentId: r.componentId, quantity: r.quantity, sortOrder: i })))
      await refreshRecipeCosts(tx, { productIds: [id!] })
    }
  }
  // Себестоимость или единица компонента сменилась — пересчитать закэшированную
  // себестоимость блюд, в чьём составе он есть.
  if (existing && (body.costPrice !== undefined || unit !== existing.unit)) {
    await refreshRecipeCosts(tx, { componentIds: [id!] })
  }
  return id!
}

/** Мягкое удаление: позиция остаётся в прошлых чеках, но пропадает из списков. */
export async function deleteGoodsItem(tx: Tx, itemId: string) {
  const [item] = await tx.select().from(inventory).where(and(eq(inventory.id, itemId), isNull(inventory.deletedAt))).for('update')
  if (!item) throw new GoodsError('Позиция не найдена', 404)
  const [tariff] = await tx.select({ id: tariffs.id }).from(tariffs).where(eq(tariffs.itemId, itemId)).limit(1)
  if (tariff) throw new GoodsError('Позиция тарифа удаляется в «Тарифах и аренде»', 409)
  const owners = await usedIn(tx, itemId)
  if (owners.length) throw new GoodsError(`Сначала уберите из состава: ${owners.slice(0, 3).join(', ')}`, 409)
  await tx.delete(recipeItems).where(eq(recipeItems.productId, itemId))
  await tx.update(inventory).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(inventory.id, itemId))
}
