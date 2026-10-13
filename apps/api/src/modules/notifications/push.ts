import webpush from 'web-push'
import { Redis } from 'ioredis'
import {
  db, notifications, userNotificationSettings, pushSubscriptions, profiles,
  eq, and, inArray, isNull, desc, gt, sql, type Database,
} from '@titan/database'
import { notifChannel } from '../../lib/realtime.js'
import { deliverStaffApns } from './staff-calls.js'
import { taiBot } from '../tg/club.js'

// Переходный режим: пер-клубный db передаётся параметром, дефолт — модульный синглтон.
type DbLike = Database

// ── Deep-link: единая карта «тип+meta → экран приложения» ──────────────────────
// Используется и для in-app перехода (meta.url хранится в записи), и для PWA-push.
// Маршруты должны совпадать с реальными путями фронта (apps/web/src/app/*).
export function resolveNotifUrl(type: string, meta: Record<string, unknown> = {}): string {
  if (typeof meta['url'] === 'string' && meta['url']) return meta['url'] as string
  const checkId = typeof meta['checkId'] === 'string' ? (meta['checkId'] as string) : null
  switch (type) {
    case 'low_stock': return typeof meta['itemId'] === 'string' ? `/manage/goods/item/${meta['itemId']}` : '/manage/goods?tab=warehouse'
    case 'supply_received': return typeof meta['supplyId'] === 'string' ? `/manage/goods/doc?type=supply&id=${meta['supplyId']}` : '/manage/goods?tab=warehouse'
    case 'shift_open': case 'shift_close': case 'cash_discrepancy': return '/shifts'
    case 'salary_due': return '/manage/salary'
    case 'event_created': case 'event_completed': return '/events'
    case 'new_client': case 'client_registration': case 'birthday': return '/manage/clients'
    case 'staff_call': return checkId ? `/pos/${checkId}` : '/pos'
    case 'guest_feedback': return '/dashboard?tab=feedback'
  }
  if (checkId) return `/pos/${checkId}`
  if (typeof meta['itemId'] === 'string') return `/manage/goods/item/${meta['itemId']}`
  if (typeof meta['supplyId'] === 'string') return `/manage/goods/doc?type=supply&id=${meta['supplyId']}`
  if (typeof meta['eventId'] === 'string') return '/events'
  if (typeof meta['playerId'] === 'string') return '/manage/clients'
  if (typeof meta['spaceId'] === 'string') return '/pos'
  return '/'
}

// Ключ группировки «по объекту»: одинаковый тип по одному объекту (чек/товар/зона/
// событие/закупка/клиент) сворачивается в одну запись со счётчиком. Без объекта
// (напр. открытие/закрытие смены) — не группируем.
function groupKeyFor(type: string, meta: Record<string, unknown>): string | null {
  const entity = ['checkId', 'itemId', 'spaceId', 'eventId', 'supplyId', 'playerId']
    .map((k) => (typeof meta[k] === 'string' ? (meta[k] as string) : null))
    .find(Boolean)
  return entity ? `${type}:${entity}` : null
}
const GROUP_WINDOW_MS = 12 * 60 * 60 * 1000

// ── VAPID init ─────────────────────────────────────────────────────────────
// Поднимаем web-push только если есть все три переменные. Иначе sendWebPush —
// no-op: приложение должно работать (SSE-уведомления + запись в БД) даже без
// настроенного push.
const VAPID_PUBLIC = process.env['VAPID_PUBLIC_KEY']
const VAPID_PRIVATE = process.env['VAPID_PRIVATE_KEY']
const VAPID_SUBJECT = process.env['VAPID_SUBJECT']
let pushEnabled = false

if (VAPID_PUBLIC && VAPID_PRIVATE && VAPID_SUBJECT) {
  try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE)
    pushEnabled = true
  } catch (err) {
    console.warn('[push] Не удалось инициализировать VAPID, web push отключён:', err)
  }
} else {
  console.warn('[push] VAPID_* переменные не заданы — web push отключён (no-op).')
}

// ── Типы уведомлений ───────────────────────────────────────────────────────
export interface NotificationTypeDef {
  key: string
  label: string
  description: string
  defaultEnabled: boolean
}

export const NOTIFICATION_TYPES: NotificationTypeDef[] = [
  { key: 'staff_call', label: 'Вызов персонала', description: 'Гость вызывает персонал с планшета', defaultEnabled: true },
  { key: 'request_bill', label: 'Запрос счёта', description: 'Гость запрашивает счёт с планшета', defaultEnabled: true },
  { key: 'client_order', label: 'Заказ с планшета', description: 'Гость отправил заказ — ждёт подтверждения', defaultEnabled: true },
  { key: 'chat_message', label: 'Сообщение в чате', description: 'Гость написал в чат с планшета', defaultEnabled: true },
  { key: 'guest_feedback', label: 'Отзыв гостя', description: 'Гость оценил вечер в Titan Home на 3★ и ниже или оставил комментарий', defaultEnabled: true },
  { key: 'shift_open', label: 'Открытие смены', description: 'Смена открыта', defaultEnabled: true },
  { key: 'shift_close', label: 'Закрытие смены', description: 'Смена закрыта', defaultEnabled: true },
  { key: 'cash_discrepancy', label: 'Расхождение в кассе', description: 'Излишек или недостача наличных', defaultEnabled: true },
  { key: 'salary_due', label: 'Зарплата к выдаче', description: 'Сотрудник закрыл смену — кому и сколько выдать (только владельцам)', defaultEnabled: true },
  { key: 'check_paid', label: 'Оплата чека', description: 'Чек оплачен и закрыт', defaultEnabled: false },
  { key: 'large_check', label: 'Крупный чек', description: 'Оплачен чек на крупную сумму', defaultEnabled: true },
  { key: 'low_stock', label: 'Низкий остаток на складе', description: 'Остаток товара упал ниже порога', defaultEnabled: true },
  { key: 'refund', label: 'Возврат', description: 'Оформлен возврат по чеку', defaultEnabled: true },
  { key: 'birthday', label: 'День рождения клиента', description: 'У клиента сегодня день рождения', defaultEnabled: true },
  { key: 'check_opened', label: 'Новый чек', description: 'Открыт новый чек', defaultEnabled: false },
  { key: 'rental_started', label: 'Аренда зоны начата', description: 'Начата аренда игровой зоны', defaultEnabled: true },
  { key: 'deposit_topup', label: 'Пополнение депозита', description: 'Клиент пополнил баланс депозита', defaultEnabled: false },
  { key: 'debt_created', label: 'Новый долг клиента', description: 'У клиента образовался долг', defaultEnabled: true },
  { key: 'certificate_used', label: 'Сертификат использован', description: 'При оплате использован сертификат', defaultEnabled: false },
  { key: 'event_created', label: 'Создано мероприятие', description: 'Создано новое мероприятие', defaultEnabled: true },
  { key: 'event_completed', label: 'Мероприятие завершено', description: 'Мероприятие завершено', defaultEnabled: false },
  { key: 'new_client', label: 'Новый клиент', description: 'Зарегистрирован новый клиент', defaultEnabled: false },
  { key: 'client_registration', label: 'Регистрация в My Titan', description: 'Клиент зарегистрировался в приложении и ждёт подтверждения', defaultEnabled: true },
  { key: 'supply_received', label: 'Приход на склад', description: 'Оформлен приход товара на склад', defaultEnabled: true },
  { key: 'large_refund', label: 'Крупный возврат', description: 'Оформлен возврат на крупную сумму', defaultEnabled: true },
  { key: 'site_request', label: 'Заявка с сайта', description: 'Запись на игру, бронь зоны, мероприятие или сообщение с сайта клуба', defaultEnabled: true },
  { key: 'smm', label: 'СММ и маркетинг', description: 'Пост ждёт одобрения, пора выложить в Instagram, план и отчёт от Tai', defaultEnabled: true },
]

const DEFAULT_ENABLED: Record<string, boolean> = Object.fromEntries(
  NOTIFICATION_TYPES.map((t) => [t.key, t.defaultEnabled]),
)

function getNotifRedis() {
  return new Redis(process.env['REDIS_URL'] ?? 'redis://redis:6379', { lazyConnect: true })
}

// ── Telegram-канал ─────────────────────────────────────────────────────────
// Личное сообщение сотруднику от Tai — бота клуба (раньше был отдельный бот HUB).
// No-op, если бот не настроен. Никогда не бросает.
async function sendTelegram(database: DbLike, tgId: string, text: string): Promise<void> {
  if (!tgId) return
  try {
    const bot = await taiBot(database)
    if (bot) await bot.send(tgId, text)
  } catch (err) {
    console.warn('[push] telegram send error:', err)
  }
}

// ── Клиентские уведомления ──────────────────────────────────────────────────
// Реализация — в ./client.ts (лента приложения + Expo Push + бот My Titan).
// Реэкспорт сохраняет прежний импорт `notifyClient` из push.js.
export { notifyClient } from './client.js'

// Слать ли в Telegram этому пользователю по этому типу: только если явно включено
// (telegram=true) в настройках. По умолчанию Telegram-доставка ВЫКЛ (opt-in).
function isTelegramEnabledForUser(
  type: string,
  settings: { types?: Record<string, { enabled: boolean; channel?: string; telegram?: boolean }> | null } | undefined,
): boolean {
  return settings?.types?.[type]?.telegram === true
}

// Решение «слать ли push этому пользователю по этому типу»: берём настройку
// userNotificationSettings.types[type].enabled, иначе — defaultEnabled типа,
// иначе (неизвестный тип) — true.
export function isTypeEnabledForUser(
  type: string,
  settings: { types?: Record<string, { enabled: boolean; channel?: string; telegram?: boolean }> | null } | undefined,
): boolean {
  const t = settings?.types?.[type]
  if (t && typeof t.enabled === 'boolean') return t.enabled
  if (type in DEFAULT_ENABLED) return DEFAULT_ENABLED[type]!
  return true
}

// Низкоуровневая отправка одной подписке. Возвращает 'pruned', если подписка
// мертва (404/410) и была удалена.
async function sendToSubscription(
  sub: { id: string; endpoint: string; p256dh: string; auth: string },
  payload: string,
  database: DbLike,
): Promise<void> {
  if (!pushEnabled) return
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      payload,
    )
  } catch (err: any) {
    const status = err?.statusCode
    if (status === 404 || status === 410) {
      // Подписка протухла — чистим, чтобы не слать впустую.
      await database.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id)).catch(() => {})
    } else {
      console.warn('[push] sendNotification error:', status, err?.body ?? err?.message ?? err)
    }
  }
}

function buildPushPayload(opts: {
  type: string
  title: string
  body: string
  meta?: Record<string, unknown>
}): string {
  const meta = opts.meta ?? {}
  const url = resolveNotifUrl(opts.type, meta)
  return JSON.stringify({
    title: opts.title,
    body: opts.body,
    type: opts.type,
    meta,
    url,
  })
}

// Отправить push конкретному пользователю по всем его подпискам.
async function sendWebPushToUser(
  userId: string,
  payload: string,
  database: DbLike,
): Promise<void> {
  if (!pushEnabled) return
  const subs = await database
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId))
  await Promise.all(subs.map((s) => sendToSubscription(s, payload, database)))
}

/**
 * Единая точка отправки уведомления:
 *  1) пишем строку в notifications (userId = opts.userId ?? null = broadcast);
 *  2) публикуем в Redis-канал SSE (та же форма, что и старый publishStaffNotification);
 *  3) шлём web push получателям с учётом их настроек типов.
 *
 * notify НИКОГДА не бросает наверх — все ошибки логируются. Вызывать
 * fire-and-forget: `void notify(...).catch(() => {})`.
 *
 * clubId ОБЯЗАТЕЛЕН (c.var.club?.id ?? null; null — основной домен): без него
 * событие клуба уходит в SSE-канал основного домена ('default'), а не клуба.
 */
export async function notify(opts: {
  type: string
  title: string
  body: string
  meta?: Record<string, unknown>
  userId?: string | null
}, database: DbLike, clubId: string | null | undefined): Promise<string | null> {
  const targetUserId = opts.userId ?? null
  let notificationId: string | null = null
  try {
    // 0) Обогащаем meta: deep-link url + ключ группировки «по объекту».
    const baseMeta: Record<string, unknown> = { ...(opts.meta ?? {}) }
    baseMeta['url'] = resolveNotifUrl(opts.type, baseMeta)
    const gk = groupKeyFor(opts.type, baseMeta)

    // 1) Persist с группировкой: если есть свежая (≤12ч) запись с тем же groupKey
    //    в той же области видимости — обновляем её (счётчик ×N, свежий текст/время,
    //    снова непрочитана), иначе вставляем новую. Так похожие уведомления по
    //    одному объекту не плодятся.
    let row
    if (gk) {
      baseMeta['groupKey'] = gk
      const [existing] = await database
        .select()
        .from(notifications)
        .where(and(
          sql`${notifications.meta}->>'groupKey' = ${gk}`,
          targetUserId ? eq(notifications.userId, targetUserId) : isNull(notifications.userId),
          gt(notifications.createdAt, new Date(Date.now() - GROUP_WINDOW_MS)),
        ))
        .orderBy(desc(notifications.createdAt))
        .limit(1)
      if (existing) {
        const prevCount = Number((existing.meta as Record<string, unknown> | null)?.['count'] ?? 1)
        const mergedMeta = { ...baseMeta, count: prevCount + 1 }
        ;[row] = await database
          .update(notifications)
          .set({ title: opts.title, body: opts.body, meta: mergedMeta, isRead: false, createdAt: new Date() })
          .where(eq(notifications.id, existing.id))
          .returning()
      }
    }
    if (!row) {
      ;[row] = await database
        .insert(notifications)
        .values({
          type: opts.type,
          title: opts.title,
          body: opts.body,
          meta: { ...baseMeta, count: 1 },
          userId: targetUserId,
        })
        .returning()
    }
    // Дальше используем обогащённую meta (url/count) для push/SSE/telegram.
    opts.meta = (row?.meta as Record<string, unknown>) ?? baseMeta
    notificationId = row?.id ?? null

    // 2) Redis SSE (та же форма, что использовал publishStaffNotification)
    if (row) {
      const redis = getNotifRedis()
      try {
        await redis.connect()
        // Канал — пер-клубный: суффикс по clubId (на основном домене/без clubId
        // → 'default'). SSE-подписчик в notifications.router использует тот же канал.
        await redis.publish(
          notifChannel(clubId),
          JSON.stringify({
            id: row.id,
            type: row.type,
            title: row.title,
            body: row.body,
            meta: row.meta,
            createdAt: row.createdAt,
            // Адресат личного уведомления (null = всему персоналу) — SSE-стрим
            // по нему отсеивает чужие личные уведомления.
            userId: row.userId ?? null,
          }),
        )
      } catch (err) {
        console.warn('[push] redis publish error:', err)
      } finally {
        redis.disconnect()
      }
    }

    // 3) Доставка по каналам (web push + Telegram). Каналы независимы:
    //    Telegram работает даже без настроенного VAPID.
    const tgText = `🔔 ${opts.title}\n${opts.body}`

    // Спец-тип 'test' — только самому пользователю, без проверки настроек типов.
    if (opts.type === 'test') {
      if (targetUserId) {
        const payload = buildPushPayload(opts)
        if (pushEnabled) await sendWebPushToUser(targetUserId, payload, database)
        await deliverStaffApns(database, [targetUserId], { ...opts, notificationId })
        const [p] = await database.select({ tgId: profiles.tgId }).from(profiles).where(eq(profiles.id, targetUserId))
        if (p?.tgId) await sendTelegram(database, p.tgId, tgText)
      }
      return notificationId
    }

    // Получатели: конкретный user или broadcast → весь персонал.
    let recipientIds: string[]
    if (targetUserId) {
      recipientIds = [targetUserId]
    } else {
      const staff = await database
        .select({ id: profiles.id })
        .from(profiles)
        .where(and(inArray(profiles.role, ['owner', 'staff']), isNull(profiles.deletedAt)))
      recipientIds = staff.map((s) => s.id)
    }
    if (!recipientIds.length) return notificationId

    // Настройки типов + tgId получателей одним проходом.
    const settingsRows = await database
      .select()
      .from(userNotificationSettings)
      .where(inArray(userNotificationSettings.userId, recipientIds))
    const settingsByUser = new Map(settingsRows.map((s) => [s.userId, s]))
    const profRows = await database
      .select({ id: profiles.id, tgId: profiles.tgId })
      .from(profiles)
      .where(inArray(profiles.id, recipientIds))
    const tgByUser = new Map(profRows.map((p) => [p.id, p.tgId]))

    // Web push и iPhone приложения Titan HUB — по настройке enabled.
    const enabledIds = recipientIds.filter((uid) => isTypeEnabledForUser(opts.type, settingsByUser.get(uid)))
    if (pushEnabled) {
      const payload = buildPushPayload(opts)
      await Promise.all(enabledIds.map((uid) => sendWebPushToUser(uid, payload, database)))
    }
    await deliverStaffApns(database, enabledIds, { ...opts, notificationId })

    // Telegram — только по включённым типам (как web push) + настройка telegram +
    // наличие привязки.
    const tgRecipients = enabledIds.filter(
      (uid) => isTelegramEnabledForUser(opts.type, settingsByUser.get(uid)) && tgByUser.get(uid),
    )
    await Promise.all(tgRecipients.map((uid) => sendTelegram(database, tgByUser.get(uid)!, tgText)))
  } catch (err) {
    // notify не должен ронять вызывающий код ни при каких условиях.
    console.error('[push] notify failed:', err)
  }
  return notificationId
}
