// ─────────────────────────────────────────────────────────────────────────────
// Резолвер клуба по Host (database-per-club). Используется в middleware
// tenantContext: по поддомену <slug>.<ROOT_DOMAIN> находит запись клуба в
// control-plane и строит строку подключения к его app-БД.
//
// Цели:
//   • Быстрый путь для основного/служебного домена — БЕЗ обращения к control-БД
//     (см. isDefaultHost): поведение на titanpos.ru идентично прежнему синглтону.
//   • Кэш host→клуб с коротким TTL, чтобы не бить control-БД на каждый запрос
//     (кэшируем и «нет такого клуба» = null, чтобы не долбить БД промахами).
//
// Control-БД импортируется по относительному пути к собранному dist (закрытый
// exports-map пакета @titan/database не публикует subpath) — тот же приём, что в
// sibling-модулях superadmin (../../../../../packages/.../control/index.js от
// modules/superadmin; отсюда, из src/lib, корректный путь — '../../../../packages/...').
// ─────────────────────────────────────────────────────────────────────────────
import {
  getControlDb,
  clubs,
  subscriptions,
  clubModules,
  eq,
  desc,
} from '../../../../packages/database/dist/control/index.js'
// Пул БД клуба по строке подключения (тот же helper, что использует middleware
// tenantContext). Нужен для резолва БД клуба из внешнего вебхука по clubId, когда
// поддомена нет (Platega бьёт в фиксированный URL основного домена).
import { getClubDb } from '@titan/database'
import type { Database } from '@titan/database'

// Базовый домен платформы. На нём (и служебных поддоменах) — дефолтный синглтон.
const ROOT_DOMAIN = (process.env['ROOT_DOMAIN'] || 'titanpos.ru').toLowerCase()

// Служебные поддомены первого уровня (НЕ клубы): admin → суперадмин-контур,
// mafboard → сервер приложения MafBoard (docs/MAFBOARD.md).
const RESERVED_LABELS = new Set(['admin', 'mafboard'])

// Подписка клуба (минимум для энфорсмента доступа). paidUntil — дата окончания
// оплаченного периода (null = бессрочно/не задана).
export interface ClubSubscriptionInfo {
  status: string
  paidUntil: Date | null
}

// Резолвленный клуб. Кроме данных для подстановки БД несёт подписку и фиче-флаги
// модулей (для энфорсмента подписки/модулей на клуб-поддомене).
//   • subscription === undefined — обогащение НЕ удалось (control-БД моргнула) →
//     энфорсмент FAIL-OPEN (доступность важнее: не блокируем платящий клуб из-за
//     транзиентной ошибки).
//   • subscription === null      — подписки нет (клуб не настроен) → блок.
//   • modules                    — { ключ_модуля: enabled }. Отсутствие ключа =
//     модуль доступен (энфорсмент режет только при ЯВНОМ enabled=false).
export interface ResolvedClub {
  id: string
  slug: string
  name: string
  dbName: string
  subscription: ClubSubscriptionInfo | null | undefined
  modules: Record<string, boolean>
}

// ─── Кэш host → клуб (или null = «нет такого клуба») с коротким TTL ──────────
interface CacheEntry {
  value: ResolvedClub | null
  expiresAt: number
}
const CACHE_TTL_MS = 60_000 // 60с: компромисс «свежесть реестра ↔ нагрузка на control-БД»
const cache = new Map<string, CacheEntry>()

/**
 * Нормализовать Host: нижний регистр, убрать порт (':3000') и завершающую точку.
 * Пустой/отсутствующий host → пустая строка.
 */
export function normalizeHost(rawHost: string | undefined | null): string {
  if (!rawHost) return ''
  let h = rawHost.trim().toLowerCase()
  // Отрезаем порт. Осторожно с IPv6 в скобках ('[::1]:3000') — берём до ']' + порт.
  if (h.startsWith('[')) {
    const close = h.indexOf(']')
    if (close !== -1) h = h.slice(0, close + 1)
  } else {
    const colon = h.indexOf(':')
    if (colon !== -1) h = h.slice(0, colon)
  }
  // Завершающая точка в FQDN ('club.titanpos.ru.') — нормализуем.
  if (h.endsWith('.')) h = h.slice(0, -1)
  return h
}

/**
 * Похоже ли на IP-адрес (IPv4 или IPv6) — такие хосты в быстрый путь (дефолт).
 */
function isIpAddress(host: string): boolean {
  if (host.startsWith('[') || host.includes(':')) return true // IPv6 (в скобках или с ':')
  // IPv4: четыре числовые группы.
  return /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)
}

/**
 * БЫСТРЫЙ ПУТЬ: основной/служебный домен → дефолтный синглтон (club=null),
 * БЕЗ обращения к control-БД. Сюда относятся:
 *   • пусто;
 *   • localhost / IP-адрес (dev, прямой доступ по адресу);
 *   • ровно базовый домен (titanpos.ru) и www.<base>;
 *   • служебные поддомены (admin.<base> — суперадмин).
 *
 * Возвращает true ⇒ middleware должен поставить синглтон и НЕ ходить в control-БД.
 */
export function isDefaultHost(host: string): boolean {
  if (!host) return true
  if (host === 'localhost') return true
  if (isIpAddress(host)) return true
  if (host === ROOT_DOMAIN) return true
  if (host === `www.${ROOT_DOMAIN}`) return true

  // Поддомен базового домена: '<label>.<...>.titanpos.ru'.
  if (host.endsWith(`.${ROOT_DOMAIN}`)) {
    const label = host.slice(0, host.length - ROOT_DOMAIN.length - 1).split('.')[0] ?? ''
    if (RESERVED_LABELS.has(label)) return true
    return false // настоящий поддомен клуба → дефолтным НЕ считаем
  }

  // Host НЕ принадлежит базовому домену (кастомный/неизвестный) → дефолт-синглтон
  // (НЕ резолвим клуб по чужому домену — на шаге 3 это потенциальный риск чужой БД).
  return true
}

/**
 * Извлечь slug (первая метка) из host вида '<slug>.<...>.<ROOT_DOMAIN>'.
 * Пусто, если host не является поддоменом базового домена.
 */
function extractSlug(host: string): string {
  if (!host.endsWith(`.${ROOT_DOMAIN}`)) return ''
  const sub = host.slice(0, host.length - ROOT_DOMAIN.length - 1)
  return sub.split('.')[0] ?? ''
}

/**
 * Построить строку подключения к app-БД клуба: берём DATABASE_URL и заменяем имя
 * БД (последний сегмент пути) на dbName клуба. Тот же сервер/креды — другая БД
 * (модель database-per-club; ровно как pgEnvFor(..., dbName) в provisioning.ts).
 */
function buildClubConnString(dbName: string): string {
  const base = process.env['DATABASE_URL']
  if (!base) throw new Error('DATABASE_URL не задан (нужен для подключения к БД клуба)')
  const u = new URL(base)
  // pathname = '/<dbname>'; заменяем последний сегмент на dbName клуба.
  u.pathname = `/${dbName}`
  return u.toString()
}

/**
 * Зарезолвить клуб по host через control-БД. Используется ТОЛЬКО для настоящих
 * клубных поддоменов (isDefaultHost(host) === false). Кэширует результат (включая
 * null — «нет такого клуба») на CACHE_TTL_MS.
 *
 * Возвращает:
 *   ResolvedClub — клуб найден и active (вызвавший строит БД и ставит c.var.club);
 *   null         — клуба нет / он не active (middleware отдаёт 404).
 * Бросает — при недоступности control-БД и пр. (middleware ловит → 503).
 */
export async function resolveClubByHost(host: string): Promise<ResolvedClub | null> {
  const now = Date.now()
  const cached = cache.get(host)
  if (cached && cached.expiresAt > now) return cached.value

  const slug = extractSlug(host)
  const control = getControlDb()

  // Ищем по subdomain (точное совпадение host), иначе — по slug (первая метка).
  // Сначала пробуем subdomain (если у клуба задан кастомный subdomain = host),
  // затем slug. Берём только active.
  const cols = {
    id: clubs.id,
    slug: clubs.slug,
    name: clubs.name,
    dbName: clubs.dbName,
    status: clubs.status,
  }
  let row =
    (await control.select(cols).from(clubs).where(eq(clubs.subdomain, host)).limit(1))[0] ?? null

  if (!row && slug) {
    row = (await control.select(cols).from(clubs).where(eq(clubs.slug, slug)).limit(1))[0] ?? null
  }

  if (!row || row.status !== 'active') {
    cache.set(host, { value: null, expiresAt: now + CACHE_TTL_MS })
    return null
  }

  // Обогащаем подпиской (самая свежая по created_at — как в панели суперадмина) и
  // фиче-флагами модулей. FAIL-SOFT: ошибка обогащения НЕ роняет резолюцию клуба —
  // subscription=undefined трактуется энфорсментом как fail-open (не блокируем).
  let subscription: ClubSubscriptionInfo | null | undefined
  let modules: Record<string, boolean> = {}
  try {
    const [sub] =
      await control
        .select({ status: subscriptions.status, paidUntil: subscriptions.paidUntil })
        .from(subscriptions)
        .where(eq(subscriptions.clubId, row.id))
        .orderBy(desc(subscriptions.createdAt))
        .limit(1)
    subscription = sub ? { status: sub.status, paidUntil: sub.paidUntil } : null

    const mods = await control
      .select({ moduleKey: clubModules.moduleKey, enabled: clubModules.enabled })
      .from(clubModules)
      .where(eq(clubModules.clubId, row.id))
    modules = Object.fromEntries(mods.map((m) => [m.moduleKey, m.enabled]))
  } catch (err) {
    console.error(`[tenant] Обогащение клуба «${row.slug}» (подписка/модули) не удалось:`, err)
    subscription = undefined // fail-open в энфорсменте
  }

  const resolved: ResolvedClub = {
    id: row.id,
    slug: row.slug,
    name: row.name,
    dbName: row.dbName,
    subscription,
    modules,
  }

  cache.set(host, { value: resolved, expiresAt: now + CACHE_TTL_MS })
  return resolved
}

/**
 * Имена app-БД всех АКТИВНЫХ клубов (для пер-клубных фоновых задач: cron, backup).
 * Только status='active'. Бросает при недоступности control-БД — вызывающий
 * (cron/backup) сам решает фолбэк (обычно: работать по основной БД).
 */
export async function listActiveClubDbNames(): Promise<string[]> {
  const control = getControlDb()
  const rows = await control
    .select({ dbName: clubs.dbName })
    .from(clubs)
    .where(eq(clubs.status, 'active'))
  return rows.map((r) => r.dbName)
}

/**
 * Зарезолвить пул app-БД клуба по его id из control-plane. Используется внешними
 * вебхуками (Platega), которые приходят на фиксированный URL основного домена и не
 * имеют клуб-поддомена в Host — clubId берётся из payload платежа. Тот же приём,
 * что в TG-вебхуке (tg.router.ts: clubId в пути → control-БД → getClubDb).
 *
 * Возвращает Database клуба, либо null, если клуб не найден (вебхук тогда
 * фолбэкается на дефолтный синглтон). Бросает только при недоступности control-БД.
 */
export async function getClubDbById(clubId: string): Promise<Database | null> {
  const [club] = await getControlDb()
    .select({ dbName: clubs.dbName })
    .from(clubs)
    .where(eq(clubs.id, clubId))
    .limit(1)
  if (!club?.dbName) return null
  return getClubDb(buildClubConnString(club.dbName))
}

// Реэкспорт билдера строки подключения — middleware строит её из dbName клуба.
export { buildClubConnString }
