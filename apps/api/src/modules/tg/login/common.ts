/**
 * Общее для входа через Tai (My Titan, HUB, старые сборки): строки
 * wallet_login_codes, привязка Telegram к профилю, оформление номеров.
 *
 * Строку создаёт API приложения (/api/auth/app/start, /api/auth/hub/start), бот
 * привязывает её к Telegram, который открыл ссылку, и подтверждает. Приложение
 * опрашивает статус и получает токен.
 */
import {
  profiles, tgLinkRequests, walletLoginCodes, eq, and, or, gt, isNull, isNotNull, desc, inArray,
  type Database, type WalletLoginCode,
} from '@titan/database'
import { escapeHtml, type ReplyMarkup } from '../../../lib/tgBot.js'

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const DEEP_CODE_RE = /^[A-Za-z0-9_-]{16,64}$/
export const NO = '❌ Нет'
export const REMOVE_KEYBOARD: ReplyMarkup = { remove_keyboard: true }
export const STALE_TEXT = '⌛ Запрос устарел. Вернитесь в приложение и нажмите кнопку ещё раз.'

export type LoginMode = 'login' | 'register' | 'hub'

export function formatPhone(phone: string | null): string {
  const d = (phone ?? '').replace(/\D/g, '')
  if (d.length !== 11 || !d.startsWith('7')) return phone ?? '—'
  return `+7 ${d.slice(1, 4)} ${d.slice(4, 7)}-${d.slice(7, 9)}-${d.slice(9)}`
}

/** «1990-01-31» → «31.01.1990». */
export function formatBirthday(value: string): string {
  const [y, m, d] = value.split('-')
  return y && m && d ? `${d}.${m}.${y}` : value
}

export function isUniqueViolation(e: unknown): boolean {
  // Новые версии drizzle заворачивают ошибку Postgres в cause.
  const err = e as { code?: string; cause?: { code?: string } } | null
  return (err?.code ?? err?.cause?.code) === '23505'
}

export const deviceText = (row: WalletLoginCode): string =>
  row.deviceName ? `«${escapeHtml(row.deviceName)}»` : 'новом устройстве'

const live = () => gt(walletLoginCodes.expiresAt, new Date())

/** Ждущая строка по коду из ссылки t.me/<bot>?start=…_<deepCode>. */
export async function rowByDeepCode(db: Database, deepCode: string, modes: LoginMode[]): Promise<WalletLoginCode | null> {
  const [row] = await db.select().from(walletLoginCodes)
    .where(and(eq(walletLoginCodes.deepCode, deepCode), inArray(walletLoginCodes.mode, modes), eq(walletLoginCodes.status, 'pending'), live()))
    .limit(1)
  return row ?? null
}

/** С этого момента подтверждение принимаем только от этого Telegram. */
export async function bindRow(db: Database, rowId: string, tgId: string): Promise<boolean> {
  const bound = await db.update(walletLoginCodes).set({ tgId })
    .where(and(eq(walletLoginCodes.id, rowId), or(isNull(walletLoginCodes.tgId), eq(walletLoginCodes.tgId, tgId))))
    .returning({ id: walletLoginCodes.id })
  return bound.length > 0
}

/** Ждущая подтверждения строка этого Telegram (последняя открытая ссылка). */
export async function pendingRow(db: Database, tgId: string, id?: string): Promise<WalletLoginCode | null> {
  const [row] = await db.select().from(walletLoginCodes)
    .where(and(
      id ? eq(walletLoginCodes.id, id) : undefined,
      eq(walletLoginCodes.tgId, tgId),
      isNotNull(walletLoginCodes.mode),
      eq(walletLoginCodes.status, 'pending'),
      live(),
    ))
    .orderBy(desc(walletLoginCodes.createdAt))
    .limit(1)
  return row ?? null
}

/** Атомарно: только пока строка ждёт (повторное подтверждение — no-op). */
export async function claim(db: Database, rowId: string, profileId: string): Promise<boolean> {
  const done = await db.update(walletLoginCodes)
    .set({ status: 'claimed', profileId })
    .where(and(eq(walletLoginCodes.id, rowId), eq(walletLoginCodes.status, 'pending'), live()))
    .returning({ id: walletLoginCodes.id })
  return done.length > 0
}

export async function reject(db: Database, rowId: string, note: string): Promise<void> {
  await db.update(walletLoginCodes).set({ status: 'rejected', note })
    .where(and(eq(walletLoginCodes.id, rowId), eq(walletLoginCodes.status, 'pending')))
}

/** Привязать Telegram к профилю без Telegram (для уведомлений). Занят — не страшно. */
export async function linkTelegram(db: Database, profileId: string, tgId: string, tgUsername: string | null): Promise<boolean> {
  try {
    return await db.transaction(async (tx) => {
      const linked = await tx.update(profiles).set({ tgId, tgUsername })
        .where(and(eq(profiles.id, profileId), isNull(profiles.tgId)))
        .returning({ id: profiles.id })
      if (linked.length) await tx.insert(tgLinkRequests).values({ profileId, tgId, tgUsername, status: 'approved' })
      return linked.length > 0
    })
  } catch (e) {
    // tg_id уникален: этот Telegram уже у другого (например, архивного) профиля.
    if (!isUniqueViolation(e)) console.error('[tai] привязка Telegram не удалась:', e)
    return false
  }
}

/** Кнопка «поделиться номером»: Telegram сам пришлёт номер аккаунта. */
export function contactKeyboard(yesLabel: string): ReplyMarkup {
  return { keyboard: [[{ text: yesLabel, request_contact: true }], [{ text: NO }]], resize_keyboard: true, one_time_keyboard: true }
}
