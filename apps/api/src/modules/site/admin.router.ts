/**
 * Управление сайтом клуба из HUB (только владелец), монтируется в /api/system:
 *
 *  GET/PUT /site-config — праздник, расписание вечеров, контакты клуба и чат
 *                         персонала в Telegram для заявок (+ список чатов, где
 *                         есть бот, и готовность ботов);
 *  GET/PUT /site-domain — домен сайта: DNS-записи, их проверка, статус
 *                         сертификата. Сертификат и конфиг nginx делает агент на
 *                         сервере (scripts/site/domain-agent.sh) раз в 5 минут.
 *
 * Сайт читает всё через публичный /api/site/config (кэш 60 с).
 */
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { Resolver } from 'node:dns/promises'
import { appSettings, eq, inArray, type Database } from '@titan/database'
import type { AppEnv } from '../../types.js'
import { requireAuth, requireRole } from '../../middleware/auth.js'
import { getClubIntegration } from '../../lib/secrets.js'
import { listChats } from '../../lib/tgChats.js'
import { getClientBot } from '../requests/clientBot.js'
import { SITE_HOLIDAYS, isSiteHoliday, parseSchedule } from './site.router.js'
import {
  DOMAIN_RE, REQUESTS_CHAT_KEY, SITE_CONTACTS_KEY, SITE_DOMAIN_KEY, SITE_DOMAIN_PRIMARY_KEY, SITE_LINKS_KEY, SiteContactsSchema, SiteLinksSchema,
  readRequestsChat, readSiteContacts, readSiteDomain, readSiteLinks,
} from './settings.js'

const ROOT_DOMAIN = (process.env['ROOT_DOMAIN'] || 'titanpos.ru').toLowerCase()
const SITE_MIRROR = process.env['SITE_MIRROR_URL'] || 'https://site.titanpos.ru'
const DNS_SERVERS = ['77.88.8.8', '8.8.8.8']
const DNS_TIMEOUT_MS = 3000

export const siteAdminSettingsRouter = new Hono<AppEnv>()
const owner = [requireAuth, requireRole('owner')] as const

function upsert(db: Database, key: string, value: string) {
  return db.insert(appSettings).values({ key, value }).onConflictDoUpdate({ target: appSettings.key, set: { value } })
}

// ─── Таплинк (/link): кнопки для соцсетей ────────────────────────────────────
siteAdminSettingsRouter.get('/site-links', ...owner, async (c) => {
  const db = c.var.db
  const [links, domain, contacts, bot] = await Promise.all([
    readSiteLinks(db), readSiteDomain(db), readSiteContacts(db), getClientBot(db).catch(() => null),
  ])
  const base = domain.url ?? SITE_MIRROR
  return c.json({ ...links, pageUrl: `${base}/link`, contacts, taiUrl: bot?.username ? `https://t.me/${bot.username}` : null })
})

siteAdminSettingsRouter.put('/site-links', ...owner, zValidator('json', SiteLinksSchema), async (c) => {
  const body = c.req.valid('json')
  const ids = new Set<string>()
  for (const l of body.links) {
    if (ids.has(l.id)) return c.json({ error: 'Повторяющиеся кнопки' }, 400)
    ids.add(l.id)
    if (l.kind === 'custom' && (!l.label || !l.url)) return c.json({ error: 'У своей ссылки нужны название и адрес https://' }, 400)
  }
  await upsert(c.var.db, SITE_LINKS_KEY, JSON.stringify(body))
  return c.json({ ok: true })
})

// ─── Оформление, расписание, контакты, уведомления ───────────────────────────
siteAdminSettingsRouter.get('/site-config', ...owner, async (c) => {
  const db = c.var.db
  const rows = await db.select().from(appSettings).where(inArray(appSettings.key, ['site_holiday', 'site_schedule']))
  const m = Object.fromEntries(rows.map((r) => [r.key, r.value]))
  const [contacts, notifyChat, chats, staffBot, guestBot] = await Promise.all([
    readSiteContacts(db),
    readRequestsChat(db),
    listChats(db),
    getClubIntegration(db, 'poll_bot_token').then(Boolean).catch(() => false),
    getClientBot(db).then((b) => b?.username ?? null).catch(() => null),
  ])
  return c.json({
    holiday: isSiteHoliday(m['site_holiday']) ? m['site_holiday'] : null,
    holidays: SITE_HOLIDAYS,
    schedule: parseSchedule(m['site_schedule']),
    contacts,
    notifyChat,
    chats,
    staffBot,
    guestBot,
  })
})

const SiteConfigSchema = z.object({
  // null — снять праздник (обычный вид сайта).
  holiday: z.enum(SITE_HOLIDAYS).nullable().optional(),
  schedule: z.array(z.object({
    day: z.number().int().min(1).max(7),
    title: z.string().trim().min(1).max(60),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  })).max(14).nullable().optional(),
  contacts: SiteContactsSchema.optional(),
  // null — не писать заявки в Telegram-чат персонала.
  notifyChat: z.object({ chatId: z.string().trim().min(1).max(64), threadId: z.number().int().nullable() }).nullable().optional(),
})

siteAdminSettingsRouter.put('/site-config', ...owner, zValidator('json', SiteConfigSchema), async (c) => {
  const db = c.var.db
  const body = c.req.valid('json')
  if (body.holiday !== undefined) {
    if (body.holiday === null) await db.delete(appSettings).where(eq(appSettings.key, 'site_holiday'))
    else await upsert(db, 'site_holiday', body.holiday)
  }
  if (body.schedule !== undefined) {
    if (body.schedule === null) await db.delete(appSettings).where(eq(appSettings.key, 'site_schedule'))
    else await upsert(db, 'site_schedule', JSON.stringify([...body.schedule].sort((a, b) => a.day - b.day)))
  }
  if (body.contacts) await upsert(db, SITE_CONTACTS_KEY, JSON.stringify(body.contacts))
  if (body.notifyChat !== undefined) {
    if (body.notifyChat === null) await db.delete(appSettings).where(eq(appSettings.key, REQUESTS_CHAT_KEY))
    else await upsert(db, REQUESTS_CHAT_KEY, JSON.stringify(body.notifyChat))
  }
  return c.json({ ok: true })
})

// ─── Домен ───────────────────────────────────────────────────────────────────
async function resolveA(name: string): Promise<string[]> {
  const resolver = new Resolver({ timeout: DNS_TIMEOUT_MS, tries: 1 })
  resolver.setServers(DNS_SERVERS)
  try { return (await resolver.resolve4(name)).sort() } catch { return [] }
}

// IP сервера, куда должен смотреть домен: PUBLIC_IP или A-запись основного домена HUB.
async function serverIp(): Promise<string | null> {
  const env = process.env['PUBLIC_IP']
  if (env) return env
  return (await resolveA(ROOT_DOMAIN))[0] ?? null
}

async function domainPayload(db: Database) {
  const d = await readSiteDomain(db)
  const ip = await serverIp()
  const [apex, www] = d.domain ? await Promise.all([resolveA(d.domain), resolveA(`www.${d.domain}`)]) : [[], []]
  const ok = (ips: string[]) => !!ip && ips.length > 0 && ips.every((x) => x === ip)
  return {
    domain: d.domain,
    primary: d.primary,
    url: d.url,
    mirror: SITE_MIRROR,
    serverIp: ip,
    dns: { apex: { ips: apex, ok: ok(apex) }, www: { ips: www, ok: ok(www) } },
    // Статус агента относится только к текущему домену (после смены домена — ждём новый).
    cert: d.status && d.status.domain === d.domain ? d.status : null,
  }
}

siteAdminSettingsRouter.get('/site-domain', ...owner, async (c) => c.json(await domainPayload(c.var.db)))

/** «https://www.Club.ru/path» → «club.ru». */
function normalizeDomain(raw: string): string {
  return raw.trim().toLowerCase().replace(/^[a-z]+:\/\//, '').split(/[/?#]/)[0]!.replace(/^www\./, '').replace(/\.$/, '')
}

const DomainSchema = z.object({
  domain: z.string().max(260).nullable(),
  primary: z.enum(['www', 'apex']).default('www'),
})

siteAdminSettingsRouter.put('/site-domain', ...owner, zValidator('json', DomainSchema), async (c) => {
  const db = c.var.db
  const { domain: raw, primary } = c.req.valid('json')
  if (raw === null || raw.trim() === '') {
    await db.delete(appSettings).where(inArray(appSettings.key, [SITE_DOMAIN_KEY, SITE_DOMAIN_PRIMARY_KEY]))
    return c.json(await domainPayload(db))
  }
  const domain = normalizeDomain(raw)
  if (!DOMAIN_RE.test(domain)) return c.json({ error: 'Домен указан неверно — например, titanmafia.ru' }, 400)
  if (domain === ROOT_DOMAIN || domain.endsWith(`.${ROOT_DOMAIN}`)) {
    return c.json({ error: `Адреса ${ROOT_DOMAIN} заняты HUB — укажите домен клуба` }, 400)
  }
  await upsert(db, SITE_DOMAIN_KEY, domain)
  await upsert(db, SITE_DOMAIN_PRIMARY_KEY, primary)
  return c.json(await domainPayload(db))
})
