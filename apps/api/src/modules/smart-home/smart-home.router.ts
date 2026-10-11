/**
 * Умный дом в Titan HUB: свет и кондиционеры помещений клуба (коридор, кабинки, зал,
 * туалет) — на главной кассы, в шторке, которую вытягивают сверху.
 *
 * Home Assistant стоит в локальной сети клуба, сервер Titan до него не достаёт: телефон
 * или iPad кассира подключается к нему сам (WebSocket API HA) долгосрочным токеном.
 * Токен у HUB СВОЙ, не тот, что у планшетов Titan Home (интеграция hub_ha_token): его
 * можно выпустить от отдельного пользователя HA и отозвать, не трогая кабинки. Адрес —
 * свой (hub_ha_url) или, если не задан, тот же, что у планшетов (ha_url).
 *
 * Токен отдаём персоналу (owner, staff) — осознанное исключение из правила «секреты не
 * покидают сервер», как и для планшетов: устройства управляют HA напрямую. Владельцу
 * советуем отдельного пользователя HA без прав администратора.
 *
 * Зоны — список помещений с устройствами, правит владелец в приложении («Настройки →
 * Интеграции → Home Assistant»). Хранятся в app_settings клуба одним JSON
 * (hub_smart_home_zones) — без отдельной таблицы, как опросы. Пока владелец ничего не
 * сохранил, отдаём стандартный набор зон без устройств.
 */
import type { AppEnv } from '../../types.js'
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { appSettings, integrations, eq, inArray } from '@titan/database'
import { requireAuth, requireRole } from '../../middleware/auth.js'
import { encryptSecret, getClubIntegration } from '../../lib/secrets.js'
import { publishEvent } from '../../lib/realtime.js'

export const smartHomeRouter = new Hono<AppEnv>()

const ZONES_KEY = 'hub_smart_home_zones'
const URL_KEY = 'hub_ha_url'
const TOKEN_KEY = 'hub_ha_token'
/** Адрес планшетов Titan Home — запасной, если у HUB свой не задан. */
const TABLET_URL_KEY = 'ha_url'

const MAX_ZONES = 24
const MAX_LIGHTS = 16
const MAX_CLIMATES = 4

const deviceSchema = (domain: RegExp) =>
  z.object({
    entityId: z.string().max(120).regex(domain, 'Неподходящее устройство Home Assistant'),
    name: z.string().trim().min(1).max(40),
  })

// Свет — лампы, группы и выключатели (реле света часто заведены как switch/input_boolean).
const LIGHT_ENTITY = /^(light|switch|input_boolean)\.[a-z0-9_]+$/
const CLIMATE_ENTITY = /^climate\.[a-z0-9_]+$/

const ZoneSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),
  name: z.string().trim().min(1, 'Назовите помещение').max(40),
  lights: z.array(deviceSchema(LIGHT_ENTITY)).max(MAX_LIGHTS),
  climates: z.array(deviceSchema(CLIMATE_ENTITY)).max(MAX_CLIMATES),
})

type SmartZone = z.infer<typeof ZoneSchema>

const ZonesSchema = z.object({
  zones: z
    .array(ZoneSchema)
    .max(MAX_ZONES)
    .refine((zones) => new Set(zones.map((zone) => zone.id)).size === zones.length, 'Повторяется помещение'),
})

const ConnectionSchema = z.object({
  url: z
    .string()
    .trim()
    .max(300)
    .regex(/^https?:\/\/[^\s/?#]+(\/[^\s?#]*)?$/i, 'Адрес вида http://192.168.1.50:8123'),
  // Не прислали — токен не меняем (поле в приложении показывает, что токен уже есть).
  token: z.string().trim().min(20, 'Это не похоже на токен Home Assistant').max(500).optional(),
})

/** Помещения клуба по умолчанию (решение владельца 2026-10-08). */
const DEFAULT_ZONES: SmartZone[] = [
  { id: 'corridor', name: 'Коридор', lights: [], climates: [] },
  { id: 'booth-small', name: 'Маленькая кабинка', lights: [], climates: [] },
  { id: 'booth-large', name: 'Большая кабинка', lights: [], climates: [] },
  { id: 'hall', name: 'Зал', lights: [], climates: [] },
  { id: 'toilet', name: 'Туалет', lights: [], climates: [] },
]

type Db = AppEnv['Variables']['db']

async function readZones(db: Db): Promise<{ zones: SmartZone[]; saved: boolean }> {
  const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, ZONES_KEY))
  if (!row?.value) return { zones: DEFAULT_ZONES, saved: false }
  try {
    const parsed = ZonesSchema.safeParse({ zones: JSON.parse(row.value) })
    if (parsed.success) return { zones: parsed.data.zones, saved: true }
  } catch {
    // Испорченный JSON (правка руками через /system/settings) — ниже отдаём стандартные зоны.
  }
  console.error('[smart-home] hub_smart_home_zones не читается — отдаю помещения по умолчанию')
  return { zones: DEFAULT_ZONES, saved: false }
}

/** Другие телефоны и iPad клуба перечитывают настройки умного дома сразу. */
const announce = (clubId: string | null | undefined) => publishEvent(clubId, 'smart-home:updated', {})

// GET /smart-home — подключение к HA и помещения с устройствами. Персонал управляет
// светом с кассы, поэтому токен получают и сотрудники.
smartHomeRouter.get('/', requireAuth, requireRole('owner', 'staff'), async (c) => {
  const db = c.var.db
  const [hubUrl, tabletUrl, token, zones] = await Promise.all([
    getClubIntegration(db, URL_KEY),
    getClubIntegration(db, TABLET_URL_KEY),
    getClubIntegration(db, TOKEN_KEY),
    readZones(db),
  ])
  return c.json({
    url: hubUrl ?? tabletUrl,
    urlSource: hubUrl ? 'hub' : tabletUrl ? 'tablet' : null,
    token,
    zones: zones.zones,
    zonesSaved: zones.saved,
  })
})

// PUT /smart-home/connection — адрес и (если прислан) токен HUB. Только владелец.
smartHomeRouter.put('/connection', requireAuth, requireRole('owner'), zValidator('json', ConnectionSchema), async (c) => {
  const db = c.var.db
  const user = c.get('user')
  const { url, token } = c.req.valid('json')
  const rows = [{ key: URL_KEY, value: url.replace(/\/+$/, '') }, ...(token ? [{ key: TOKEN_KEY, value: token }] : [])]
  for (const row of rows) {
    const valueEnc = encryptSecret(row.value)
    await db
      .insert(integrations)
      .values({ key: row.key, valueEnc, updatedBy: user.sub })
      .onConflictDoUpdate({ target: integrations.key, set: { valueEnc, updatedAt: new Date(), updatedBy: user.sub } })
  }
  announce(c.var.club?.id)
  return c.json({ ok: true })
})

// DELETE /smart-home/connection — отключить HUB от Home Assistant (планшеты не трогаем).
smartHomeRouter.delete('/connection', requireAuth, requireRole('owner'), async (c) => {
  await c.var.db.delete(integrations).where(inArray(integrations.key, [URL_KEY, TOKEN_KEY]))
  announce(c.var.club?.id)
  return c.json({ ok: true })
})

// PUT /smart-home/zones — список помещений целиком (порядок = порядок в шторке).
smartHomeRouter.put('/zones', requireAuth, requireRole('owner'), zValidator('json', ZonesSchema), async (c) => {
  const { zones } = c.req.valid('json')
  const value = JSON.stringify(zones)
  await c.var.db
    .insert(appSettings)
    .values({ key: ZONES_KEY, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } })
  announce(c.var.club?.id)
  return c.json({ zones })
})
