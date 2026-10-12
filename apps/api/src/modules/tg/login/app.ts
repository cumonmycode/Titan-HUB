/**
 * Вход и регистрация в My Titan через Tai (раньше — бот Wallet).
 *
 *  • /start app_<deepCode> — вход по номеру телефона: Telegram уже привязан к
 *    профилю с этим номером → «Да / Нет»; иначе «Да» = кнопка «поделиться
 *    номером» — Telegram сам пришлёт номер аккаунта, и мы сверим его с введённым
 *    (иначе любой вошёл бы в чужой профиль, набрав чужой номер).
 *  • /start login_<deepCode> — старые сборки приложения, вход в одно касание.
 *  • 4 цифры — вход в веб-версию My Titan из браузера.
 */
import { profiles, walletLoginCodes, eq, and, gt, isNull, desc, sql, type Profile, type WalletLoginCode } from '@titan/database'
import { getSharedRedis } from '../../../lib/redis.js'
import { findProfilesByPhone, normalizePhone, phoneKey } from '../../../lib/phone.js'
import { escapeHtml, type ReplyMarkup } from '../../../lib/tgBot.js'
import type { TgClub } from '../club.js'
import { profileByTg } from '../identity.js'
import type { TgUser } from '../types.js'
import {
  DEEP_CODE_RE, NO, REMOVE_KEYBOARD, STALE_TEXT, UUID_RE,
  bindRow, claim, contactKeyboard, deviceText, formatBirthday, formatPhone, isUniqueViolation, linkTelegram, reject, rowByDeepCode,
} from './common.js'

const YES_LOGIN = '✅ Да, это я'
const YES_REGISTER = '✅ Да, подтвердить'
const CODE_MAX_FAILS = 5
const CODE_WINDOW_SEC = 10 * 60

const openAppMarkup = (club: TgClub): ReplyMarkup => ({ inline_keyboard: [[{ text: '📱 Открыть приложение', url: `https://${club.host}/my-titan` }]] })

/** Живой (не архивный) профиль этого Telegram. */
async function ownProfile(club: TgClub, tgId: string): Promise<Profile | null> {
  return profileByTg(club.db, tgId)
}

async function askYesNo(club: TgClub, chatId: number, row: WalletLoginCode, profile: Profile, alreadyLinked: boolean): Promise<void> {
  const markup: ReplyMarkup = { inline_keyboard: [[{ text: '✅ Да, войти', callback_data: `ac:${row.id}` }, { text: NO, callback_data: `ar:${row.id}` }]] }
  const nick = escapeHtml(profile.nickname)
  const text = alreadyLinked
    ? `👋 Этот Telegram уже привязан к профилю <b>${nick}</b>.\n\nВойти в него на устройстве ${deviceText(row)}?`
    : `🔐 <b>Вход в My Titan</b>\n\n${nick}, подтверди вход на устройстве ${deviceText(row)}.\n\nЕсли это не ты — нажми «Нет».`
  await club.bot.send(chatId, text, { html: true, markup })
}

async function askContact(club: TgClub, chatId: number, row: WalletLoginCode): Promise<void> {
  const register = row.mode === 'register'
  const reg = row.regData
  const text = register && reg
    ? `📝 <b>Регистрация в My Titan</b>\n\nНикнейм: <b>${escapeHtml(reg.nickname)}</b>\nИмя: ${escapeHtml(reg.fullName)}\nДень рождения: ${formatBirthday(reg.birthday)}\nТелефон: ${formatPhone(row.phone)}${reg.photoUrl ? '\nФото: добавлено' : ''}\n\n`
      + `Подтверди регистрацию: нажми «${YES_REGISTER}» внизу. Telegram пришлёт номер этого аккаунта — так мы проверим, что номер твой.`
    : `🔐 <b>Вход в My Titan</b>\n\nВход по номеру ${formatPhone(row.phone)} на устройстве ${deviceText(row)}.\n\n`
      + `Это ты? Нажми «${YES_LOGIN}» внизу. Telegram пришлёт номер этого аккаунта — так мы проверим, что номер твой.`
  await club.bot.send(chatId, text, { html: true, markup: contactKeyboard(register ? YES_REGISTER : YES_LOGIN) })
}

async function sendDone(club: TgClub, chatId: number, profile: Profile, registered: boolean): Promise<void> {
  const what = registered ? 'Регистрация подтверждена' : 'Вход подтверждён'
  await club.bot.send(chatId, `🎉 Готово, <b>${escapeHtml(profile.nickname)}</b>! ${what} — жми кнопку, чтобы открыть приложение.\n\nА если будут вопросы о клубе — пиши мне сюда, я Tai, администратор клуба 😉`, { html: true, markup: openAppMarkup(club) })
}

/** /start app_<deepCode>. */
export async function handleAppStart(club: TgClub, from: TgUser, chatId: number, deepCode: string): Promise<void> {
  const tgId = String(from.id)
  if (!DEEP_CODE_RE.test(deepCode)) {
    await club.bot.send(chatId, '❌ Ссылка недействительна. Вернись в приложение и нажми кнопку ещё раз.')
    return
  }
  const row = await rowByDeepCode(club.db, deepCode, ['login', 'register'])
  if (!row) {
    await club.bot.send(chatId, STALE_TEXT)
    return
  }
  if (!(await bindRow(club.db, row.id, tgId))) {
    await club.bot.send(chatId, '❌ Эту ссылку уже открыли в другом Telegram. Начни вход в приложении заново.')
    return
  }
  const mine = await ownProfile(club, tgId)
  if (row.mode === 'register') {
    if (mine) await askYesNo(club, chatId, row, mine, true)
    else await askContact(club, chatId, row)
    return
  }
  const candidates = await findProfilesByPhone(club.db, row.phone ?? '')
  if (!candidates.length) {
    await reject(club.db, row.id, 'Профиль с этим номером не найден')
    await club.bot.send(chatId, '❌ Профиль с этим номером не найден. Вернись в приложение и введи номер ещё раз.')
    return
  }
  const own = mine && candidates.find((p) => p.id === mine.id)
  if (own) await askYesNo(club, chatId, row, own, false)
  else await askContact(club, chatId, row)
}

/** «Да, войти» — этот Telegram уже привязан к профилю. */
export async function confirmApp(club: TgClub, from: TgUser, rowId: string): Promise<{ toast: string; text: string; markup?: ReplyMarkup }> {
  const tgId = String(from.id)
  const [row] = UUID_RE.test(rowId)
    ? await club.db.select().from(walletLoginCodes)
      .where(and(eq(walletLoginCodes.id, rowId), eq(walletLoginCodes.tgId, tgId), eq(walletLoginCodes.status, 'pending'), gt(walletLoginCodes.expiresAt, new Date())))
      .limit(1)
    : []
  const mine = row ? await ownProfile(club, tgId) : null
  // При входе профиль Telegram обязан совпасть с найденным по номеру.
  const target = row?.mode === 'login'
    ? (mine && (await findProfilesByPhone(club.db, row.phone ?? '')).find((p) => p.id === mine.id)) || null
    : mine
  if (!row || !target || !(await claim(club.db, row.id, target.id))) return { toast: 'Запрос устарел', text: STALE_TEXT }
  return {
    toast: 'Вход подтверждён',
    text: `✅ Готово, <b>${escapeHtml(target.nickname)}</b>! Вход подтверждён — жми кнопку, чтобы открыть приложение.`,
    markup: openAppMarkup(club),
  }
}

export async function rejectApp(club: TgClub, from: TgUser, rowId: string): Promise<void> {
  if (!UUID_RE.test(rowId)) return
  await club.db.update(walletLoginCodes).set({ status: 'rejected', note: 'Вход отклонён в Telegram' })
    .where(and(eq(walletLoginCodes.id, rowId), eq(walletLoginCodes.tgId, String(from.id)), eq(walletLoginCodes.status, 'pending')))
}

type Registration = { ok: true; profile: Profile } | { ok: false; note: string; message: string }

async function registerClient(club: TgClub, row: WalletLoginCode, tgId: string, tgUsername: string | null): Promise<Registration> {
  const reg = row.regData
  if (!reg) return { ok: false, note: 'Анкета не найдена', message: '❌ Анкета не найдена. Заполни её в приложении ещё раз.' }
  const mine = await ownProfile(club, tgId)
  if (mine) return { ok: true, profile: mine }
  const taken = { ok: false as const, note: `Никнейм «${reg.nickname}» уже занят`, message: `❌ Никнейм «${reg.nickname}» уже занят. Вернись в приложение и придумай другой.` }
  const [nickHit] = await club.db.select({ id: profiles.id }).from(profiles).where(sql`lower(${profiles.nickname}) = lower(${reg.nickname})`).limit(1)
  if (nickHit) return taken
  // Telegram может держать архивный профиль (tg_id уникален) — тогда без привязки.
  const [tgHolder] = await club.db.select({ id: profiles.id }).from(profiles).where(eq(profiles.tgId, tgId)).limit(1)
  try {
    const [created] = await club.db.insert(profiles).values({
      nickname: reg.nickname,
      fullName: reg.fullName,
      birthday: reg.birthday,
      phone: row.phone,
      photoUrl: reg.photoUrl ?? null,
      role: 'client',
      // Ждёт подтверждения персонала в HUB: до него без бонусов и оплаты в приложении.
      registrationStatus: 'pending',
      tgId: tgHolder ? null : tgId,
      tgUsername: tgHolder ? null : tgUsername,
    }).returning()
    return created ? { ok: true, profile: created } : taken
  } catch (e) {
    if (isUniqueViolation(e)) return taken
    throw e
  }
}

/** Вход по проверенному номеру: профиль этого Telegram, иначе первый без Telegram. */
async function profileForVerifiedPhone(club: TgClub, row: WalletLoginCode, tgId: string, tgUsername: string | null): Promise<Profile | null> {
  const candidates = await findProfilesByPhone(club.db, row.phone ?? '')
  if (!candidates.length) return null
  const mine = await ownProfile(club, tgId)
  const own = mine && candidates.find((p) => p.id === mine.id)
  if (own) return own
  const target = candidates.find((p) => !p.tgId) ?? candidates[0]!
  if (!target.tgId && !mine) await linkTelegram(club.db, target.id, tgId, tgUsername)
  return target
}

/** Контакт для строки My Titan (login/register). */
export async function handleAppContact(club: TgClub, from: TgUser, chatId: number, row: WalletLoginCode, phoneNumber: string): Promise<void> {
  const tgId = String(from.id)
  const verified = normalizePhone(phoneNumber)
  if (!verified || phoneKey(verified) !== phoneKey(row.phone ?? '')) {
    await reject(club.db, row.id, `Номер этого Telegram (${formatPhone(verified)}) не совпадает с введённым`)
    await club.bot.send(chatId, `❌ Номер этого Telegram — ${formatPhone(verified)}, а в приложении введён ${formatPhone(row.phone)}.\n\nВернись в приложение и введи номер этого Telegram-аккаунта.`, { markup: REMOVE_KEYBOARD })
    return
  }
  const tgUsername = from.username ?? null
  // Номер могли добавить в клуб, пока клиент заполнял анкету, — тогда это вход.
  const existing = await profileForVerifiedPhone(club, row, tgId, tgUsername)
  let profile = existing
  if (!profile && row.mode === 'register') {
    const result = await registerClient(club, row, tgId, tgUsername)
    if (!result.ok) {
      await reject(club.db, row.id, result.note)
      await club.bot.send(chatId, result.message, { markup: REMOVE_KEYBOARD })
      return
    }
    profile = result.profile
  }
  if (!profile || !(await claim(club.db, row.id, profile.id))) {
    await club.bot.send(chatId, STALE_TEXT, { markup: REMOVE_KEYBOARD })
    return
  }
  await club.bot.send(chatId, '✅ Номер подтверждён', { markup: REMOVE_KEYBOARD })
  await sendDone(club, chatId, profile, !existing)
}

// ── Старые сборки: /start login_<deepCode> и 4-значный код из браузера ───────

/** /start login_<deepCode> — вход в одно касание из старых сборок My Titan. */
export async function handleLegacyLogin(club: TgClub, from: TgUser, chatId: number, deepCode: string): Promise<void> {
  if (!DEEP_CODE_RE.test(deepCode)) {
    await club.bot.send(chatId, '❌ Ссылка для входа недействительна. Нажми «Войти через Telegram» в приложении ещё раз.')
    return
  }
  const profile = await ownProfile(club, String(from.id))
  if (!profile) {
    await club.bot.send(chatId, '👋 Этот Telegram пока не привязан к клиенту клуба. Обнови приложение My Titan и войди по номеру телефона.')
    return
  }
  const [row] = await club.db.select().from(walletLoginCodes)
    .where(and(eq(walletLoginCodes.deepCode, deepCode), isNull(walletLoginCodes.mode), eq(walletLoginCodes.status, 'pending'), gt(walletLoginCodes.expiresAt, new Date())))
    .limit(1)
  if (!row) {
    await club.bot.send(chatId, '⌛ Ссылка для входа устарела. Нажми «Войти через Telegram» в приложении ещё раз.')
    return
  }
  const markup: ReplyMarkup = { inline_keyboard: [[{ text: '✅ Да, войти', callback_data: `lc:${row.id}` }, { text: 'Это не я', callback_data: `lr:${row.id}` }]] }
  await club.bot.send(chatId, `🔐 <b>Вход в My Titan</b>\n\n${escapeHtml(profile.nickname)}, подтверди вход на устройстве ${deviceText(row)}.\n\nЕсли ты не входил — нажми «Это не я».`, { html: true, markup })
}

export async function confirmLegacy(club: TgClub, from: TgUser, rowId: string): Promise<{ toast: string; text: string }> {
  const profile = await ownProfile(club, String(from.id))
  if (!profile || !UUID_RE.test(rowId)) return { toast: 'Аккаунт не привязан', text: STALE_TEXT }
  const claimed = await club.db.update(walletLoginCodes)
    .set({ status: 'claimed', profileId: profile.id })
    .where(and(eq(walletLoginCodes.id, rowId), isNull(walletLoginCodes.mode), eq(walletLoginCodes.status, 'pending'), gt(walletLoginCodes.expiresAt, new Date())))
    .returning({ id: walletLoginCodes.id })
  if (!claimed.length) return { toast: 'Запрос устарел', text: '⌛ Запрос на вход устарел. Начни вход в приложении заново.' }
  return { toast: 'Вход подтверждён', text: `✅ Готово, <b>${escapeHtml(profile.nickname)}</b>! Вернись в приложение — вход уже выполнен.` }
}

export async function rejectLegacy(club: TgClub, rowId: string): Promise<void> {
  if (!UUID_RE.test(rowId)) return
  await club.db.update(walletLoginCodes).set({ status: 'rejected' })
    .where(and(eq(walletLoginCodes.id, rowId), isNull(walletLoginCodes.mode), eq(walletLoginCodes.status, 'pending')))
}

/**
 * 4 цифры от привязанного клиента — код входа в веб-версию My Titan. true —
 * сообщение было кодом (обработано), false — это обычный текст для разговора.
 * Анти-перебор: 5 промахов за 10 минут — дальше цифры считаем просто текстом.
 */
export async function handleWebCode(club: TgClub, from: TgUser, chatId: number, code: string): Promise<boolean> {
  const tgId = String(from.id)
  const failsKey = `tai:webcode:${club.key}:${tgId}`
  const redis = getSharedRedis()
  const fails = Number(await redis.get(failsKey).catch(() => 0)) || 0
  if (fails >= CODE_MAX_FAILS) return false
  const [row] = await club.db.select().from(walletLoginCodes)
    .where(and(eq(walletLoginCodes.code, code), isNull(walletLoginCodes.mode), eq(walletLoginCodes.status, 'pending'), gt(walletLoginCodes.expiresAt, new Date())))
    .orderBy(desc(walletLoginCodes.createdAt))
    .limit(1)
  if (!row) {
    const n = await redis.incr(failsKey).catch(() => 0)
    if (n === 1) await redis.expire(failsKey, CODE_WINDOW_SEC).catch(() => {})
    return false
  }
  const profile = await ownProfile(club, tgId)
  if (!profile) {
    await club.bot.send(chatId, '👋 Чтобы войти в My Titan, сначала привяжи аккаунт: войди в приложении по номеру телефона или попроси администратора.')
    return true
  }
  const claimed = await club.db.update(walletLoginCodes)
    .set({ status: 'claimed', profileId: profile.id })
    .where(and(eq(walletLoginCodes.id, row.id), eq(walletLoginCodes.status, 'pending')))
    .returning({ id: walletLoginCodes.id })
  await redis.del(failsKey).catch(() => {})
  await club.bot.send(chatId, claimed.length
    ? `✅ Готово, <b>${escapeHtml(profile.nickname)}</b>! My Titan открыт на устройстве — вернись в браузер.`
    : '❌ Код уже использован или истёк. Открой My Titan в браузере и пришли свежий код.', { html: true })
  return true
}

/** «Нет» с клавиатуры под полем ввода — отклонить последний запрос входа. */
export async function rejectLatest(club: TgClub, from: TgUser, chatId: number, row: WalletLoginCode | null): Promise<void> {
  if (row) {
    const note = row.mode === 'register' ? 'Регистрация отклонена в Telegram' : 'Вход отклонён в Telegram'
    await reject(club.db, row.id, note)
  }
  await club.bot.send(chatId, row ? '🛡 Хорошо, запрос отклонён — доступ никому не выдан.' : 'Нет активного запроса.', { markup: REMOVE_KEYBOARD })
}
