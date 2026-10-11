/**
 * Уведомления КЛИЕНТАМ (приложение My Titan + Telegram-бот My Titan).
 *
 * Каждое уведомление идёт по трём каналам независимо друг от друга:
 *  1) лента в приложении — строка client_notifications (всегда: история не должна
 *     теряться, даже если push выключен или приложение не установлено);
 *  2) push на телефон (если есть устройства и client_push_enabled): iPhone — напрямую
 *     через APNs (apns.ts), Android — через Expo Push;
 *  3) личное сообщение из бота My Titan (если привязан Telegram и
 *     wallet_notify_enabled — прежнее поведение).
 *
 * Рассылки клуба (kind='news') дополнительно уважают client_news_enabled.
 * Функции никогда не бросают наверх — вызывать fire-and-forget.
 */
import {
  profiles, appDevices, clientNotifications,
  eq, and, inArray, isNotNull, sql, type Database,
} from '@titan/database'
import { isApnsToken, sendApns } from './apns.js'
import { TG_API } from '../../lib/telegram.js'

export type ClientNotifyKind = 'bonus' | 'deposit' | 'debt' | 'payment' | 'tier' | 'fund' | 'news' | 'system'

export interface ClientNotice {
  kind: ClientNotifyKind
  title: string
  body: string
  /** Куда вести из push/ленты: { screen: 'history' | 'pay' | 'check', checkId?, … }. */
  meta?: Record<string, unknown>
}

const KIND_EMOJI: Record<ClientNotifyKind, string> = {
  bonus: '⭐', deposit: '💰', debt: '⚠️', payment: '✅', tier: '🎉', fund: '🏛', news: '📣', system: '🔔',
}

// ── Telegram (бот My Titan) ─────────────────────────────────────────────────
const WALLET_TOKEN = process.env['WALLET_BOT_TOKEN']

export async function sendWalletTelegram(tgId: string, text: string): Promise<boolean> {
  if (!WALLET_TOKEN || !tgId) return false
  try {
    const r = await fetch(`${TG_API}/bot${WALLET_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: tgId, text, disable_web_page_preview: true }),
    })
    return r.ok
  } catch (err) {
    console.warn('[client-notify] telegram send error:', err)
    return false
  }
}

export function telegramText(n: Pick<ClientNotice, 'kind' | 'title' | 'body'>): string {
  return `${KIND_EMOJI[n.kind] ?? '🔔'} ${n.title}\n${n.body}`
}

// ── Expo Push ───────────────────────────────────────────────────────────────
// Токены вида ExponentPushToken[…]. Необязательный EXPO_ACCESS_TOKEN включает
// «Enhanced security» Expo (без него API тоже работает).
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'
const EXPO_ACCESS_TOKEN = process.env['EXPO_ACCESS_TOKEN']

export interface PushMessage {
  to: string
  title: string
  body: string
  data?: Record<string, unknown>
  badge?: number
  channelId?: string
}

export function isExpoToken(token: string): boolean {
  return /^Expo(nent)?PushToken\[.+\]$/.test(token)
}

/** Пачка push через Expo. Возвращает число принятых Expo сообщений и мёртвые токены. */
async function sendExpoPush(messages: PushMessage[]): Promise<{ accepted: number; dead: string[] }> {
  const valid = messages.filter((m) => isExpoToken(m.to))
  let accepted = 0
  const dead: string[] = []
  // Expo принимает до 100 сообщений за запрос.
  for (let i = 0; i < valid.length; i += 100) {
    const chunk = valid.slice(i, i + 100)
    try {
      const r = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...(EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${EXPO_ACCESS_TOKEN}` } : {}),
        },
        body: JSON.stringify(chunk.map((m) => ({
          to: m.to,
          title: m.title,
          body: m.body,
          data: m.data ?? {},
          sound: 'default',
          priority: 'high',
          ...(m.badge != null ? { badge: m.badge } : {}),
          channelId: m.channelId ?? 'wallet',
        }))),
      })
      if (!r.ok) {
        console.warn('[client-notify] expo push http', r.status, (await r.text().catch(() => '')).slice(0, 200))
        continue
      }
      const j = (await r.json()) as { data?: Array<{ status: string; details?: { error?: string } }> }
      ;(j.data ?? []).forEach((ticket, idx) => {
        if (ticket.status === 'ok') accepted++
        else if (ticket.details?.error === 'DeviceNotRegistered') dead.push(chunk[idx]!.to)
      })
    } catch (err) {
      console.warn('[client-notify] expo push error:', err)
    }
  }
  return { accepted, dead }
}

/**
 * Отправить пачку push: токены Expo — через Expo Push, нативные токены iPhone — прямо
 * в APNs. Возвращает число принятых сообщений. Мёртвые токены удаляет.
 */
export async function sendPush(messages: PushMessage[], database: Database): Promise<number> {
  const [expo, apns] = await Promise.all([
    sendExpoPush(messages.filter((m) => isExpoToken(m.to))),
    sendApns(messages.filter((m) => isApnsToken(m.to)).map((m) => ({
      token: m.to, title: m.title, body: m.body, badge: m.badge, threadId: m.channelId, data: m.data,
    }))),
  ])
  const dead = [...expo.dead, ...apns.dead]
  if (dead.length) {
    await database.delete(appDevices).where(inArray(appDevices.pushToken, dead)).catch(() => {})
  }
  return expo.accepted + apns.accepted
}

/** Непрочитанные уведомления по списку клиентов (для бейджа на иконке). */
async function unreadCounts(profileIds: string[], database: Database): Promise<Map<string, number>> {
  if (!profileIds.length) return new Map()
  const rows = await database
    .select({ profileId: clientNotifications.profileId, cnt: sql<number>`count(*)::int` })
    .from(clientNotifications)
    .where(and(inArray(clientNotifications.profileId, profileIds), eq(clientNotifications.isRead, false)))
    .groupBy(clientNotifications.profileId)
  return new Map(rows.map((r) => [r.profileId, Number(r.cnt)]))
}

function channelFor(kind: ClientNotifyKind): string {
  return kind === 'news' ? 'news' : 'wallet'
}

/**
 * Личное уведомление клиенту о ЕГО событии (бонусы, депозит, долг, оплата…).
 * Строка-аргумент — обратная совместимость со старыми вызовами (уйдёт как 'system').
 */
export async function notifyClient(
  profileId: string,
  notice: ClientNotice | string,
  database: Database,
  _clubId?: string | null,
): Promise<void> {
  const n: ClientNotice = typeof notice === 'string'
    ? { kind: 'system', title: 'Titan', body: notice }
    : notice
  try {
    const [p] = await database
      .select({
        tgId: profiles.tgId,
        tgOn: profiles.walletNotifyEnabled,
        pushOn: profiles.clientPushEnabled,
        newsOn: profiles.clientNewsEnabled,
      })
      .from(profiles)
      .where(eq(profiles.id, profileId))
    if (!p) return
    if (n.kind === 'news' && p.newsOn === false) return

    const [row] = await database.insert(clientNotifications).values({
      profileId, kind: n.kind, title: n.title, body: n.body, meta: n.meta ?? {},
    }).returning({ id: clientNotifications.id })

    if (p.pushOn !== false) {
      const devices = await database
        .select({ token: appDevices.pushToken })
        .from(appDevices)
        .where(and(eq(appDevices.profileId, profileId), eq(appDevices.app, 'client'), isNotNull(appDevices.pushToken)))
      if (devices.length) {
        const badge = (await unreadCounts([profileId], database)).get(profileId) ?? 0
        await sendPush(devices.map((d) => ({
          to: d.token!,
          title: n.title,
          body: n.body,
          badge,
          channelId: channelFor(n.kind),
          data: { ...(n.meta ?? {}), kind: n.kind, notificationId: row?.id },
        })), database)
      }
    }

    if (p.tgId && p.tgOn !== false) await sendWalletTelegram(p.tgId, telegramText(n))
  } catch (err) {
    console.error('[client-notify] notifyClient failed:', err)
  }
}

/**
 * Массовая доставка (рассылка клуба). Пишет ленту всем получателям одним INSERT,
 * push — пачками, Telegram — последовательно с паузой (лимит Bot API ~30 msg/s).
 */
export async function deliverToClients(
  profileIds: string[],
  notice: ClientNotice & { broadcastId?: string },
  channels: { push: boolean; telegram: boolean },
  database: Database,
): Promise<{ recipients: number; push: number; telegram: number }> {
  if (!profileIds.length) return { recipients: 0, push: 0, telegram: 0 }
  const people = await database
    .select({
      id: profiles.id, tgId: profiles.tgId,
      tgOn: profiles.walletNotifyEnabled, pushOn: profiles.clientPushEnabled, newsOn: profiles.clientNewsEnabled,
    })
    .from(profiles)
    .where(inArray(profiles.id, profileIds))
  // Новости уважают отписку клиента; служебные (system) — нет.
  const targets = notice.kind === 'news' ? people.filter((p) => p.newsOn !== false) : people
  if (!targets.length) return { recipients: 0, push: 0, telegram: 0 }

  for (let i = 0; i < targets.length; i += 500) {
    await database.insert(clientNotifications).values(targets.slice(i, i + 500).map((p) => ({
      profileId: p.id, kind: notice.kind, title: notice.title, body: notice.body,
      meta: notice.meta ?? {}, broadcastId: notice.broadcastId ?? null,
    })))
  }

  let pushCount = 0
  if (channels.push) {
    const pushIds = targets.filter((p) => p.pushOn !== false).map((p) => p.id)
    if (pushIds.length) {
      const devices = await database
        .select({ profileId: appDevices.profileId, token: appDevices.pushToken })
        .from(appDevices)
        .where(and(inArray(appDevices.profileId, pushIds), eq(appDevices.app, 'client'), isNotNull(appDevices.pushToken)))
      const badges = await unreadCounts([...new Set(devices.map((d) => d.profileId))], database)
      pushCount = await sendPush(devices.map((d) => ({
        to: d.token!,
        title: notice.title,
        body: notice.body,
        badge: badges.get(d.profileId) ?? 0,
        channelId: channelFor(notice.kind),
        data: { ...(notice.meta ?? {}), kind: notice.kind },
      })), database)
    }
  }

  let tgCount = 0
  if (channels.telegram) {
    const text = telegramText(notice)
    for (const p of targets) {
      if (!p.tgId || p.tgOn === false) continue
      if (await sendWalletTelegram(p.tgId, text)) tgCount++
      await new Promise((r) => setTimeout(r, 40))
    }
  }
  return { recipients: targets.length, push: pushCount, telegram: tgCount }
}
