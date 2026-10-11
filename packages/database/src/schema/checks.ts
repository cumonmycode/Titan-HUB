import {
  pgTable,
  uuid,
  text,
  numeric,
  integer,
  smallint,
  timestamp,
  jsonb,
  pgEnum,
} from 'drizzle-orm/pg-core'
import { profiles } from './profiles.js'
import { shifts } from './shifts.js'
import { spaces } from './spaces.js'
import { inventory } from './menu.js'
import { modifiers } from './menu.js'

export const checkStatusEnum = pgEnum('check_status', ['open', 'closed', 'cancelled'])
export const paymentMethodEnum = pgEnum('payment_method', [
  'cash',
  'card',
  'transfer',
  'bonus',
  'deposit',
  'debt',
  'split',
  'certificate',
])

export const checks = pgTable('checks', {
  id: uuid('id').primaryKey().defaultRandom(),
  playerId: uuid('player_id').references(() => profiles.id),
  staffId: uuid('staff_id')
    .notNull()
    .references(() => profiles.id),
  shiftId: uuid('shift_id')
    .notNull()
    .references(() => shifts.id),
  status: checkStatusEnum('status').notNull().default('open'),
  totalAmount: numeric('total_amount', { precision: 12, scale: 2 }).notNull().default('0'),
  paymentMethod: paymentMethodEnum('payment_method'),
  bonusUsed: numeric('bonus_used', { precision: 12, scale: 2 }).default('0'),
  certificateUsed: numeric('certificate_used', { precision: 12, scale: 2 }).default('0'),
  certificateId: uuid('certificate_id'),
  discountTotal: numeric('discount_total', { precision: 12, scale: 2 }).default('0'),
  // Списание на персонал/владельца: если задан — чек бесплатный (итог 0), товар
  // «продан за 0₽», а в аналитике «Персонал» учитывается товарная сумма и
  // себестоимость, которую сотрудник «как бы оплатил». Ссылка на потребителя.
  staffCompId: uuid('staff_comp_id').references(() => profiles.id),
  spaceId: uuid('space_id').references(() => spaces.id),
  spaceStartAt: timestamp('space_start_at', { withTimezone: true }),
  spaceEndAt: timestamp('space_end_at', { withTimezone: true }),
  guestNames: text('guest_names').array().default([]),
  note: text('note'),
  // ID авто/тир-скидок, вручную снятых с ЭТОГО чека: applyAutoDiscounts их
  // пропускает (иначе скидка вернулась бы при следующем пересчёте позиций).
  excludedDiscountIds: uuid('excluded_discount_ids').array().default([]),
  linkedEventId: uuid('linked_event_id'),
  // База события на чеке: фикс/ручная сумма мероприятия (помимо позиций и аренды).
  // Входит в «Итого», редактируется; синхронизируется при правке суммы события.
  eventBaseAmount: numeric('event_base_amount', { precision: 12, scale: 2 }),
  // Заранее «внесённая» часть (напр. предоплата участия в миникапе): на экране
  // оплаты вычитается из остатка, но входит в пробиваемый итог (при закрытии
  // пишется отдельным платежом «перевод» — в кассу смены эти деньги не поступали).
  // Выручка считается один раз по полному total.
  prepaidAmount: numeric('prepaid_amount', { precision: 12, scale: 2 }).notNull().default('0'),
  // Чаевые по QR/СБП (поверх суммы товаров). Хранятся на чеке для валидации в
  // webhook'е Platega и фиксации фактически уплаченных чаевых. См. 028_*.sql.
  tipAmount: numeric('tip_amount', { precision: 12, scale: 2 }).notNull().default('0'),
  // id подтверждённой транзакции Platega (реконсиляция СБП-оплаты, см. 033_*.sql).
  plategaTxId: text('platega_tx_id'),
  // Эквайринговая надбавка СБП (8%), которую ДОПЛАТИЛ КЛИЕНТ поверх товаров (вопрос
  // «Добавить комиссию 8%?»). >0 ⇒ комиссию закрыл покупатель — потерей владельца НЕ
  // считается; 0 ⇒ 8% удержал банк из выручки владельца (потеря). См. 047_*.sql.
  acquiringSurcharge: numeric('acquiring_surcharge', { precision: 12, scale: 2 }).notNull().default('0'),
  // Последний СБП-QR: товарная сумма (без чаевых/надбавки), момент выставления и id
  // транзакции эквайера. Вебхук по этой транзакции закрывает чек на сумму QR, а
  // аренду завершает в момент QR (живая аренда не «тикает» до оплаты). См. 073_*.sql.
  sbpQrAmount: numeric('sbp_qr_amount', { precision: 12, scale: 2 }),
  sbpQrAt: timestamp('sbp_qr_at', { withTimezone: true }),
  sbpQrTxId: text('sbp_qr_tx_id'),
  // Фактически начисленные бонусы при закрытии чека (0 — не начислялись). По нему
  // возврат откатывает начисление; NULL — старые чеки (прежняя формула). См. 075_*.sql.
  bonusAwarded: numeric('bonus_awarded', { precision: 12, scale: 2 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  closedAt: timestamp('closed_at', { withTimezone: true }),
})

export const checkItems = pgTable('check_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  checkId: uuid('check_id')
    .notNull()
    .references(() => checks.id, { onDelete: 'cascade' }),
  itemId: uuid('item_id')
    .notNull()
    .references(() => inventory.id),
  quantity: integer('quantity').notNull().default(1),
  priceAtTime: numeric('price_at_time', { precision: 10, scale: 2 }).notNull(),
})

// Заказы гостя с планшета, ожидающие подтверждения сотрудником. Гость отправляет
// заказ → строка pending → уведомление персоналу. Сотрудник на экране чека
// подтверждает (позиции добавляются в чек) или отклоняет. Гость может отменить
// свой ещё не подтверждённый заказ. items — снимок состава на момент заказа.
// См. 029_pending_orders.sql.
export const pendingOrders = pgTable('pending_orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  checkId: uuid('check_id')
    .notNull()
    .references(() => checks.id, { onDelete: 'cascade' }),
  spaceId: uuid('space_id').references(() => spaces.id),
  // pending | confirmed | rejected | cancelled
  status: text('status').notNull().default('pending'),
  items: jsonb('items')
    .$type<{ itemId: string; name: string; quantity: number; price: string }[]>()
    .notNull()
    .default([]),
  createdBy: uuid('created_by').references(() => profiles.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  resolvedBy: uuid('resolved_by').references(() => profiles.id),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
})

// Чат между гостем (планшет кабинки) и персоналом в рамках одного визита (чека).
// sender: 'guest' (с планшета) | 'staff' (из кассы). См. 030_chat_messages.sql.
export const chatMessages = pgTable('chat_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  checkId: uuid('check_id')
    .notNull()
    .references(() => checks.id, { onDelete: 'cascade' }),
  spaceId: uuid('space_id').references(() => spaces.id),
  sender: text('sender').notNull(),
  senderId: uuid('sender_id').references(() => profiles.id),
  text: text('text').notNull(),
  // Заполняется, когда противоположная сторона открыла чат (отметка «прочитано»).
  readAt: timestamp('read_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// Оценка вечера гостем на планшете Titan Home (после оплаты/закрытия счёта).
// Одна на чек (уникальный check_id). См. 066_titan_home.sql.
export const guestFeedback = pgTable('guest_feedback', {
  id: uuid('id').primaryKey().defaultRandom(),
  checkId: uuid('check_id')
    .notNull()
    .references(() => checks.id, { onDelete: 'cascade' }),
  spaceId: uuid('space_id').references(() => spaces.id, { onDelete: 'set null' }),
  rating: smallint('rating').notNull(),
  tags: text('tags').array().notNull().default([]),
  comment: text('comment'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const checkItemModifiers = pgTable('check_item_modifiers', {
  id: uuid('id').primaryKey().defaultRandom(),
  checkItemId: uuid('check_item_id')
    .notNull()
    .references(() => checkItems.id, { onDelete: 'cascade' }),
  modifierId: uuid('modifier_id')
    .notNull()
    .references(() => modifiers.id),
  priceAtTime: numeric('price_at_time', { precision: 10, scale: 2 }).notNull(),
})

export const checkPayments = pgTable('check_payments', {
  id: uuid('id').primaryKey().defaultRandom(),
  checkId: uuid('check_id')
    .notNull()
    .references(() => checks.id, { onDelete: 'cascade' }),
  method: paymentMethodEnum('method').notNull(),
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
})

export const discountTypeEnum = pgEnum('discount_type', ['percent', 'fixed'])
export const discountTargetEnum = pgEnum('discount_target', ['check', 'item'])

export const checkDiscounts = pgTable('check_discounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  checkId: uuid('check_id')
    .notNull()
    .references(() => checks.id, { onDelete: 'cascade' }),
  discountId: uuid('discount_id'),
  name: text('name').notNull(),
  type: discountTypeEnum('type').notNull(),
  value: numeric('value', { precision: 10, scale: 2 }).notNull(),
  amount: numeric('amount', { precision: 10, scale: 2 }).notNull(),
  target: discountTargetEnum('target').notNull().default('check'),
  itemId: uuid('item_id'),
  clientRuleId: uuid('client_rule_id'),
})

export type Check = typeof checks.$inferSelect
export type NewCheck = typeof checks.$inferInsert
export type CheckItem = typeof checkItems.$inferSelect
export type NewCheckItem = typeof checkItems.$inferInsert
export type CheckPayment = typeof checkPayments.$inferSelect
export type NewCheckPayment = typeof checkPayments.$inferInsert
export type CheckDiscount = typeof checkDiscounts.$inferSelect
