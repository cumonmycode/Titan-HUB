/**
 * Настройки сайта клуба в app_settings: контакты, домен и чат персонала для
 * заявок. Правит владелец в HUB («Сайт»), читают публичный /api/site/config,
 * уведомления по заявкам и агент домена на сервере (scripts/site/domain-agent.sh).
 */
import { z } from 'zod'
import { appSettings, inArray, type Database } from '@titan/database'

export const SITE_CONTACTS_KEY = 'site_contacts'
export const SITE_DOMAIN_KEY = 'site_domain'
export const SITE_DOMAIN_PRIMARY_KEY = 'site_domain_primary'
/** Статус подключения домена — пишет агент на сервере (DNS, сертификат). */
export const SITE_DOMAIN_STATUS_KEY = 'site_domain_status'
/** Чат персонала в Telegram для заявок: { chatId, threadId }. */
export const REQUESTS_CHAT_KEY = 'requests_tg_chat'

const httpsUrl = z.string().trim().max(300).refine((v) => v === '' || /^https:\/\/\S+$/.test(v), 'Нужна ссылка https://')

export const SiteContactsSchema = z.object({
  phone: z.string().trim().max(30).default(''),
  email: z.string().trim().max(120).refine((v) => v === '' || /^\S+@\S+\.\S+$/.test(v), 'Почта указана неверно').default(''),
  telegram: httpsUrl.default(''),
  channel: httpsUrl.default(''),
  whatsapp: httpsUrl.default(''),
  vk: httpsUrl.default(''),
  instagram: httpsUrl.default(''),
})
export type SiteContacts = z.infer<typeof SiteContactsSchema>

export const EMPTY_CONTACTS: SiteContacts = { phone: '', email: '', telegram: '', channel: '', whatsapp: '', vk: '', instagram: '' }

export const DOMAIN_RE = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/
export type DomainPrimary = 'www' | 'apex'

export interface RequestsChat { chatId: string; threadId: number | null }

export interface DomainStatus {
  domain: string | null
  cert: 'none' | 'pending' | 'active' | 'error'
  expiresAt: string | null
  error: string | null
  checkedAt: string | null
}

function parseJson<T>(raw: string | undefined, fallback: T): T {
  if (!raw) return fallback
  try { return JSON.parse(raw) as T } catch { return fallback }
}

async function readKeys(db: Database, keys: string[]): Promise<Record<string, string>> {
  const rows = await db.select().from(appSettings).where(inArray(appSettings.key, keys))
  return Object.fromEntries(rows.map((r) => [r.key, r.value]))
}

export async function readSiteContacts(db: Database): Promise<SiteContacts> {
  const m = await readKeys(db, [SITE_CONTACTS_KEY])
  const parsed = SiteContactsSchema.safeParse(parseJson<unknown>(m[SITE_CONTACTS_KEY], {}))
  return parsed.success ? parsed.data : EMPTY_CONTACTS
}

export interface SiteDomain { domain: string | null; primary: DomainPrimary; url: string | null; status: DomainStatus | null }

/** Домен сайта и его канонический адрес (https://www.<домен> или https://<домен>). */
export async function readSiteDomain(db: Database): Promise<SiteDomain> {
  const m = await readKeys(db, [SITE_DOMAIN_KEY, SITE_DOMAIN_PRIMARY_KEY, SITE_DOMAIN_STATUS_KEY])
  const domain = DOMAIN_RE.test(m[SITE_DOMAIN_KEY] ?? '') ? m[SITE_DOMAIN_KEY]! : null
  const primary: DomainPrimary = m[SITE_DOMAIN_PRIMARY_KEY] === 'apex' ? 'apex' : 'www'
  const url = domain ? `https://${primary === 'www' ? `www.${domain}` : domain}` : null
  const status = parseJson<DomainStatus | null>(m[SITE_DOMAIN_STATUS_KEY], null)
  return { domain, primary, url, status }
}

export async function readRequestsChat(db: Database): Promise<RequestsChat | null> {
  const m = await readKeys(db, [REQUESTS_CHAT_KEY])
  const v = parseJson<Partial<RequestsChat> | null>(m[REQUESTS_CHAT_KEY], null)
  if (!v || typeof v.chatId !== 'string' || !v.chatId) return null
  return { chatId: v.chatId, threadId: typeof v.threadId === 'number' ? v.threadId : null }
}
