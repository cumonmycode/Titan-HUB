import { db, inventory, recipeItems, stockMovements, checkItems, eq, and, or, isNull, asc, sql } from '@titan/database'

// Единая воронка записи движений склада. ЛЮБОЕ изменение остатка (продажа,
// приёмка, ревизия, списание, корректировка, возврат) проходит через неё, поэтому
// журнал stock_movements — единственный источник истины, а inventory.stockQuantity
// и cost_price (WAC) — материализованный кэш, синхронный с журналом в той же
// транзакции. Инвариант: stockQuantity == SUM(delta) по товару.
//
// Техкарты (миграция 070): продажа позиции с составом списывает компоненты (recordSale),
// движение компонента помнит позицию меню в sold_item_id. Себестоимость позиции с
// техкартой = сумма состава по WAC компонентов; пересчитывается после прихода
// компонента (refreshRecipeCosts), чтобы cost_price позиции не «застывал».

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
type DbOrTx = typeof db | Tx

export type MovementType =
  | 'opening' | 'receipt' | 'sale' | 'return'
  | 'adjustment' | 'write_off' | 'count' | 'transfer'

export interface RecordMovementInput {
  itemId: string
  type: MovementType
  /** Знаковая дельта (в единице товара). Фактически применённая может отличаться при clamp. */
  delta: number
  /** Цена единицы прихода (receipt). Включает пересчёт WAC, когда delta > 0. */
  unitCost?: number
  /** Списание не уводит ниже нуля (или ниже уже отрицательного остатка); приход не режется. По умолчанию true. */
  clamp?: boolean
  /** Менять остаток только у учётных (trackStock) товаров. Для POS — true. */
  requireTracked?: boolean
  /** Позиция меню, ради продажи которой списан компонент техкарты. */
  soldItemId?: string | null
  sourceType?: string | null
  sourceId?: string | null
  reason?: string | null
  note?: string | null
  userId?: string | null
}

/** Остаток пересёк точку заказа сверху вниз — повод для уведомления «заканчивается». */
export interface LowStock {
  itemId: string
  name: string
  qtyAfter: number
  unit: 'pcs' | 'g' | 'ml'
}

export interface MovementResult {
  /** Остаток после движения. */
  qtyAfter: number
  /** Фактически применённая дельта (с учётом clamp). 0 — товара нет/не учётный. */
  applied: number
  /** Себестоимость (WAC) после движения. */
  avgCost: number
  /** false, если товар не найден (или мягко удалён). */
  ok: boolean
  /** Заполнено, если движение опустило остаток до точки заказа. */
  lowStock: LowStock | null
}

/** Количество в единице товара для текста: «9 шт», «900 мл», «1,2 кг». */
export function quantityText(qty: number, unit: 'pcs' | 'g' | 'ml'): string {
  if (unit === 'pcs') return `${qty} шт`
  const big = unit === 'g' ? 'кг' : 'л'
  const small = unit === 'g' ? 'г' : 'мл'
  if (Math.abs(qty) < 1000) return `${qty} ${small}`
  return `${String(Math.round(qty / 10) / 100).replace('.', ',')} ${big}`
}

/** Текст уведомления «заканчивается»: «Молоко: осталось 900 мл». */
export function lowStockText(ls: LowStock): string {
  return `${ls.name}: осталось ${quantityText(ls.qtyAfter, ls.unit)}`
}

/** Себестоимость единицы — 4 знака: у сырья это цена грамма/миллилитра. */
export const round4 = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000

/** Точка заказа товара: новая reorder_point, иначе старый порог min_threshold. */
export function reorderPointOf(item: { reorderPoint: number | null; minThreshold: number | null }): number {
  return item.reorderPoint ?? item.minThreshold ?? 0
}

/**
 * Провести движение склада в рамках транзакции tx.
 * Лочит строку товара FOR UPDATE, вычисляет остаток, на приходе пересчитывает WAC,
 * обновляет кэш inventory и пишет строку журнала. Возвращает фактическую дельту и
 * новый остаток (нулевая дельта строку журнала не создаёт).
 */
export async function recordMovement(tx: Tx, input: RecordMovementInput): Promise<MovementResult> {
  const clamp = input.clamp ?? true
  const [item] = await tx.select().from(inventory).where(eq(inventory.id, input.itemId)).for('update')
  if (!item) return { qtyAfter: 0, applied: 0, avgCost: 0, ok: false, lowStock: null }

  const before = item.stockQuantity ?? 0
  const oldCost = parseFloat(String(item.costPrice ?? 0)) || 0
  // POS трогает остаток только у учётных товаров — не-учётные пропускаем без записи.
  if (input.requireTracked && !item.trackStock) {
    return { qtyAfter: before, applied: 0, avgCost: oldCost, ok: true, lowStock: null }
  }
  const rawAfter = before + input.delta
  // clamp режет только уменьшение и не выше текущего уровня: приход на минусовой
  // остаток проходит как есть, а списание с уже отрицательного остатка — в ноль
  // (а не «вверх» до нуля, как было при Math.max(0, rawAfter)).
  const floor = Math.min(0, before)
  const qtyAfter = clamp && input.delta < 0 ? Math.max(floor, rawAfter) : rawAfter
  const applied = qtyAfter - before

  let avgCost = oldCost
  // WAC только на приходе с известной ценой: (before·old + in·cost) / after.
  // База «до» клампится в ноль: после оверселла остаток уходит в минус
  // (clamp:false у продажи), а отрицательный before искажает средневзвешенную
  // (числитель занижается, WAC может уйти в минус и отравить маржу/стоимость
  // склада навсегда). Приход на «дыру» считаем как чистый приход по своей цене:
  // используем effectiveBefore = max(0, before) и в числителе, и в знаменателе.
  if (input.type === 'receipt' && applied > 0 && input.unitCost !== undefined && qtyAfter > 0) {
    const effectiveBefore = Math.max(0, before)
    avgCost = round4(
      (effectiveBefore * oldCost + applied * input.unitCost) / (effectiveBefore + applied),
    )
  }

  if (applied !== 0 || avgCost !== oldCost) {
    const set: Record<string, unknown> = { stockQuantity: qtyAfter, updatedAt: new Date() }
    if (avgCost !== oldCost) set.costPrice = String(avgCost)
    await tx.update(inventory).set(set).where(eq(inventory.id, input.itemId))
  }
  // Нулевую дельту в журнал не пишем (нет факта движения остатка).
  if (applied !== 0) {
    const unitCost = input.type === 'receipt' ? input.unitCost : avgCost
    await tx.insert(stockMovements).values({
      itemId: input.itemId,
      type: input.type,
      delta: applied,
      qtyAfter,
      unitCost: unitCost !== undefined && unitCost !== null ? String(round4(unitCost)) : null,
      soldItemId: input.soldItemId ?? null,
      sourceType: input.sourceType ?? null,
      sourceId: input.sourceId ?? null,
      reason: input.reason ?? null,
      note: input.note ?? null,
      createdBy: input.userId ?? null,
    })
  }

  const threshold = reorderPointOf(item)
  const lowStock = item.trackStock && threshold > 0 && before > threshold && qtyAfter <= threshold
    ? { itemId: item.id, name: item.name, qtyAfter, unit: item.unit }
    : null
  return { qtyAfter, applied, avgCost, ok: true, lowStock }
}

/**
 * Пересчитать себестоимость позиций с техкартой: всех, в чьём составе есть один из
 * componentIds, или перечисленных productIds. cost_price позиции = Σ (количество × WAC
 * компонента), 4 знака. Позиции без состава не трогаем.
 *
 * Вызывать ПОСЛЕ транзакции прихода, отдельным запросом: внутри неё порядок блокировок
 * «компонент → позиция» встречно продаже «позиция → компонент» и мог бы дать
 * взаимоблокировку. cost_price позиции с техкартой — кэш, секунда задержки не страшна.
 */
export async function refreshRecipeCosts(conn: DbOrTx, scope: { componentIds: string[] } | { productIds: string[] }) {
  const ids = 'componentIds' in scope ? scope.componentIds : scope.productIds
  if (!ids.length) return
  const list = sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)
  const filter = 'componentIds' in scope
    ? sql`r.product_id IN (SELECT product_id FROM recipe_items WHERE component_id IN (${list}))`
    : sql`r.product_id IN (${list})`
  await conn.execute(sql`
    UPDATE inventory p SET cost_price = sub.cost, updated_at = now()
    FROM (
      SELECT r.product_id, round(sum(r.quantity * coalesce(c.cost_price, 0)), 4) AS cost
      FROM recipe_items r JOIN inventory c ON c.id = r.component_id
      WHERE ${filter}
      GROUP BY r.product_id
    ) sub
    WHERE p.id = sub.product_id AND p.cost_price IS DISTINCT FROM sub.cost
  `)
}

export interface RecordSaleInput {
  itemId: string
  /** Сколько порций продано (sale) или вернулось (return), > 0. */
  quantity: number
  direction: 'sale' | 'return'
  sourceType: string
  sourceId: string
  reason: string
  userId?: string | null
}

/**
 * Продажа или возврат позиции меню. Позиция с техкартой списывает (возвращает) свои
 * компоненты: quantity × количество в составе, sold_item_id = позиция. Без техкарты
 * движется сама позиция, если она учётная. Продажа не блокируется нехваткой — остаток
 * может уйти в минус (оверселл), владелец сводит его ревизией.
 * Компоненты лочатся в порядке id — две параллельные продажи не встанут во взаимоблокировку.
 */
export async function recordSale(tx: Tx, input: RecordSaleInput): Promise<{ lowStock: LowStock[] }> {
  if (input.quantity <= 0) return { lowStock: [] }
  const sign = input.direction === 'sale' ? -1 : 1
  const components = await tx
    .select({ componentId: recipeItems.componentId, quantity: recipeItems.quantity })
    .from(recipeItems)
    .where(eq(recipeItems.productId, input.itemId))
    .orderBy(asc(recipeItems.componentId))

  const moves = components.length
    ? components.map((c) => ({ itemId: c.componentId, delta: sign * input.quantity * c.quantity, soldItemId: input.itemId }))
    : [{ itemId: input.itemId, delta: sign * input.quantity, soldItemId: null }]

  const lowStock: LowStock[] = []
  for (const move of moves) {
    const res = await recordMovement(tx, {
      itemId: move.itemId, type: input.direction, delta: move.delta, clamp: false, requireTracked: true,
      soldItemId: move.soldItemId, sourceType: input.sourceType, sourceId: input.sourceId,
      reason: input.reason, userId: input.userId,
    })
    if (res.lowStock) lowStock.push(res.lowStock)
  }
  return { lowStock }
}

/**
 * Вернуть на склад часть порций позиции меню, проданной по чеку, — по журналу чека
 * (source_type='check', source_id=checkId), а не по текущей техкарте/флагу учёта:
 * состав или trackStock могли измениться после продажи. На каждый (товар, позиция
 * меню) берётся net списания по чеку, и возвращается его доля quantity/portions, где
 * portions — порций позиции в чеке сейчас (сумма строк check_items: вызывать ДО
 * правки/удаления строки позиции). Доля считается кумулятивно (округлённое «вернуть
 * всего после» минус «до»), поэтому возврат всех порций гасит списание ровно в ноль
 * и никогда не больше него.
 */
export async function returnCheckPortions(tx: Tx, input: {
  /** Чек, по журналу которого считаем фактически списанное. */
  checkId: string
  /** Позиция меню (inventory.id), порции которой возвращаются. */
  itemId: string
  /** Сколько порций вернуть, > 0. */
  quantity: number
  /**
   * Сколько порций уже вернули ВНЕ журнала чека (прошлые возвраты закрытого чека
   * пишутся с source_type='refund' и net чека не уменьшают). Для открытого чека — 0:
   * снятия с чека пишутся в его же журнал.
   */
  alreadyReturned?: number
  sourceType: string
  sourceId: string
  reason: string
  userId?: string | null
}) {
  const [{ portions }] = await tx
    .select({ portions: sql<number>`coalesce(sum(${checkItems.quantity}), 0)::int` })
    .from(checkItems)
    .where(and(eq(checkItems.checkId, input.checkId), eq(checkItems.itemId, input.itemId)))
  const already = Math.max(0, input.alreadyReturned ?? 0)
  if (input.quantity <= 0 || !(portions > 0)) return
  const upTo = Math.min(portions, already + input.quantity)
  if (upTo <= already) return

  const rows = await tx
    .select({
      itemId: stockMovements.itemId,
      soldItemId: stockMovements.soldItemId,
      net: sql<string>`sum(${stockMovements.delta})`,
    })
    .from(stockMovements)
    .where(and(
      eq(stockMovements.sourceType, 'check'),
      eq(stockMovements.sourceId, input.checkId),
      // Состав техкарты (sold_item_id = позиция) или сама учётная позиция без техкарты.
      or(
        eq(stockMovements.soldItemId, input.itemId),
        and(eq(stockMovements.itemId, input.itemId), isNull(stockMovements.soldItemId)),
      ),
    ))
    .groupBy(stockMovements.itemId, stockMovements.soldItemId)
    .orderBy(asc(stockMovements.itemId))
  for (const row of rows) {
    const deducted = -(Number(row.net) || 0)
    if (deducted <= 0) continue
    const qty = Math.round((deducted * upTo) / portions) - Math.round((deducted * already) / portions)
    if (qty <= 0) continue
    await recordMovement(tx, {
      itemId: row.itemId, type: 'return', delta: qty, clamp: false,
      soldItemId: row.soldItemId, sourceType: input.sourceType, sourceId: input.sourceId,
      reason: input.reason, userId: input.userId,
    })
  }
}

/**
 * Откатить документ: погасить всё, что по нему проведено, — по журналу, а не по
 * текущим техкартам (состав мог измениться). Сумма движений источника на каждый
 * (товар, позиция меню) гасится одним движением обратного знака. Без clamp: откат
 * обязан вернуть остаток ровно туда, где он был бы без документа.
 */
export async function reverseMovements(tx: Tx, input: {
  sourceType: string
  sourceId: string
  type: 'return' | 'adjustment'
  reason: string
  userId?: string | null
}) {
  const rows = await tx
    .select({
      itemId: stockMovements.itemId,
      soldItemId: stockMovements.soldItemId,
      net: sql<string>`sum(${stockMovements.delta})`,
    })
    .from(stockMovements)
    .where(and(eq(stockMovements.sourceType, input.sourceType), eq(stockMovements.sourceId, input.sourceId)))
    .groupBy(stockMovements.itemId, stockMovements.soldItemId)
    .orderBy(asc(stockMovements.itemId))
  for (const row of rows) {
    const net = Number(row.net) || 0
    if (net === 0) continue
    await recordMovement(tx, {
      itemId: row.itemId, type: input.type, delta: -net, clamp: false,
      soldItemId: row.soldItemId, sourceType: input.sourceType, sourceId: input.sourceId,
      reason: input.reason, userId: input.userId,
    })
  }
}

/** Отмена чека: вернуть на склад ровно то, что по нему списано (см. reverseMovements). */
export function reverseCheckMovements(tx: Tx, checkId: string, reason: string, userId?: string | null) {
  return reverseMovements(tx, { sourceType: 'check', sourceId: checkId, type: 'return', reason, userId })
}
