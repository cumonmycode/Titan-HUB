import { pgTable, uuid, text, boolean, timestamp, integer, bigserial, jsonb } from 'drizzle-orm/pg-core'
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

// История чатов с Tai в Titan HUB (миграция 083): у каждого сотрудника свои чаты.
export const taiChats = pgTable('tai_chats', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => profiles.id),
  title: text('title').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// Реплики чата: вопрос или ответ Tai с блоками интерфейса (карточки обновляются при нажатии).
export const taiChatTurns = pgTable('tai_chat_turns', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  chatId: uuid('chat_id').notNull().references(() => taiChats.id, { onDelete: 'cascade' }),
  role: text('role').$type<'user' | 'assistant'>().notNull(),
  content: text('content').notNull(),
  blocks: jsonb('blocks').$type<unknown[]>().notNull().default([]),
  memo: text('memo'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export type TaiChat = typeof taiChats.$inferSelect
export type TaiChatTurn = typeof taiChatTurns.$inferSelect
