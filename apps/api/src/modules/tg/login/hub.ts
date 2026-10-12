/**
 * Вход сотрудника в Titan HUB через Tai (первый вход на устройстве; дальше —
 * Face ID и PIN на самом устройстве).
 *
 * Приложение создаёт строку (mode 'hub') и открывает t.me/<бот>?start=hub_<код>.
 * Telegram уже привязан к сотруднику → «Войти / Это не я». Иначе просим номер
 * кнопкой «поделиться номером» (Telegram сам пришлёт номер аккаунта) и ищем
 * сотрудника с этим номером — тогда же привязываем Telegram для уведомлений.
 */
import { profiles, walletLoginCodes, eq, and, gt, isNull, type Profile, type WalletLoginCode } from '@titan/database'
import { findProfilesByPhone, normalizePhone } from '../../../lib/phone.js'
import { escapeHtml, type ReplyMarkup } from '../../../lib/tgBot.js'
import type { TgClub } from '../club.js'
import { isStaffRole, profileByTg } from '../identity.js'
import type { TgUser } from '../types.js'
import { DEEP_CODE_RE, REMOVE_KEYBOARD, STALE_TEXT, UUID_RE, bindRow, claim, contactKeyboard, deviceText, formatPhone, linkTelegram, reject, rowByDeepCode } from './common.js'

const YES_HUB = '✅ Да, это я'
const DONE_TEXT = (nick: string) => `✅ Готово, <b>${escapeHtml(nick)}</b>! Вход в Titan HUB подтверждён — вернись в приложение.\n\nДальше касса будет открываться по Face ID или PIN.`

async function staffByTg(club: TgClub, tgId: string): Promise<Profile | null> {
  const p = await profileByTg(club.db, tgId)
  return p && isStaffRole(p.role) ? p : null
}

/** /start hub_<deepCode>. */
export async function handleHubStart(club: TgClub, from: TgUser, chatId: number, deepCode: string): Promise<void> {
  const tgId = String(from.id)
  if (!DEEP_CODE_RE.test(deepCode)) {
    await club.bot.send(chatId, '❌ Ссылка недействительна. Вернись в Titan HUB и нажми «Войти через Telegram» ещё раз.')
    return
  }
  const row = await rowByDeepCode(club.db, deepCode, ['hub'])
  if (!row) {
    await club.bot.send(chatId, STALE_TEXT)
    return
  }
  if (!(await bindRow(club.db, row.id, tgId))) {
    await club.bot.send(chatId, '❌ Эту ссылку уже открыли в другом Telegram. Начни вход в Titan HUB заново.')
    return
  }
  const staff = await staffByTg(club, tgId)
  if (staff) {
    const markup: ReplyMarkup = { inline_keyboard: [[{ text: '✅ Войти', callback_data: `hc:${row.id}` }, { text: 'Это не я', callback_data: `hr:${row.id}` }]] }
    await club.bot.send(chatId, `🔐 <b>Вход в Titan HUB</b>\n\n${escapeHtml(staff.nickname)}, подтверди вход на устройстве ${deviceText(row)}.\n\nЕсли это не ты — нажми «Это не я».`, { html: true, markup })
    return
  }
  await club.bot.send(
    chatId,
    `🔐 <b>Вход в Titan HUB</b> на устройстве ${deviceText(row)}.\n\nЭтот Telegram пока не привязан к сотруднику. Нажми «${YES_HUB}» внизу — Telegram пришлёт номер аккаунта, и я найду тебя среди сотрудников клуба.`,
    { html: true, markup: contactKeyboard(YES_HUB) },
  )
}

export async function confirmHub(club: TgClub, from: TgUser, rowId: string): Promise<{ toast: string; text: string }> {
  const tgId = String(from.id)
  const staff = await staffByTg(club, tgId)
  const [row] = UUID_RE.test(rowId)
    ? await club.db.select({ id: walletLoginCodes.id }).from(walletLoginCodes)
      .where(and(eq(walletLoginCodes.id, rowId), eq(walletLoginCodes.mode, 'hub'), eq(walletLoginCodes.tgId, tgId), eq(walletLoginCodes.status, 'pending'), gt(walletLoginCodes.expiresAt, new Date())))
      .limit(1)
    : []
  if (!row || !staff || !(await claim(club.db, row.id, staff.id))) return { toast: 'Запрос устарел', text: STALE_TEXT }
  return { toast: 'Вход подтверждён', text: DONE_TEXT(staff.nickname) }
}

export async function rejectHub(club: TgClub, from: TgUser, rowId: string): Promise<void> {
  if (!UUID_RE.test(rowId)) return
  await club.db.update(walletLoginCodes).set({ status: 'rejected', note: 'Вход отклонён в Telegram' })
    .where(and(eq(walletLoginCodes.id, rowId), eq(walletLoginCodes.mode, 'hub'), eq(walletLoginCodes.tgId, String(from.id)), eq(walletLoginCodes.status, 'pending')))
}

/** Контакт для строки HUB: ищем сотрудника по номеру этого Telegram. */
export async function handleHubContact(club: TgClub, from: TgUser, chatId: number, row: WalletLoginCode, phoneNumber: string): Promise<void> {
  const tgId = String(from.id)
  const phone = normalizePhone(phoneNumber)
  const staff = phone ? (await findProfilesByPhone(club.db, phone)).filter((p) => isStaffRole(p.role)) : []
  if (!staff.length) {
    await reject(club.db, row.id, 'Номер не найден среди сотрудников клуба')
    await club.bot.send(chatId, `❌ Номер ${formatPhone(phone)} не найден среди сотрудников клуба. Попроси владельца добавить этот номер в твой профиль (Управление → Персонал) и попробуй снова.`, { markup: REMOVE_KEYBOARD })
    return
  }
  if (staff.length > 1) {
    await reject(club.db, row.id, 'Номер есть у нескольких сотрудников')
    await club.bot.send(chatId, '❌ Этот номер указан у нескольких сотрудников — попроси владельца исправить профили.', { markup: REMOVE_KEYBOARD })
    return
  }
  const target = staff[0]!
  if (target.tgId && target.tgId !== tgId) {
    await reject(club.db, row.id, 'К профилю привязан другой Telegram')
    await club.bot.send(chatId, '❌ К твоему профилю уже привязан другой Telegram. Войди с него или попроси владельца отвязать старый.', { markup: REMOVE_KEYBOARD })
    return
  }
  // Telegram этого человека ещё ни к кому не привязан — привязываем к сотруднику.
  const [holder] = await club.db.select({ id: profiles.id }).from(profiles).where(and(eq(profiles.tgId, tgId), isNull(profiles.deletedAt))).limit(1)
  if (!target.tgId && !holder) await linkTelegram(club.db, target.id, tgId, from.username ?? null)
  if (!(await claim(club.db, row.id, target.id))) {
    await club.bot.send(chatId, STALE_TEXT, { markup: REMOVE_KEYBOARD })
    return
  }
  await club.bot.send(chatId, '✅ Номер подтверждён', { markup: REMOVE_KEYBOARD })
  await club.bot.send(chatId, DONE_TEXT(target.nickname), { html: true })
}
