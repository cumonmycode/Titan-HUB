import { pgTable, uuid, text, boolean, timestamp, integer, bigserial } from 'drizzle-orm/pg-core'
import { profiles } from './profiles.js'

/** Во что играет человек: спортивная, городская или обе мафии. */
export type TaiGames = 'sport' | 'city' | 'both'

// Собеседники Tai в личке (миграция 082): кто это и что Tai о нём помнит.
export const taiContacts = pgTable('tai_contacts', {
  tgId: text('tg_id').primaryKey(),
  profileId: uuid('profile_id').references(() => profiles.id),
  firstName: text('first_name'),
  username: text('username'),
  // false — человек заблокировал бота: первым не пишем.
  dmOpen: boolean('dm_open').notNull().default(true),
  games: text('games').$type<TaiGames>(),
  notes: text('notes'),
  optedOut: boolean('opted_out').notNull().default(false),
  remindKind: text('remind_kind'),
  remindAt: timestamp('remind_at', { withTimezone: true }),
  followups: integer('followups').notNull().default(0),
  lastInboundAt: timestamp('last_inbound_at', { withTimezone: true }),
  lastOutboundAt: timestamp('last_outbound_at', { withTimezone: true }),
  lastProactiveAt: timestamp('last_proactive_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// История диалогов Tai: личка (chat_id = tg_id) и рабочий чат персонала.
export const taiMessages = pgTable('tai_messages', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  chatId: text('chat_id').notNull(),
  tgId: text('tg_id'),
  role: text('role').$type<'user' | 'assistant'>().notNull(),
  content: text('content').notNull(),
  voice: boolean('voice').notNull().default(false),
  memo: text('memo'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export type TaiContact = typeof taiContacts.$inferSelect
