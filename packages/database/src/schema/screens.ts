import { pgTable, uuid, text, integer, timestamp } from 'drizzle-orm/pg-core'

// «Экраны» (миграция 068): телевизоры клуба с приложением Titan Menu, у каждого свои
// настройки. kind 'menu' — меню с лентой тарифов и рекламой; 'slideshow' — картинки.
// rotation — как висит ТВ. device_* — привязанная приставка (токен хранится хэшем),
// pairing_* — одноразовый секрет привязки, который телефон передаёт приставке.
export const screens = pgTable('screens', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  kind: text('kind').$type<'menu' | 'slideshow'>().notNull().default('menu'),
  rotation: integer('rotation').notNull().default(0),
  theme: text('theme').notNull().default('night'),
  bandSec: integer('band_sec').notNull().default(20),
  sortOrder: integer('sort_order').notNull().default(0),
  deviceId: text('device_id'),
  deviceModel: text('device_model'),
  appVersion: text('app_version'),
  deviceIp: text('device_ip'),
  deviceTokenHash: text('device_token_hash'),
  pairedAt: timestamp('paired_at', { withTimezone: true }),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  pairingHash: text('pairing_hash'),
  pairingExpiresAt: timestamp('pairing_expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export type Screen = typeof screens.$inferSelect
