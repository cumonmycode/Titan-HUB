/**
 * Привязка Telegram к профилю через Tai (раньше — боты HUB и Wallet):
 *  • /start link_<подпись> — ссылка из HUB («Привязать Telegram» у сотрудника
 *    или клиента), подписана JWT_SECRET, живёт 15 минут;
 *  • 6 цифр — код из «Настройки → Уведомления → Привязать Telegram».
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import { profiles, tgLinkRequests, eq, and, desc, type Profile } from '@titan/database'
import { escapeHtml } from '../../../lib/tgBot.js'
import type { TgClub } from '../club.js'
import { isStaffRole } from '../identity.js'
import type { TgUser } from '../types.js'

const LINK_TTL_SECONDS = 15 * 60
const CODE_TTL_MS = 30 * 60_000
const ID_LEN = 22
const SIG_LEN = 16

function idB64ToUuid(idB64: string): string | null {
  const buf = Buffer.from(idB64, 'base64url')
  if (buf.length !== 16) return null
  const hex = buf.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function sign(msg: string): Buffer {
  return createHmac('sha256', process.env['JWT_SECRET'] ?? '').update(msg).digest().subarray(0, 12)
}

/**
 * <idB64:22>_<expB36>_<sig:16>. idB64 и sig — base64url и сами содержат «_»,
 * поэтому делим по фиксированным длинам, а не по «_».
 */
export function verifyLink(raw: string): string | null {
  if (!process.env['JWT_SECRET'] || raw.length < ID_LEN + SIG_LEN + 3) return null
  if (raw[ID_LEN] !== '_' || raw[raw.length - SIG_LEN - 1] !== '_') return null
  const idB64 = raw.slice(0, ID_LEN)
  const sig = raw.slice(raw.length - SIG_LEN)
  const expB36 = raw.slice(ID_LEN + 1, raw.length - SIG_LEN - 1)
  if (!/^[0-9a-z]+$/.test(expB36)) return null
  const exp = parseInt(expB36, 36)
  if (!Number.isSafeInteger(exp) || exp.toString(36) !== expB36) return null
  const profileId = idB64ToUuid(idB64)
  if (!profileId) return null
  const provided = Buffer.from(sig, 'base64url')
  const expected = sign(`${idB64}_${expB36}`)
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null
  const now = Math.floor(Date.now() / 1000)
  if (exp < now || exp > now + LINK_TTL_SECONDS + 60) return null
  return profileId
}

function welcome(profile: Profile): string {
  return isStaffRole(profile.role)
    ? `✅ Telegram привязан к <b>${escapeHtml(profile.nickname)}</b>.\n\nТеперь уведомления HUB приходят сюда, а меня можно спрашивать про смену, кассу и цифры — текстом или голосом.`
    : `✅ Telegram привязан к профилю <b>${escapeHtml(profile.nickname)}</b>!\n\nСюда будут приходить бонусы и новости клуба, а меня можно спросить про игры, баланс и всё остальное 😉`
}

async function link(club: TgClub, from: TgUser, chatId: number, profile: Profile, requestId: string | null): Promise<void> {
  const tgId = String(from.id)
  if (profile.tgId === tgId) {
    await club.bot.send(chatId, '✅ Этот Telegram уже привязан к профилю.')
    return
  }
  if (profile.tgId) {
    await club.bot.send(chatId, '❌ К этому профилю уже привязан другой Telegram.')
    return
  }
  const [holder] = await club.db.select({ id: profiles.id }).from(profiles).where(eq(profiles.tgId, tgId)).limit(1)
  if (holder && holder.id !== profile.id) {
    await club.bot.send(chatId, '❌ Этот Telegram уже привязан к другому профилю клуба.')
    return
  }
  try {
    await club.db.transaction(async (tx) => {
      await tx.update(profiles).set({ tgId, tgUsername: from.username ?? null }).where(eq(profiles.id, profile.id))
      if (requestId) await tx.update(tgLinkRequests).set({ status: 'approved', tgId }).where(eq(tgLinkRequests.id, requestId))
      else await tx.insert(tgLinkRequests).values({ profileId: profile.id, tgId, tgUsername: from.username ?? null, status: 'approved' })
    })
  } catch (err) {
    console.error(`[tai:${club.key}] привязка не удалась:`, err)
    await club.bot.send(chatId, '❌ Не удалось привязать — возможно, этот Telegram уже занят.')
    return
  }
  await club.bot.send(chatId, welcome(profile), { html: true })
}

/** /start link_<подпись>. */
export async function handleLinkStart(club: TgClub, from: TgUser, chatId: number, raw: string): Promise<void> {
  const profileId = verifyLink(raw)
  if (!profileId) {
    await club.bot.send(chatId, '❌ Ссылка недействительна или устарела. Попроси новую в приложении или у администратора.')
    return
  }
  const [profile] = await club.db.select().from(profiles).where(eq(profiles.id, profileId)).limit(1)
  if (!profile || profile.deletedAt) {
    await club.bot.send(chatId, '❌ Профиль не найден.')
    return
  }
  await link(club, from, chatId, profile, null)
}

/** 6 цифр — код привязки из HUB. true — это был код (обработан). */
export async function handleLinkCode(club: TgClub, from: TgUser, chatId: number, code: string): Promise<boolean> {
  const [req] = await club.db.select().from(tgLinkRequests)
    .where(and(eq(tgLinkRequests.tgId, code), eq(tgLinkRequests.status, 'pending')))
    .orderBy(desc(tgLinkRequests.createdAt)).limit(1)
  if (!req) return false
  if (Date.now() - new Date(req.createdAt).getTime() > CODE_TTL_MS) {
    await club.bot.send(chatId, '❌ Код истёк (старше 30 минут). Сгенерируй новый в приложении.')
    return true
  }
  const [profile] = await club.db.select().from(profiles).where(eq(profiles.id, req.profileId)).limit(1)
  if (!profile || profile.deletedAt) {
    await club.bot.send(chatId, '❌ Профиль не найден.')
    return true
  }
  await link(club, from, chatId, profile, req.id)
  return true
}
