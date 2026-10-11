/**
 * API клиентского приложения My Titan (iOS/Android).
 *
 * Всё строго «про себя»: профиль берётся из токена (user.sub), id клиента из
 * запроса не принимается. Вход — /api/auth/wallet-code/* (через бота My Titan),
 * оплата — /api/auth/me/payments (общая с веб-кошельком).
 */
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import {
  profiles, clientTiers, tariffs, bonusLots, appSettings, appDevices, clientNotifications,
  collections, collectionPeriods, collectionContributions, collectionMembers,
  eq, and, gt, inArray, desc, sql, type Database,
} from '@titan/database'
import { signToken } from '@titan/auth'
import { requireAuth } from '../../middleware/auth.js'
import { visitProgress } from '../../lib/loyalty.js'
import { round2 } from '../../lib/money.js'
import { isRegistrationPending } from '../../lib/registration.js'
import { excusedMonthKeys, recurringOwed } from '../../lib/collectionDues.js'
import { getActiveSbpProvider, getProvider, resolveCreds } from '../pay/registry.js'
import { getClubIntegration } from '../../lib/secrets.js'
import type { AppEnv } from '../../types.js'

export const residentRouter = new Hono<AppEnv>()
residentRouter.use('*', requireAuth)

const num = (v: unknown) => parseFloat(String(v ?? 0)) || 0
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Эквайринговая надбавка онлайн-оплаты (см. /auth/me/payments). */
export const ONLINE_SURCHARGE_PERCENT = 8

// Взносы — только у «резидентских» статусов (как в modules/collections).
const RESIDENT_TIERS = ['resident', 'student', 'newbie']

function mskNow() { return new Date(Date.now() + 3 * 3600 * 1000) }
function currentPeriodKey() {
  const d = mskNow()
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}
const MONTHS_RU = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']
function periodLabel(key: string) {
  if (key === 'single') return 'Сбор'
  const [y, m] = key.split('-').map(Number)
  return `${MONTHS_RU[(m || 1) - 1]} ${y}`
}

async function settingsMap(db: Database, keys: string[]): Promise<Record<string, string>> {
  const rows = await db.select().from(appSettings).where(inArray(appSettings.key, keys))
  return Object.fromEntries(rows.map((r) => [r.key, r.value]))
}

/** Готов ли СБП-эквайер клуба принимать онлайн-оплату. */
async function sbpReady(db: Database): Promise<boolean> {
  const active = await getActiveSbpProvider(db)
  if (active === 'platega') {
    const m = (await getClubIntegration(db, 'platega_merchant_id').catch(() => null)) ?? process.env['PLATEGA_MERCHANT_ID']
    const s = (await getClubIntegration(db, 'platega_secret').catch(() => null)) ?? process.env['PLATEGA_SECRET']
    return !!(m && s)
  }
  const provider = getProvider(active)
  if (!provider) return false
  const creds = await resolveCreds(db, provider)
  return provider.credKeys.every((k) => !!creds[k])
}

export interface ClientCollection {
  id: string
  name: string
  description: string | null
  kind: 'recurring' | 'oneoff'
  isMandatory: boolean
  period: { key: string; label: string }
  /** Взнос за период (персональная сумма, если задана). */
  due: number
  /** Сколько внести сейчас, чтобы закрыть период (0 — закрыт). */
  topUp: number
  paid: boolean
  /** Аванс на будущие месяцы (ежемесячный сбор). */
  prepaid: number
  prepaidMonths: number
  excluded: boolean
  contribution: { amount: number; method: string; paidAt: string } | null
}

/**
 * Состояние сборов для ОДНОГО клиента — та же арифметика, что в ростере
 * GET /collections/:id (пул взносов vs. число периодов × взнос), но без
 * создания периодов: чтение ничего не пишет.
 */
export async function clientCollections(db: Database, profileId: string, tier: string): Promise<ClientCollection[]> {
  if (!RESIDENT_TIERS.includes(tier)) return []
  const list = await db.select().from(collections).where(eq(collections.isActive, true))
    .orderBy(desc(collections.isMandatory), collections.createdAt)
  if (!list.length) return []
  const ids = list.map((c) => c.id)
  const curKey = currentPeriodKey()

  const [members, periods, contribs, [self]] = await Promise.all([
    db.select().from(collectionMembers)
      .where(and(inArray(collectionMembers.collectionId, ids), eq(collectionMembers.playerId, profileId))),
    db.select().from(collectionPeriods).where(inArray(collectionPeriods.collectionId, ids)),
    db.select().from(collectionContributions)
      .where(and(inArray(collectionContributions.collectionId, ids), eq(collectionContributions.playerId, profileId))),
    db.select({ createdAt: profiles.createdAt }).from(profiles).where(eq(profiles.id, profileId)).limit(1),
  ])
  const now = new Date()

  return list.map((coll): ClientCollection => {
    const m = members.find((x) => x.collectionId === coll.id)
    const excluded = !!m && (m.excludedForever || (!!m.excludedUntil && new Date(m.excludedUntil) >= now))
    const collPeriods = periods.filter((p) => p.collectionId === coll.id)
    const isRecurring = coll.kind !== 'oneoff'
    const key = isRecurring ? curKey : 'single'
    const period = collPeriods.find((p) => p.periodKey === key)
    const periodAmount = period ? num(period.amount) : num(coll.defaultAmount)
    const due = m?.amountOverride != null ? num(m.amountOverride) : periodAmount
    const con = period ? contribs.find((x) => x.periodId === period.id) : undefined

    let paid = !!con
    let topUp = 0
    let prepaid = 0
    let prepaidMonths = 0
    if (!excluded) {
      if (isRecurring) {
        // Периоды до текущего включительно (текущий может быть ещё не создан).
        const upTo = collPeriods.filter((p) => p.periodKey < curKey)
        const pids = new Set([...upTo.map((p) => p.id), ...(period ? [period.id] : [])])
        const pool = contribs.filter((x) => pids.has(x.periodId)).reduce((s, x) => s + num(x.amount), 0)
        const owed = recurringOwed(
          [...upTo.map((p) => ({ periodKey: p.periodKey, amount: num(p.amount) })), { periodKey: curKey, amount: periodAmount }],
          { override: m?.amountOverride != null ? num(m.amountOverride) : null, memberSince: self?.createdAt ?? null, excused: excusedMonthKeys(m, now) },
        )
        const credit = round2(pool - owed)
        paid = credit >= -0.005
        if (credit < -0.005) topUp = round2(-credit)
        else if (credit > 0.005) {
          prepaid = credit
          prepaidMonths = due > 0 ? Math.floor((credit + 0.001) / due) : 0
        }
      } else {
        const got = con ? num(con.amount) : 0
        topUp = round2(Math.max(0, due - got))
        paid = due > 0 ? topUp <= 0.005 : !!con
      }
    }
    return {
      id: coll.id,
      name: coll.name,
      description: coll.description,
      kind: isRecurring ? 'recurring' : 'oneoff',
      isMandatory: coll.isMandatory,
      period: { key, label: period?.label ?? periodLabel(key) },
      due,
      topUp,
      paid,
      prepaid,
      prepaidMonths,
      excluded,
      contribution: con ? { amount: num(con.amount), method: con.method, paidAt: new Date(con.paidAt).toISOString() } : null,
    }
  })
}

// ── Сводка для главного экрана одним запросом ───────────────────────────────
residentRouter.get('/wallet', async (c) => {
  const db = c.var.db
  const me = c.get('user').sub
  const [p] = await db.select().from(profiles).where(eq(profiles.id, me))
  // Профиль в архиве (в т.ч. отклонённая регистрация) — 401: приложение само выйдет на вход.
  if (!p || p.deletedAt) return c.json({ error: 'Профиль недоступен' }, 401)
  const pending = isRegistrationPending(p)

  // Статус = тариф с key (миграция 052); старая client_tiers — запасной источник подписи.
  const [tariffRow] = await db.select({ label: tariffs.name, color: tariffs.color }).from(tariffs)
    .where(eq(tariffs.key, p.clientTier)).limit(1)
  const [legacyRow] = tariffRow ? [] : await db.select({ label: clientTiers.label, color: clientTiers.color })
    .from(clientTiers).where(eq(clientTiers.key, p.clientTier))
  const tierRow = tariffRow ?? legacyRow
  const s = await settingsMap(db, [
    'bonus_enabled', 'bonus_accrual_rate', 'bonus_min_purchase', 'bonus_max_spend',
    'bonus_expiry_days', 'bonus_wallet_hidden', 'club_name',
  ])
  const [lot] = await db.select({ remaining: bonusLots.remaining, expiresAt: bonusLots.expiresAt })
    .from(bonusLots)
    .where(and(eq(bonusLots.profileId, me), gt(bonusLots.remaining, '0'), gt(bonusLots.expiresAt, new Date())))
    .orderBy(bonusLots.expiresAt)
    .limit(1)
  const [unread] = await db.select({ n: sql<number>`count(*)::int` }).from(clientNotifications)
    .where(and(eq(clientNotifications.profileId, me), eq(clientNotifications.isRead, false)))

  const [progress, colls, ready] = await Promise.all([
    visitProgress(me, db),
    clientCollections(db, me, p.clientTier),
    sbpReady(db).catch(() => false),
  ])

  const balance = round2(num(p.balance))
  const bonusEnabled = s['bonus_enabled'] !== 'false'
  return c.json({
    profile: {
      id: p.id,
      nickname: p.nickname,
      fullName: p.fullName,
      phone: p.phone,
      birthday: p.birthday,
      photoUrl: p.photoUrl ?? p.tgPhotoUrl ?? p.gomafiaPhotoUrl ?? null,
      ownPhotoUrl: p.photoUrl,
      tgUsername: p.tgUsername,
      telegramLinked: !!p.tgId,
      memberSince: p.createdAt,
    },
    tier: { key: p.clientTier, label: tierRow?.label ?? p.clientTier, color: tierRow?.color ?? '#8B5CF6' },
    balance,
    deposit: Math.max(0, balance),
    debt: Math.max(0, -balance),
    bonus: Math.floor(num(p.bonusPoints)),
    bonusHidden: s['bonus_wallet_hidden'] === 'true' || !bonusEnabled,
    bonusRules: {
      enabled: bonusEnabled,
      accrualPercent: num(s['bonus_accrual_rate'] ?? '5'),
      minPurchase: num(s['bonus_min_purchase']),
      maxSpendPercent: s['bonus_max_spend'] ? num(s['bonus_max_spend']) : null,
      expiryDays: s['bonus_expiry_days'] ? num(s['bonus_expiry_days']) : null,
    },
    bonusExpiring: lot?.expiresAt
      ? { amount: Math.floor(num(lot.remaining)), date: new Date(lot.expiresAt).toISOString() }
      : null,
    visitProgress: progress,
    collections: colls,
    // Регистрация ждёт подтверждения клуба: оплата закрыта, бонусы не начисляются.
    registration: pending ? 'pending' : null,
    pay: { online: ready && !pending, surchargePercent: ONLINE_SURCHARGE_PERCENT },
    unreadNotifications: Number(unread?.n ?? 0),
    prefs: {
      push: p.clientPushEnabled !== false,
      telegram: p.walletNotifyEnabled !== false,
      news: p.clientNewsEnabled !== false,
    },
    club: { name: s['club_name'] ?? 'Titan' },
  })
})

// ── Единая лента операций: деньги + бонусы, по курсору ──────────────────────
residentRouter.get('/feed', async (c) => {
  const db = c.var.db
  const me = c.get('user').sub
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') ?? '30', 10) || 30))
  const kind = c.req.query('kind') === 'money' ? 'money' : c.req.query('kind') === 'bonus' ? 'bonus' : 'all'
  // Курсор = «<ISO createdAt>|<id>» последней строки предыдущей страницы.
  const cursor = c.req.query('cursor') ?? ''
  const [cAt, cId] = cursor.split('|')
  const cursorDate = cAt ? new Date(cAt) : null
  const hasCursor = !!cursorDate && !Number.isNaN(cursorDate.getTime()) && !!cId

  const hidden = (await settingsMap(db, ['bonus_wallet_hidden', 'bonus_enabled']))
  const bonusHidden = hidden['bonus_wallet_hidden'] === 'true' || hidden['bonus_enabled'] === 'false'
  const withMoney = kind !== 'bonus'
  const withBonus = kind !== 'money' && !bonusHidden

  const parts = []
  // «Списание депозита/долга за чек» (withdrawal + checkId) дублирует строку оплаты
  // чека — прячем, как веб-кошелёк. visit_adjust — служебная, без денег.
  if (withMoney) parts.push(sql`
    SELECT id::text AS id, 'money' AS src, type, amount, description, check_id::text AS check_id, created_at
    FROM transactions
    WHERE player_id = ${me} AND type <> 'visit_adjust' AND NOT (check_id IS NOT NULL AND type = 'withdrawal')`)
  if (withBonus) parts.push(sql`
    SELECT id::text AS id, 'bonus' AS src,
      CASE WHEN amount >= 0 THEN 'bonus_accrual' ELSE 'bonus_spend' END AS type,
      amount, reason AS description, NULL::text AS check_id, created_at
    FROM bonus_history
    WHERE profile_id = ${me}`)
  if (!parts.length) return c.json({ items: [], nextCursor: null })

  const union = sql.join(parts, sql` UNION ALL `)
  const cursorCond = hasCursor
    ? sql`WHERE (f.created_at, f.id) < (${cursorDate!.toISOString()}::timestamptz, ${cId})`
    : sql``
  const res: any = await db.execute(sql`
    SELECT * FROM (${union}) f ${cursorCond}
    ORDER BY f.created_at DESC, f.id DESC
    LIMIT ${limit + 1}`)
  const rows: any[] = res.rows ?? res ?? []
  const page = rows.slice(0, limit)
  const POSITIVE = new Set(['deposit', 'refund', 'bonus_accrual'])
  const items = page.map((r) => {
    const amount = num(r.amount)
    const isBonus = r.src === 'bonus'
    const sign = isBonus ? (amount >= 0 ? 1 : -1) : (POSITIVE.has(r.type) ? 1 : -1)
    return {
      id: `${isBonus ? 'b' : 'm'}:${r.id}`,
      source: r.src as 'money' | 'bonus',
      type: r.type as string,
      title: (r.description as string | null) || defaultTitle(r.type),
      amount: Math.abs(amount),
      sign,
      unit: isBonus ? 'bonus' : 'rub',
      checkId: r.check_id ?? null,
      createdAt: new Date(r.created_at).toISOString(),
    }
  })
  const last = page[page.length - 1]
  const nextCursor = rows.length > limit && last ? `${new Date(last.created_at).toISOString()}|${last.id}` : null
  return c.json({ items, nextCursor })
})

function defaultTitle(type: string): string {
  switch (type) {
    case 'deposit': return 'Пополнение депозита'
    case 'withdrawal': return 'Списание с баланса'
    case 'payment': return 'Оплата чека'
    case 'refund': return 'Возврат'
    case 'bonus_accrual': return 'Начисление бонусов'
    case 'bonus_spend': return 'Списание бонусов'
    default: return 'Операция'
  }
}

// ── Сборы (фонд клуба и разовые) ────────────────────────────────────────────
residentRouter.get('/collections', async (c) => {
  const db = c.var.db
  const me = c.get('user').sub
  const [p] = await db.select({ tier: profiles.clientTier }).from(profiles).where(eq(profiles.id, me))
  return c.json({ collections: p ? await clientCollections(db, me, p.tier) : [] })
})

// ── Лента уведомлений ───────────────────────────────────────────────────────
residentRouter.get('/notifications', async (c) => {
  const db = c.var.db
  const me = c.get('user').sub
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') ?? '30', 10) || 30))
  const cursor = c.req.query('cursor') ?? ''
  const [cAt, cId] = cursor.split('|')
  const cursorDate = cAt ? new Date(cAt) : null
  const hasCursor = !!cursorDate && !Number.isNaN(cursorDate.getTime()) && !!cId && UUID_RE.test(cId)
  const rows = await db.select().from(clientNotifications)
    .where(and(
      eq(clientNotifications.profileId, me),
      hasCursor
        ? sql`(${clientNotifications.createdAt}, ${clientNotifications.id}) < (${cursorDate!.toISOString()}::timestamptz, ${cId}::uuid)`
        : undefined,
    ))
    .orderBy(desc(clientNotifications.createdAt), desc(clientNotifications.id))
    .limit(limit + 1)
  const page = rows.slice(0, limit)
  const last = page[page.length - 1]
  const [unread] = await db.select({ n: sql<number>`count(*)::int` }).from(clientNotifications)
    .where(and(eq(clientNotifications.profileId, me), eq(clientNotifications.isRead, false)))
  return c.json({
    items: page.map((n) => ({
      id: n.id, kind: n.kind, title: n.title, body: n.body, meta: n.meta ?? {},
      isRead: n.isRead, createdAt: new Date(n.createdAt).toISOString(),
    })),
    nextCursor: rows.length > limit && last ? `${new Date(last.createdAt).toISOString()}|${last.id}` : null,
    unread: Number(unread?.n ?? 0),
  })
})

residentRouter.post('/notifications/read', zValidator('json', z.object({
  ids: z.array(z.string().uuid()).max(200).optional(),
})), async (c) => {
  const db = c.var.db
  const me = c.get('user').sub
  const { ids } = c.req.valid('json')
  await db.update(clientNotifications).set({ isRead: true })
    .where(and(
      eq(clientNotifications.profileId, me),
      eq(clientNotifications.isRead, false),
      ids?.length ? inArray(clientNotifications.id, ids) : undefined,
    ))
  const [unread] = await db.select({ n: sql<number>`count(*)::int` }).from(clientNotifications)
    .where(and(eq(clientNotifications.profileId, me), eq(clientNotifications.isRead, false)))
  return c.json({ unread: Number(unread?.n ?? 0) })
})

// ── Устройства для push ─────────────────────────────────────────────────────
residentRouter.post('/devices', zValidator('json', z.object({
  token: z.string().min(10).max(300),
  platform: z.enum(['ios', 'android']),
  deviceName: z.string().max(120).optional(),
  appVersion: z.string().max(40).optional(),
})), async (c) => {
  const db = c.var.db
  const me = c.get('user').sub
  const b = c.req.valid('json')
  // Токен уникален: если телефон раньше был привязан к другому клиенту (выход и
  // вход другим аккаунтом) — строка переезжает к текущему.
  await db.insert(appDevices).values({
    profileId: me, app: 'client', platform: b.platform, pushToken: b.token,
    deviceName: b.deviceName ?? null, appVersion: b.appVersion ?? null,
  }).onConflictDoUpdate({
    target: appDevices.pushToken,
    set: {
      profileId: me, app: 'client', platform: b.platform,
      deviceName: b.deviceName ?? null, appVersion: b.appVersion ?? null, lastSeenAt: new Date(),
    },
  })
  return c.json({ ok: true })
})

residentRouter.delete('/devices', zValidator('json', z.object({ token: z.string().min(10).max(300) })), async (c) => {
  const db = c.var.db
  const me = c.get('user').sub
  const { token } = c.req.valid('json')
  await db.delete(appDevices).where(and(eq(appDevices.pushToken, token), eq(appDevices.profileId, me)))
  return c.json({ ok: true })
})

// ── Настройки уведомлений ───────────────────────────────────────────────────
residentRouter.patch('/prefs', zValidator('json', z.object({
  push: z.boolean().optional(),
  telegram: z.boolean().optional(),
  news: z.boolean().optional(),
})), async (c) => {
  const db = c.var.db
  const me = c.get('user').sub
  const b = c.req.valid('json')
  const patch: Partial<typeof profiles.$inferInsert> = {}
  if (b.push !== undefined) patch.clientPushEnabled = b.push
  if (b.telegram !== undefined) patch.walletNotifyEnabled = b.telegram
  if (b.news !== undefined) patch.clientNewsEnabled = b.news
  if (Object.keys(patch).length) await db.update(profiles).set(patch).where(eq(profiles.id, me))
  const [p] = await db.select().from(profiles).where(eq(profiles.id, me))
  return c.json({
    push: p?.clientPushEnabled !== false,
    telegram: p?.walletNotifyEnabled !== false,
    news: p?.clientNewsEnabled !== false,
  })
})

// ── Продление сессии приложения ─────────────────────────────────────────────
// Скользящая сессия: приложение раз в несколько дней меняет токен на свежий
// (30 дней). Не открывали приложение месяц — вход заново через бота. Только для
// клиентов: токен сотрудника так продлить нельзя (у него свой срок и PIN).
residentRouter.post('/session/refresh', async (c) => {
  const db = c.var.db
  const user = c.get('user')
  if (user.role !== 'client') return c.json({ error: 'Forbidden' }, 403)
  const [p] = await db.select().from(profiles).where(eq(profiles.id, user.sub))
  if (!p || p.deletedAt) return c.json({ error: 'Not found' }, 404)
  // Год, как при входе (APP_TOKEN_TTL в auth/app-login.ts): клиент входит один раз,
  // а приложение раз в несколько дней меняет токен на свежий.
  const token = await signToken({ sub: p.id, role: p.role, nickname: p.nickname, clubId: c.var.club?.id ?? null }, '365d')
  return c.json({ token })
})
