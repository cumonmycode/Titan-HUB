import { pgTable, uuid, text, numeric, boolean, integer, timestamp, pgEnum, jsonb } from 'drizzle-orm/pg-core'
import { profiles } from './profiles.js'
import { inventory } from './menu.js'
import { checks, paymentMethodEnum, discountTypeEnum } from './checks.js'

export const discounts = pgTable('discounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  type: discountTypeEnum('type').notNull(),
  value: numeric('value', { precision: 10, scale: 2 }).notNull(),
  isActive: boolean('is_active').notNull().default(true),
  isAuto: boolean('is_auto').notNull().default(false),
  minQuantity: integer('min_quantity').default(1),
  itemId: uuid('item_id').references(() => inventory.id),
  clientRuleId: uuid('client_rule_id'),
  clientId: uuid('client_id').references(() => profiles.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const clientDiscountRules = pgTable('client_discount_rules', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  // text + справочник client_tiers (статусы динамические, миграция 021).
  clientTier: text('client_tier').notNull(),
  discountId: uuid('discount_id').references(() => discounts.id),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const certificates = pgTable('certificates', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(),
  nominal: numeric('nominal', { precision: 10, scale: 2 }).notNull(),
  balance: numeric('balance', { precision: 10, scale: 2 }).notNull(),
  isUsed: boolean('is_used').notNull().default(false),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => profiles.id),
  usedBy: uuid('used_by').references(() => profiles.id),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const transactionTypeEnum = pgEnum('transaction_type', [
  'deposit',
  'withdrawal',
  'payment',
  'refund',
  'bonus_accrual',
  'bonus_spend',
])

export const transactions = pgTable('transactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  // text + CHECK (миграция 041), а не enum — чтобы добавлять типы без ALTER TYPE
  // в транзакции. Значения: deposit/withdrawal/payment/refund/bonus_accrual/
  // bonus_spend/visit_adjust (последний — учёт виртуальных посещений, без денег).
  type: text('type').notNull(),
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
  description: text('description'),
  // Ключ идемпотентности денежных операций (миграция 045): повтор с тем же ключом
  // не задваивает изменение баланса. NULL для операций без защиты (POS и т.п.).
  idempotencyKey: text('idempotency_key'),
  checkId: uuid('check_id').references(() => checks.id),
  playerId: uuid('player_id').references(() => profiles.id),
  itemId: uuid('item_id').references(() => inventory.id),
  createdBy: uuid('created_by').references(() => profiles.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const bonusHistory = pgTable('bonus_history', {
  id: uuid('id').primaryKey().defaultRandom(),
  profileId: uuid('profile_id')
    .notNull()
    .references(() => profiles.id),
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
  balanceAfter: numeric('balance_after', { precision: 12, scale: 2 }).notNull(),
  reason: text('reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// Лоты начислений бонусов — параллельный учёт для сгорания бонусов по сроку.
// profiles.bonusPoints остаётся источником истины для баланса; лоты лишь
// отслеживают, какие начисления когда сгорают (FIFO по сроку). Лот с
// expiresAt = NULL не сгорает никогда. remaining уменьшается при списании.
export const bonusLots = pgTable('bonus_lots', {
  id: uuid('id').primaryKey().defaultRandom(),
  profileId: uuid('profile_id')
    .notNull()
    .references(() => profiles.id),
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
  remaining: numeric('remaining', { precision: 12, scale: 2 }).notNull(),
  // NULL = бессрочно (сгорание выключено на момент начисления).
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const supplies = pgTable('supplies', {
  id: uuid('id').primaryKey().defaultRandom(),
  idempotencyKey: text('idempotency_key'),
  // 'posted' — проведённая (есть supply_items + движения receipt); 'draft' — черновик
  // (рабочее состояние в draftData, остатки/WAC не тронуты). Миграция 046.
  status: text('status').notNull().default('posted'),
  draftData: jsonb('draft_data').$type<{
    note?: string; supplier?: string; paymentMethod?: 'cash' | 'card' | 'transfer'; fromRegister?: boolean
    items: { itemId?: string | null; name?: string; unit?: string; quantity: number; costPerUnit: number; packs?: number | null }[]
  }>(),
  note: text('note'),
  supplier: text('supplier'),
  totalCost: numeric('total_cost', { precision: 12, scale: 2 }).notNull().default('0'),
  paymentMethod: paymentMethodEnum('payment_method').notNull().default('cash'),
  // Оплачено наличными из кассы смены — выдача из кассы (cash_operations, миграция 070).
  cashOperationId: uuid('cash_operation_id'),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => profiles.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
})

export const supplyItems = pgTable('supply_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  supplyId: uuid('supply_id')
    .notNull()
    .references(() => supplies.id, { onDelete: 'cascade' }),
  // Опциональная привязка к карточке товара (для обновления остатка).
  itemId: uuid('item_id').references(() => inventory.id),
  name: text('name'),
  unit: text('unit').notNull().default('шт'),
  quantity: numeric('quantity', { precision: 10, scale: 2 }).notNull(),
  costPerUnit: numeric('cost_per_unit', { precision: 12, scale: 4 }).notNull(),
  // Сколько упаковок пришло (фасовка ингредиента, миграция 071).
  packs: numeric('packs', { precision: 10, scale: 2 }),
})

// Корректировки проведённых закупок — аудит с обязательной причиной. Каждая правка
// состава/сумм закупки создаёт запись: причина + сумма до/после. История показывается
// в карточке закупки (нельзя «молча» переписать приёмку задним числом).
export const supplyCorrections = pgTable('supply_corrections', {
  id: uuid('id').primaryKey().defaultRandom(),
  supplyId: uuid('supply_id')
    .notNull()
    .references(() => supplies.id, { onDelete: 'cascade' }),
  reason: text('reason').notNull(),
  totalBefore: numeric('total_before', { precision: 12, scale: 2 }).notNull().default('0'),
  totalAfter: numeric('total_after', { precision: 12, scale: 2 }).notNull().default('0'),
  createdBy: uuid('created_by').references(() => profiles.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// Телеметрия аналитики: какие разделы/метрики реально смотрят (для оценки UX).
// Лёгкие события с фронта: открытие раздела, смена периода, открытие drill-down.
export const analyticsEvents = pgTable('analytics_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => profiles.id),
  event: text('event').notNull(),
  props: jsonb('props').$type<Record<string, unknown>>().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// Журнал движений склада — immutable ledger, единый источник истины остатка.
// Любое изменение остатка (продажа/приёмка/ревизия/списание/корректировка/возврат)
// проходит через recordMovement() (modules/inventory/ledger.ts) и порождает строку.
// Инвариант: inventory.stockQuantity == SUM(delta) по товару (см. миграцию 044).
export const stockMovements = pgTable('stock_movements', {
  id: uuid('id').primaryKey().defaultRandom(),
  itemId: uuid('item_id')
    .notNull()
    .references(() => inventory.id),
  // text + CHECK (миграция 044): opening/receipt/sale/return/adjustment/write_off/count/transfer.
  type: text('type').notNull(),
  delta: integer('delta').notNull(),
  // Остаток ПОСЛЕ движения (штучный учёт — целое).
  qtyAfter: integer('qty_after').notNull(),
  // Себестоимость единицы в движении: цена прихода либо WAC на момент списания.
  unitCost: numeric('unit_cost', { precision: 12, scale: 4 }),
  // Позиция меню, ради продажи которой списан ингредиент по техкарте (миграция 070).
  soldItemId: uuid('sold_item_id'),
  // Ссылка на документ-источник (связь движение → документ в UI), не ключ идемпотентности.
  sourceType: text('source_type'),
  sourceId: uuid('source_id'),
  reason: text('reason'),
  note: text('note'),
  createdBy: uuid('created_by').references(() => profiles.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export type StockMovement = typeof stockMovements.$inferSelect

export const expenseCategoryEnum = pgEnum('expense_category', [
  'rent',
  'utilities',
  'supplies',
  'salary',
  'marketing',
  'equipment',
  'other',
])

export const expenses = pgTable('expenses', {
  id: uuid('id').primaryKey().defaultRandom(),
  idempotencyKey: text('idempotency_key'),
  // text + CHECK (миграция 039), а не enum — чтобы добавлять категории без
  // ALTER TYPE в транзакции. Значения: rent/utilities/supplies/salary/marketing/
  // equipment/other/consumables/tobacco.
  category: text('category').notNull().default('other'),
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
  description: text('description'),
  // Позиция расхода: цена за единицу и количество (amount = unit_price × quantity).
  unitPrice: numeric('unit_price', { precision: 12, scale: 2 }),
  quantity: numeric('quantity', { precision: 12, scale: 2 }),
  expenseDate: text('expense_date').notNull(),
  // Привязка расхода к мероприятию (расходы миникапа: приз/обед/иные).
  eventId: uuid('event_id'),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => profiles.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const refundReasonEnum = pgEnum('refund_reason', ['return', 'exchange', 'discount', 'damage'])
export const refundTypeEnum = pgEnum('refund_type', ['full', 'partial'])

export const refunds = pgTable('refunds', {
  id: uuid('id').primaryKey().defaultRandom(),
  checkId: uuid('check_id')
    .notNull()
    .references(() => checks.id),
  totalAmount: numeric('total_amount', { precision: 12, scale: 2 }).notNull(),
  refundType: refundTypeEnum('refund_type').notNull().default('full'),
  reason: refundReasonEnum('reason').notNull().default('return'),
  note: text('note'),
  // Разбивка возврата по способам оплаты: [{ method, amount }]
  tenders: jsonb('tenders').$type<{ method: string; amount: number }[]>(),
  // Фактически восстановленный на склад сток этим возвратом: [{ itemId, quantity }].
  // Нужно, чтобы повторные частичные возвраты не восстанавливали сток сверх
  // проданного (cap = sold − alreadyRestored по всем предыдущим возвратам чека).
  restoredItems: jsonb('restored_items').$type<{ itemId: string; quantity: number }[]>().default([]),
  // Ключ идемпотентности клиента (миграция 074): повтор того же возврата после
  // потерянного ответа возвращает уже записанный возврат, а не проводит второй.
  idempotencyKey: text('idempotency_key'),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => profiles.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const salaryPayments = pgTable('salary_payments', {
  id: uuid('id').primaryKey().defaultRandom(),
  idempotencyKey: text('idempotency_key'),
  profileId: uuid('profile_id')
    .notNull()
    .references(() => profiles.id),
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
  paymentMethod: paymentMethodEnum('payment_method').notNull().default('cash'),
  note: text('note'),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => profiles.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const cashOperationTypeEnum = pgEnum('cash_operation_type', [
  'deposit',
  'withdrawal',
  'salary',
])

export const cashOperations = pgTable('cash_operations', {
  id: uuid('id').primaryKey().defaultRandom(),
  idempotencyKey: text('idempotency_key'),
  type: cashOperationTypeEnum('type').notNull(),
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
  description: text('description'),
  shiftId: uuid('shift_id'),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => profiles.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export type BonusLot = typeof bonusLots.$inferSelect
export type NewBonusLot = typeof bonusLots.$inferInsert
export type Discount = typeof discounts.$inferSelect
export type Certificate = typeof certificates.$inferSelect
export type Transaction = typeof transactions.$inferSelect
export type Supply = typeof supplies.$inferSelect
export type SupplyCorrection = typeof supplyCorrections.$inferSelect
export type AnalyticsEvent = typeof analyticsEvents.$inferSelect
export type Expense = typeof expenses.$inferSelect
export type Refund = typeof refunds.$inferSelect
export type SalaryPayment = typeof salaryPayments.$inferSelect
export type CashOperation = typeof cashOperations.$inferSelect

// ─── Ревизии склада (история инвентаризаций) ─────────────────────────────────
// Снапшот «ожидалось/факт» по позициям на момент проведения. Правка старой
// ревизии пересчитывает остаток на дельту (новый факт − старый факт).
export const revisions = pgTable('revisions', {
  id: uuid('id').primaryKey().defaultRandom(),
  // 'applied' — проведённая (есть revision_items + движения); 'draft' — черновик
  // (рабочее состояние в draftData, остатки не тронуты). Миграция 046.
  status: text('status').notNull().default('applied'),
  draftData: jsonb('draft_data').$type<{ items: { itemId: string; actual: number | null }[] }>(),
  createdBy: uuid('created_by').references(() => profiles.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
})

export const revisionItems = pgTable('revision_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  revisionId: uuid('revision_id').notNull().references(() => revisions.id, { onDelete: 'cascade' }),
  itemId: uuid('item_id').notNull().references(() => inventory.id),
  name: text('name').notNull(),
  expected: integer('expected').notNull(),
  actual: integer('actual').notNull(),
  costPrice: numeric('cost_price', { precision: 12, scale: 4 }).notNull().default('0'),
  sortOrder: integer('sort_order').notNull().default(0),
})

// ─── Списания (бой, порча, угощение) документом на несколько позиций ─────────
// 'posted' — проведено (есть write_off_items + движения write_off); 'draft' — черновик
// в draft_data, остатки не тронуты. Миграция 070.
export const writeOffs = pgTable('write_offs', {
  id: uuid('id').primaryKey().defaultRandom(),
  idempotencyKey: text('idempotency_key'),
  status: text('status').$type<'draft' | 'posted'>().notNull().default('posted'),
  reason: text('reason').notNull().default(''),
  note: text('note'),
  draftData: jsonb('draft_data').$type<{ reason?: string; note?: string; items: { itemId: string; quantity: number }[] }>(),
  totalCost: numeric('total_cost', { precision: 12, scale: 2 }).notNull().default('0'),
  createdBy: uuid('created_by').references(() => profiles.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
})

export const writeOffItems = pgTable('write_off_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  writeOffId: uuid('write_off_id').notNull().references(() => writeOffs.id, { onDelete: 'cascade' }),
  itemId: uuid('item_id').notNull().references(() => inventory.id),
  name: text('name').notNull(),
  quantity: integer('quantity').notNull(),
  unitCost: numeric('unit_cost', { precision: 12, scale: 4 }).notNull().default('0'),
  sortOrder: integer('sort_order').notNull().default(0),
})

export type WriteOff = typeof writeOffs.$inferSelect
