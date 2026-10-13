import { pgTable, uuid, text, numeric, timestamp, boolean, integer, pgEnum, primaryKey } from 'drizzle-orm/pg-core'
import { profiles } from './profiles.js'

export const shiftStatusEnum = pgEnum('shift_status', ['open', 'closed'])
// evening_type больше НЕ enum: типы вечеров — управляемый справочник evening_types
// (миграция 025). shifts.evening_type теперь text (хранит key типа вечера).
export const eveningTypeEnum = pgEnum('evening_type', [
  'sport_mafia',
  'city_mafia',
  'kids_mafia',
  'board_games',
  'none',
])

// Справочник типов вечеров (управляется владельцем: создание/удаление, без цены).
export const eveningTypes = pgTable('evening_types', {
  key: text('key').primaryKey(),
  label: text('label').notNull(),
  color: text('color').notNull().default('#8B5CF6'),
  sortOrder: integer('sort_order').notNull().default(0),
  isSystem: boolean('is_system').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const shifts = pgTable('shifts', {
  id: uuid('id').primaryKey().defaultRandom(),
  openedBy: uuid('opened_by')
    .notNull()
    .references(() => profiles.id),
  closedBy: uuid('closed_by').references(() => profiles.id),
  status: shiftStatusEnum('status').notNull().default('open'),
  cashStart: numeric('cash_start', { precision: 12, scale: 2 }).notNull().default('0'),
  cashEnd: numeric('cash_end', { precision: 12, scale: 2 }),
  // text + справочник evening_types (типы вечеров динамические, миграция 025).
  eveningType: text('evening_type').notNull().default('none'),
  note: text('note'),
  openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
  closedAt: timestamp('closed_at', { withTimezone: true }),
})

// Кто работает на смене (миграция 084): выбирают при открытии, правят до закрытия.
// Зарплату за смену получают только они.
export const shiftStaff = pgTable('shift_staff', {
  shiftId: uuid('shift_id').notNull().references(() => shifts.id, { onDelete: 'cascade' }),
  profileId: uuid('profile_id').notNull().references(() => profiles.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.shiftId, t.profileId] })])

export type Shift = typeof shifts.$inferSelect
export type NewShift = typeof shifts.$inferInsert
export type EveningType = typeof eveningTypes.$inferSelect
