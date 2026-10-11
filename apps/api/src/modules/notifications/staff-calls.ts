/**
 * Push и «звонки» персоналу (приложение Titan HUB).
 *
 * 1) Каждое уведомление персоналу (notify) уходит обычным push на iPhone сотрудников,
 *    у которых этот тип включён в настройках уведомлений.
 * 2) Эскалация из Titan Home: гость написал в чат или нажал «Позвать» → через 30 с,
 *    если никто не открыл чат / не прочитал вызов, — VoIP-push «звонок» на все
 *    iPhone персонала (CallKit показывает входящий звонок, как в мессенджере).
 *    Ответил один — звонок у остальных гаснет (VoIP-push «отмена»), чат/вызов
 *    помечается прочитанным. Открыли чат или счёт обычным путём — звонок тоже гаснет.
 *
 * Android-телефоны получают тот же «звонок» событием `staff:call` (и `staff:call-end`)
 * в потоке уведомлений персонала /api/notifications/stream: приложение держит его
 * в фоновой службе, без Google-сервисов (Honor/Huawei их не имеют).
 *
 * Проверку «пора звонить / уже прочитали» делает тик раз в 5 секунд по всем клубам
 * (runStaffAlerts) — переживает рестарты API, состояние в staff_alerts.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { Redis } from 'ioredis'
import {
  appDevices, chatMessages, checks, notifications, profiles, staffAlerts, userNotificationSettings,
  and, eq, inArray, isNotNull, isNull, sql, type Database,
} from '@titan/database'
import { apnsEnabled, isApnsToken, sendApns, STAFF_TOPIC } from './apns.js'
import { isTypeEnabledForUser } from './push.js'
import { notifChannel } from '../../lib/realtime.js'

/** Через сколько без прочтения звоним. */
export const CALL_AFTER_MS = 30_000
/** Звонок, на который так и не ответили, перестаём отслеживать. */
const CALL_FORGET_MS = 10 * 60_000

type AlertKind = 'chat' | 'staff_call'

const NOTIFY_TYPE: Record<AlertKind, string> = { chat: 'chat_message', staff_call: 'staff_call' }

/** https://<клуб> из запроса — туда телефон подтвердит ответ на звонок. */
export function requestOrigin(c: { req: { header: (name: string) => string | undefined; url: string } }): string {
  // Только Host (его выставляет nginx, по нему же выбран клуб). X-Forwarded-Host nginx
  // не перезаписывает — гостевой планшет подставил бы чужой хост, и телефон персонала
  // отправил бы подтверждение звонка туда.
  const host = c.req.header('host') ?? new URL(c.req.url).host
  const local = /^(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+)(:\d+)?$/.test(host)
  const forwardedProto = c.req.header('x-forwarded-proto')
  const proto = forwardedProto === 'http' || forwardedProto === 'https' ? forwardedProto : (local ? 'http' : 'https')
  return `${proto}://${host}`
}

// ───────────────────────────── Устройства ─────────────────────────────

/** Сотрудники (owner/staff), у которых тип уведомления включён. */
async function staffWithTypeEnabled(database: Database, type: string, only?: string[]): Promise<string[]> {
  const staff = await database
    .select({ id: profiles.id })
    .from(profiles)
    .where(and(inArray(profiles.role, ['owner', 'staff']), isNull(profiles.deletedAt)))
  const ids = staff.map((s) => s.id).filter((id) => !only || only.includes(id))
  if (!ids.length) return []
  const settings = await database
    .select()
    .from(userNotificationSettings)
    .where(inArray(userNotificationSettings.userId, ids))
  const byUser = new Map(settings.map((s) => [s.userId, s]))
  return ids.filter((id) => isTypeEnabledForUser(type, byUser.get(id)))
}

async function forgetDeadTokens(database: Database, column: 'push' | 'voip', dead: string[]) {
  if (!dead.length) return
  if (column === 'push') {
    await database.update(appDevices).set({ pushToken: null }).where(inArray(appDevices.pushToken, dead)).catch(() => {})
  } else {
    await database.update(appDevices).set({ voipToken: null }).where(inArray(appDevices.voipToken, dead)).catch(() => {})
  }
  // Устройство без единого токена больше не нужно.
  await database.delete(appDevices)
    .where(and(eq(appDevices.app, 'staff'), isNull(appDevices.pushToken), isNull(appDevices.voipToken)))
    .catch(() => {})
}

/** Обычный push на iPhone персонала (из notify, уже отфильтрованные по настройкам). */
export async function deliverStaffApns(
  database: Database,
  userIds: string[],
  n: { type: string; title: string; body: string; meta?: Record<string, unknown>; notificationId?: string | null },
): Promise<void> {
  if (!apnsEnabled || !userIds.length) return
  const devices = await database
    .select({ token: appDevices.pushToken })
    .from(appDevices)
    .where(and(
      inArray(appDevices.profileId, userIds),
      eq(appDevices.app, 'staff'),
      eq(appDevices.platform, 'ios'),
      isNotNull(appDevices.pushToken),
    ))
  const tokens = devices.map((d) => d.token!).filter(isApnsToken)
  if (!tokens.length) return
  const meta = n.meta ?? {}
  const data = {
    type: n.type,
    notificationId: n.notificationId ?? null,
    checkId: typeof meta['checkId'] === 'string' ? meta['checkId'] : null,
    spaceId: typeof meta['spaceId'] === 'string' ? meta['spaceId'] : null,
    url: typeof meta['url'] === 'string' ? meta['url'] : null,
  }
  const { dead } = await sendApns(tokens.map((token) => ({
    token, topic: STAFF_TOPIC, title: n.title, body: n.body, threadId: n.type, data,
  })))
  await forgetDeadTokens(database, 'push', dead)
}

async function voipTokens(database: Database, type: string): Promise<string[]> {
  const userIds = await staffWithTypeEnabled(database, type)
  if (!userIds.length) return []
  const devices = await database
    .select({ token: appDevices.voipToken })
    .from(appDevices)
    .where(and(
      inArray(appDevices.profileId, userIds),
      eq(appDevices.app, 'staff'),
      eq(appDevices.platform, 'ios'),
      isNotNull(appDevices.voipToken),
    ))
  return devices.map((d) => d.token!).filter(isApnsToken)
}

type Alert = typeof staffAlerts.$inferSelect

/**
 * Именованное событие в поток уведомлений персонала клуба. Поток читают только
 * owner/staff (не планшеты гостей), а веб и iOS слушают лишь безымянные события.
 */
async function signalStaff(a: Alert, event: 'staff:call' | 'staff:call-end', data: Record<string, unknown>) {
  const redis = new Redis(process.env['REDIS_URL'] ?? 'redis://redis:6379', { lazyConnect: true })
  try {
    await redis.connect()
    await redis.publish(notifChannel(a.clubKey), JSON.stringify({ __event: event, data }))
  } catch (err) {
    console.warn('[staff-calls] сигнал в SSE не ушёл:', err)
  } finally {
    redis.disconnect()
  }
}

function callPayload(a: Alert) {
  return {
    type: 'call',
    callId: a.id,
    kind: a.kind,
    caller: a.title,
    subtitle: a.body,
    checkId: a.checkId,
    spaceId: a.spaceId,
    ackUrl: `${a.ackBase}/api/alerts/${a.id}/ack`,
    ackKey: a.ackKey,
  }
}

/** «Входящий звонок»: VoIP-push на iPhone и событие Android-телефонам. Возвращает число iPhone. */
async function placeCalls(database: Database, a: Alert): Promise<number> {
  const data = callPayload(a)
  await signalStaff(a, 'staff:call', data)
  if (!apnsEnabled) return 0
  const tokens = await voipTokens(database, NOTIFY_TYPE[a.kind as AlertKind] ?? 'staff_call')
  if (!tokens.length) return 0
  const { accepted, dead } = await sendApns(tokens.map((token) => ({
    token, topic: STAFF_TOPIC, pushType: 'voip' as const, title: a.title, body: a.body, data, ttlSeconds: 30,
  })))
  await forgetDeadTokens(database, 'voip', dead)
  return accepted
}

/** Погасить звонок на всех телефонах (ответили, прочитали чат, открыли счёт). */
async function cancelCalls(database: Database, a: Alert): Promise<void> {
  await signalStaff(a, 'staff:call-end', { callId: a.id })
  if (!apnsEnabled) return
  const tokens = await voipTokens(database, NOTIFY_TYPE[a.kind as AlertKind] ?? 'staff_call')
  if (!tokens.length) return
  const { dead } = await sendApns(tokens.map((token) => ({
    token, topic: STAFF_TOPIC, pushType: 'voip' as const, title: '', body: '',
    data: { type: 'cancel', callId: a.id }, ttlSeconds: 60,
  })))
  await forgetDeadTokens(database, 'voip', dead)
}

// ───────────────────────────── Эскалация ─────────────────────────────

/**
 * Гость написал в чат / позвал персонал: через 30 с без прочтения — звонок.
 * Если такая эскалация уже ждёт звонка — только освежаем подпись (последнее сообщение).
 * Если по ней уже звонили больше минуты назад и снова зовут — заводим новую.
 */
export async function raiseStaffAlert(database: Database, opts: {
  kind: AlertKind
  checkId?: string | null
  spaceId?: string | null
  notificationId?: string | null
  title: string
  body: string
  origin: string
  clubId?: string | null
}): Promise<void> {
  try {
    const scope = opts.kind === 'chat'
      ? (opts.checkId ? eq(staffAlerts.checkId, opts.checkId) : null)
      : (opts.spaceId ? eq(staffAlerts.spaceId, opts.spaceId) : opts.notificationId ? eq(staffAlerts.notificationId, opts.notificationId) : null)
    if (scope) {
      const open = await database.select().from(staffAlerts)
        .where(and(eq(staffAlerts.kind, opts.kind), scope, isNull(staffAlerts.resolvedAt)))
      for (const a of open) {
        if (!a.calledAt) {
          await database.update(staffAlerts).set({ body: opts.body, notificationId: opts.notificationId ?? a.notificationId })
            .where(eq(staffAlerts.id, a.id))
          return
        }
        // Только что звонили — звонок ещё идёт, второй не нужен.
        if (Date.now() - a.calledAt.getTime() < 60_000) return
        await database.update(staffAlerts).set({ resolvedAt: new Date(), resolution: 'superseded' })
          .where(eq(staffAlerts.id, a.id))
      }
    }
    await database.insert(staffAlerts).values({
      kind: opts.kind,
      checkId: opts.checkId ?? null,
      spaceId: opts.spaceId ?? null,
      notificationId: opts.notificationId ?? null,
      title: opts.title,
      body: opts.body,
      ackBase: opts.origin,
      ackKey: randomBytes(24).toString('base64url'),
      clubKey: opts.clubId ?? null,
      dueAt: new Date(Date.now() + CALL_AFTER_MS),
    })
  } catch (err) {
    console.error('[staff-calls] не удалось завести эскалацию:', err)
  }
}

/** Прочитали ли уже то, ради чего звоним (чат открыт / вызов прочитан / счёт закрыт). */
async function isHandled(database: Database, a: Alert): Promise<boolean> {
  if (a.kind === 'chat') {
    if (!a.checkId) return true
    const [chk] = await database.select({ status: checks.status }).from(checks).where(eq(checks.id, a.checkId))
    if (!chk || chk.status !== 'open') return true
    const unread = await database.select({ id: chatMessages.id }).from(chatMessages)
      .where(and(eq(chatMessages.checkId, a.checkId), eq(chatMessages.sender, 'guest'), isNull(chatMessages.readAt)))
      .limit(1)
    return unread.length === 0
  }
  if (!a.notificationId) return false
  const [n] = await database.select({ isRead: notifications.isRead }).from(notifications)
    .where(eq(notifications.id, a.notificationId))
  return !n || n.isRead
}

async function resolve(database: Database, a: Alert, resolution: string, answeredBy?: string) {
  await database.update(staffAlerts)
    .set({ resolvedAt: new Date(), resolution, answeredBy: answeredBy ?? null })
    .where(and(eq(staffAlerts.id, a.id), isNull(staffAlerts.resolvedAt)))
}

/** Тик эскалаций (раз в 5 с): звоним по просроченным, гасим прочитанные, забываем старые. */
export async function runStaffAlerts(database: Database): Promise<void> {
  const open = await database.select().from(staffAlerts).where(isNull(staffAlerts.resolvedAt)).limit(200)
  const now = Date.now()
  for (const a of open) {
    try {
      if (await isHandled(database, a)) {
        await resolve(database, a, 'read')
        if (a.calledAt) await cancelCalls(database, a)
        continue
      }
      if (!a.calledAt) {
        if (a.dueAt.getTime() > now) continue
        // Сначала помечаем (второй тик не позвонит дважды), потом звоним.
        const marked = await database.update(staffAlerts).set({ calledAt: new Date() })
          .where(and(eq(staffAlerts.id, a.id), isNull(staffAlerts.calledAt)))
          .returning({ id: staffAlerts.id })
        if (marked.length) {
          const n = await placeCalls(database, a)
          console.log(`[staff-calls] звонок «${a.title}» (${a.kind}) → ${n} тел.`)
        }
        continue
      }
      if (now - a.calledAt.getTime() > CALL_FORGET_MS) await resolve(database, a, 'expired')
    } catch (err) {
      console.error('[staff-calls] эскалация', a.id, err)
    }
  }
}

/**
 * Телефон ответил на звонок: отметить чат/вызов прочитанным, погасить звонок у остальных.
 * Возвращает null при неверном ключе.
 */
export async function ackStaffAlert(
  database: Database,
  alertId: string,
  key: string,
  answeredBy: string | null,
  onChatRead: (checkId: string) => void,
): Promise<{ kind: string; checkId: string | null; spaceId: string | null } | null> {
  const [a] = await database.select().from(staffAlerts).where(eq(staffAlerts.id, alertId))
  if (!a) return null
  const expected = Buffer.from(a.ackKey)
  const given = Buffer.from(key)
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null
  const result = { kind: a.kind, checkId: a.checkId, spaceId: a.spaceId }
  if (a.resolvedAt) return result

  if (a.kind === 'chat' && a.checkId) {
    await database.update(chatMessages).set({ readAt: new Date() })
      .where(and(eq(chatMessages.checkId, a.checkId), eq(chatMessages.sender, 'guest'), isNull(chatMessages.readAt)))
    await database.update(notifications).set({ isRead: true })
      .where(and(isNull(notifications.userId), eq(notifications.type, 'chat_message'), sql`${notifications.meta}->>'checkId' = ${a.checkId}`))
    onChatRead(a.checkId)
  }
  if (a.notificationId) {
    await database.update(notifications).set({ isRead: true }).where(eq(notifications.id, a.notificationId))
  }
  await resolve(database, a, 'answered', answeredBy ?? undefined)
  await cancelCalls(database, a)
  return result
}
