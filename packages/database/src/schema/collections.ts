import { pgTable, uuid, text, numeric, boolean, timestamp } from 'drizzle-orm/pg-core'
import { profiles } from './profiles.js'

/**
 * «Сбор средств» — настраиваемые сборы взносов с резидентов, НЕ связанные с
 * кассой заведения. Деньги учитываются отдельно (своя «копилка» сбора). Взнос
 * можно списать с депозита клиента или записать в долг (тогда меняется
 * profiles.balance + создаётся transactions-запись, видимая в истории игрока),
 * либо отметить наличными/переводом/СБП мимо баланса.
 *
 * Взносы только у резидентов (client_tier ∈ resident/student/newbie; гость — нет).
 */

// Тема сбора: «Фонд клуба» (регулярный, ежемесячный авто-период) или разовый
// добровольный (на ДР и т.п. — единый список без месяцев).
export const collections = pgTable('collections', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  description: text('description'),
  // 'recurring' — ежемесячный (авто-период YYYY-MM) | 'oneoff' — разовый (период 'single')
  kind: text('kind').notNull().default('recurring'),
  // Обязательный (ожидается со всех резидентов) vs добровольный — влияет только на подпись.
  isMandatory: boolean('is_mandatory').notNull().default(true),
  // Единая сумма взноса; у конкретного участника может быть переопределена (members.amountOverride).
  defaultAmount: numeric('default_amount', { precision: 12, scale: 2 }).notNull().default('0'),
  isActive: boolean('is_active').notNull().default(true),
  createdBy: uuid('created_by').references(() => profiles.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// Период сбора. Для recurring — один на месяц (period_key='YYYY-MM'); для oneoff —
// единственный (period_key='single'). У периода своя сумма взноса (по умолчанию = collections.defaultAmount).
export const collectionPeriods = pgTable('collection_periods', {
  id: uuid('id').primaryKey().defaultRandom(),
  collectionId: uuid('collection_id').notNull().references(() => collections.id, { onDelete: 'cascade' }),
  periodKey: text('period_key').notNull(), // 'YYYY-MM' | 'single'
  label: text('label').notNull(),
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull().default('0'),
  status: text('status').notNull().default('open'), // open | closed
  openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
  closedAt: timestamp('closed_at', { withTimezone: true }),
})

// Факт оплаты взноса игроком за период. Один взнос на (период, игрок).
export const collectionContributions = pgTable('collection_contributions', {
  id: uuid('id').primaryKey().defaultRandom(),
  collectionId: uuid('collection_id').notNull().references(() => collections.id, { onDelete: 'cascade' }),
  periodId: uuid('period_id').notNull().references(() => collectionPeriods.id, { onDelete: 'cascade' }),
  playerId: uuid('player_id').notNull().references(() => profiles.id),
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
  // cash | transfer | sbp | deposit | debt. deposit/debt меняют profiles.balance.
  method: text('method').notNull(),
  // Ссылка на transactions-запись для deposit/debt (для отмены/реверса). NULL для наличных.
  balanceTxId: uuid('balance_tx_id'),
  note: text('note'),
  paidAt: timestamp('paid_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by').references(() => profiles.id),
})

// Персональные настройки участника в рамках сбора: своя сумма взноса и/или
// исключение (на срок до excludedUntil или навсегда). Нет строки = включён, сумма по умолчанию.
export const collectionMembers = pgTable('collection_members', {
  id: uuid('id').primaryKey().defaultRandom(),
  collectionId: uuid('collection_id').notNull().references(() => collections.id, { onDelete: 'cascade' }),
  playerId: uuid('player_id').notNull().references(() => profiles.id),
  // Персональная сумма взноса (переопределяет период/дефолт). NULL = по умолчанию.
  amountOverride: numeric('amount_override', { precision: 12, scale: 2 }),
  // Исключение до даты (1/3 мес). NULL + excludedForever=false → не исключён.
  excludedUntil: timestamp('excluded_until', { withTimezone: true }),
  excludedForever: boolean('excluded_forever').notNull().default(false),
  // Начало исключения: окно [excludedFrom, excludedUntil] не входит в долг и после возврата.
  excludedFrom: timestamp('excluded_from', { withTimezone: true }),
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
})

export type Collection = typeof collections.$inferSelect
export type CollectionPeriod = typeof collectionPeriods.$inferSelect
export type CollectionContribution = typeof collectionContributions.$inferSelect
export type CollectionMember = typeof collectionMembers.$inferSelect
