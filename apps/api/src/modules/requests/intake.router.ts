/**
 * Единый приём онлайн-заявок: сайт клуба (форма записи, бронь кабинки, выезд,
 * сертификат, вопрос). Старая форма HUB /book перенаправляет сюда же. Заявка →
 * bookings (kind) → «Мероприятия → Заявки» в HUB; персоналу — push и сообщение в
 * чат, гостю — ссылка на клиентского бота, через которого придёт статус.
 * Монтируется в site.router как /api/site/requests (публично, без авторизации).
 */
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { sql, spaces, certificates, customers, eq, and, type Database } from '@titan/database'
import type { AppEnv } from '../../types.js'
import { clientIp } from '../../lib/clientIp.js'
import { publicRateLimited, startError } from '../bookings/publicGuards.js'
import { getClientBot, guestBotLink } from './clientBot.js'
import { notifyNewRequest } from './notify.js'

function rows<T = Record<string, unknown>>(res: unknown): T[] {
  return ((res as { rows?: unknown[] }).rows ?? (res as unknown[])) as T[]
}

const CREATE_MAX_PER_WINDOW = parseInt(process.env['SITE_REQUEST_LIMIT'] ?? '6')
const CREATE_WINDOW_SECONDS = 600

/** Адрес HUB клуба для кнопки «Открыть в HUB» (Host запроса — поддомен клуба). */
function hubOriginOf(host: string | undefined): string | null {
  const h = (host ?? '').toLowerCase().split(':')[0] ?? ''
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(h) ? `https://${h}` : null
}

export const requestsIntakeRouter = new Hono<AppEnv>()

// ─── Приём заявок ────────────────────────────────────────────────────────────
const phone = z.string().trim().min(5).max(30)
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const time = z.string().regex(/^\d{2}:\d{2}$/)
const base = {
  name: z.string().trim().min(1).max(120),
  phone,
  telegram: z.string().trim().max(64).optional(),
  comment: z.string().trim().max(1000).optional(),
  page: z.string().max(120).optional(),
  // Согласие на обработку ПДн (152-ФЗ) — без него заявку не принимаем.
  consent: z.literal(true),
  // Ловушка для ботов: поле скрыто от людей, заполненное — тихо отбрасываем.
  website: z.string().max(200).optional(),
}

const EVENING = { city_mafia: 'Городская мафия', sport_mafia: 'Спортивная мафия', board_games: 'Настольные игры', any: 'Любой вечер' } as const
const FORMAT = {
  birthday: 'День рождения', corporate: 'Корпоратив', kids: 'Детская мафия',
  party: 'Тематическая вечеринка', other: 'Мероприятие',
} as const
const TOPIC = { partnership: 'Сотрудничество', question: 'Вопрос', other: 'Сообщение' } as const

const RequestSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('game'), ...base, date, time,
    evening: z.enum(['city_mafia', 'sport_mafia', 'board_games', 'any']),
    guests: z.number().int().min(1).max(20),
    newbie: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal('event'), ...base, date, time,
    format: z.enum(['birthday', 'corporate', 'kids', 'party', 'other']),
    location: z.enum(['titan', 'exit']),
    address: z.string().trim().max(300).optional(),
    guests: z.number().int().min(1).max(500).optional(),
    tariffHours: z.number().int().min(1).max(24).optional(),
    spaceId: z.string().uuid().optional(),
  }),
  z.object({
    kind: z.literal('certificate'), ...base, date, time,
    code: z.string().trim().min(1).max(40),
    location: z.enum(['titan', 'exit']),
    address: z.string().trim().max(300).optional(),
    guests: z.number().int().min(1).max(100).optional(),
  }),
  z.object({
    kind: z.literal('message'), ...base,
    topic: z.enum(['partnership', 'question', 'other']),
    comment: z.string().trim().min(1).max(1500),
  }),
])
type SiteRequest = z.infer<typeof RequestSchema>

interface Draft {
  kind: 'event' | 'game' | 'message'
  title: string
  startsAt: string | null // null → сейчас (обращение без даты)
  location: 'titan' | 'exit'
  address: string | null
  guests: number | null
  tariffHours: number | null
  spaceId: string | null
  lines: string[] // дополнительные строки сводки для comment
  meta: Record<string, unknown>
}

// Сертификат: если номер совпал с сертификатом HUB — подсказываем персоналу остаток.
async function certificateNote(db: Database, code: string): Promise<string> {
  const [cert] = await db.select({ balance: certificates.balance, isUsed: certificates.isUsed })
    .from(certificates).where(eq(certificates.code, code.toUpperCase())).limit(1)
  if (!cert) return `Сертификат № ${code}`
  if (cert.isUsed || Number(cert.balance) <= 0) return `Сертификат № ${code} — в HUB уже использован`
  return `Сертификат № ${code} — в HUB, остаток ${Math.round(Number(cert.balance)).toLocaleString('ru-RU')} ₽`
}

async function draftOf(db: Database, r: SiteRequest): Promise<Draft> {
  const common = { telegram: r.telegram || null, page: r.page || null, source: 'site' }
  switch (r.kind) {
    case 'game':
      return {
        kind: 'game', title: `Запись на игру · ${EVENING[r.evening]}`,
        startsAt: `${r.date}T${r.time}:00+03:00`, location: 'titan', address: null,
        guests: r.guests, tariffHours: null, spaceId: null,
        lines: [r.newbie ? 'Впервые у нас' : ''],
        meta: { ...common, evening: r.evening, newbie: !!r.newbie },
      }
    case 'event':
      return {
        kind: 'event', title: FORMAT[r.format],
        startsAt: `${r.date}T${r.time}:00+03:00`, location: r.location,
        address: r.location === 'exit' ? (r.address || null) : null,
        guests: r.guests ?? null, tariffHours: r.tariffHours ?? null, spaceId: r.spaceId ?? null,
        lines: [],
        meta: { ...common, format: r.format },
      }
    case 'certificate':
      return {
        kind: 'event', title: `Сертификат № ${r.code}`,
        startsAt: `${r.date}T${r.time}:00+03:00`, location: r.location,
        address: r.location === 'exit' ? (r.address || null) : null,
        guests: r.guests ?? null, tariffHours: null, spaceId: null,
        lines: [await certificateNote(db, r.code)],
        meta: { ...common, certificate: r.code },
      }
    case 'message':
      return {
        kind: 'message', title: TOPIC[r.topic], startsAt: null, location: 'titan', address: null,
        guests: null, tariffHours: null, spaceId: null, lines: [],
        meta: { ...common, topic: r.topic },
      }
  }
}

function phoneTailOf(raw: string): string {
  return raw.replace(/\D/g, '').slice(-10)
}

requestsIntakeRouter.post('/', zValidator('json', RequestSchema, (result, c) => {
  if (!result.success) return c.json({ error: 'Проверьте поля формы' }, 400)
}), async (c) => {
  const db = c.var.db
  const r = c.req.valid('json')
  // Бот заполнил скрытое поле — отвечаем «ок», ничего не сохраняя.
  if (r.website) return c.json({ ok: true })

  const phoneTail = phoneTailOf(r.phone)
  if (phoneTail.length < 10) return c.json({ error: 'Укажите номер телефона полностью' }, 400)
  if (await publicRateLimited('sr', c.var.club?.id ?? '', clientIp(c), phoneTail, CREATE_MAX_PER_WINDOW, CREATE_WINDOW_SECONDS)) {
    return c.json({ error: 'Слишком много заявок — попробуйте позже или позвоните нам' }, 429)
  }
  if (r.kind !== 'message') {
    const bad = startError(r.date, r.time)
    if (bad) return c.json({ error: bad }, 400)
  }
  if (r.kind === 'event' && r.spaceId) {
    const [space] = await db.select({ id: spaces.id }).from(spaces)
      .where(and(eq(spaces.id, r.spaceId), eq(spaces.isActive, true))).limit(1)
    if (!space) return c.json({ error: 'Эта зона сейчас недоступна — выберите другую' }, 400)
  }

  const d = await draftOf(db, r)
  // Секрет заявки: по нему клиентский бот привязывает чат гостя (t.me/<бот>?start=r_<token>).
  const claimToken = randomUUID().replace(/-/g, '')
  const comment = [...d.lines, r.telegram ? `Telegram: ${r.telegram}` : '', r.comment ?? '']
    .filter(Boolean).join('\n') || null

  // Дедуп двойной отправки: та же новая заявка (вид, телефон, начало/заголовок) —
  // под advisory-lock, чтобы два одновременных запроса не создали две записи.
  const dedupKey = `site-request:${d.kind}:${phoneTail}:${d.startsAt ?? d.title}`
  const created = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${dedupKey}, 0))`)
    const sameStart = d.startsAt
      ? sql`starts_at = ${d.startsAt}::timestamptz`
      : sql`title = ${d.title} AND created_at > now() - interval '1 day'`
    const dup = await tx.execute(sql`
      SELECT id FROM bookings
      WHERE status = 'new' AND kind = ${d.kind} AND source = 'site'
        AND right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 10) = ${phoneTail}
        AND ${sameStart}
      LIMIT 1
    `)
    const existing = rows<{ id: string }>(dup)[0]?.id
    if (existing) return { id: existing, duplicate: true }
    const startsAt = d.startsAt ? sql`${d.startsAt}::timestamptz` : sql`now()`
    const res = await tx.execute(sql`
      INSERT INTO bookings (space_id, name, phone, guests, starts_at, duration_hours, comment, status, source, location, address,
                            tariff_hours, title, kind, meta, claim_token)
      VALUES (${d.spaceId}, ${r.name}, ${r.phone}, ${d.guests}, ${startsAt}, ${d.tariffHours}, ${comment}, 'new', 'site',
              ${d.location}, ${d.address}, ${d.tariffHours}, ${d.title}, ${d.kind}, ${JSON.stringify(d.meta)}::jsonb, ${claimToken})
      RETURNING id
    `)
    return { id: rows<{ id: string }>(res)[0]?.id ?? null, duplicate: false }
  })
  // Повтор той же заявки (двойная отправка): ссылку на бота не выдаём — по телефону
  // и времени нельзя подписаться на чужую заявку.
  if (created.duplicate || !created.id) return c.json({ ok: true, duplicate: true })

  // Заказчик мероприятия → справочник «Заказчики» (дедуп по последним 10 цифрам).
  if (d.kind === 'event') {
    try {
      const found = await db.execute(sql`
        SELECT id FROM customers WHERE right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 10) = ${phoneTail} LIMIT 1
      `)
      if (!rows(found).length) await db.insert(customers).values({ name: r.name, phone: r.phone })
    } catch { /* non-fatal */ }
  }

  void notifyNewRequest(db, c.var.club?.id, created.id, hubOriginOf(c.req.header('host')))
  const botUrl = guestBotLink(await getClientBot(db).catch(() => null), claimToken)
  return c.json({ ok: true, botUrl })
})
