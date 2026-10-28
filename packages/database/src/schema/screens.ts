import { pgTable, uuid, text, integer, timestamp, boolean, jsonb, type AnyPgColumn } from 'drizzle-orm/pg-core'

/** Живое состояние ТВ в кабинке из его пульса (миграция 091). */
export type ScreenDeviceState = {
  /** Что на экране: главный, заставка, кинозал, другое приложение или вход HDMI. */
  screen: 'home' | 'saver' | 'cinema' | 'app' | 'input'
  /** Название приложения или входа, когда screen — 'app' или 'input'. */
  app?: string | null
  airplay?: { title: string; artist: string; client: string; playing: boolean } | null
  volume?: { level: number; max: number; muted: boolean } | null
  /** Связь со «Светом и климатом» (Home Assistant). */
  ha?: 'connected' | 'connecting' | 'offline' | 'auth_failed' | 'idle' | null
}

// «Экраны» (миграция 068): телевизоры клуба с приложением Titan Menu, у каждого свои
// настройки. kind 'menu' — меню с лентой тарифов и рекламой; 'slideshow' — картинки.
// rotation — как висит ТВ. device_* — привязанная приставка (токен хранится хэшем),
// pairing_* — одноразовый секрет привязки, который телефон передаёт приставке.
// С миграции 091 привязать можно и ТВ кабинки (device_app 'launcher', Titan TV): у него
// пульт из HUB, состояние device_state и реклама ads_* на главном экране и заставке.
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
  deviceApp: text('device_app').$type<'menu' | 'launcher'>(),
  deviceState: jsonb('device_state').$type<ScreenDeviceState>(),
  adsEnabled: boolean('ads_enabled').notNull().default(true),
  adsScreenId: uuid('ads_screen_id').references((): AnyPgColumn => screens.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export type Screen = typeof screens.$inferSelect
