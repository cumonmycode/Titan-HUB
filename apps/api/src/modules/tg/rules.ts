/**
 * Чистые правила Tai в группах (без базы и сети — их проверяют тесты):
 * сроки модерации, расписание приколов, доступ к чатам.
 */
import type { Profile, TaiGames } from '@titan/database'
import type { ChatConfig } from '../../lib/tgChatConfig.js'

const MIN = 60
const MSK_MS = 3 * 3600_000
const HOUR_MS = 3600_000
export const FUN_TICK_MS = 10 * 60_000
const mskHour = (now: number) => new Date(now + MSK_MS).getUTCHours()

/** «10м», «2ч», «1д», «30с», «15» (минуты). null — срока нет в тексте. */
export function parseDuration(word: string | undefined): number | null {
  const m = /^(\d{1,4})\s*(с|сек|s|м|мин|m|min|ч|h|д|d|н|w)?$/i.exec((word ?? '').trim())
  if (!m) return null
  const n = Number(m[1])
  const unit = (m[2] ?? 'м').toLowerCase()
  const mult = /^(с|сек|s)$/.test(unit) ? 1 : /^(ч|h)$/.test(unit) ? 3600 : /^(д|d)$/.test(unit) ? 86400 : /^(н|w)$/.test(unit) ? 7 * 86400 : MIN
  return n > 0 ? n * mult : null
}

export function durationText(sec: number): string {
  if (sec % 86400 === 0) return `${sec / 86400} дн.`
  if (sec % 3600 === 0) return `${sec / 3600} ч`
  if (sec >= MIN) return `${Math.round(sec / MIN)} мин`
  return `${sec} с`
}

/** Пора ли выложить пост: равномерно по окну, не чаще perDay и с паузой между постами. */
export function funDue(fun: ChatConfig['fun'], postedToday: number, lastAt: number, now = Date.now(), roll = Math.random()): boolean {
  const hour = mskHour(now)
  if (hour < fun.from || hour >= fun.to || postedToday >= fun.perDay) return false
  const windowMs = (fun.to - fun.from) * HOUR_MS
  if (now - lastAt < windowMs / fun.perDay / 2) return false
  // Ожидаемо perDay постов за окно: шанс на тик = оставшиеся посты / оставшиеся тики.
  const leftMs = (fun.to - hour) * HOUR_MS - ((now + MSK_MS) % HOUR_MS)
  const ticksLeft = Math.max(1, Math.ceil(leftMs / FUN_TICK_MS))
  return roll < (fun.perDay - postedToday) / ticksLeft
}

export interface Member {
  profile: Profile | null
  games: TaiGames | null
}

const playsKind = (games: TaiGames | null, kind: string): boolean => games === 'both' || games === kind

export type AccessReason = 'everyone' | 'staff' | 'manual' | 'games'

/** Почему человеку можно в чат (подпись для HUB), или null — нельзя. */
export function accessReason(access: ChatConfig['access'], m: Member): AccessReason | null {
  if (m.profile && access.allow.includes(m.profile.id)) return 'manual'
  if (access.everyone) return 'everyone'
  if (!m.profile || m.profile.registrationStatus === 'pending') return null
  if (access.staff && (m.profile.role === 'owner' || m.profile.role === 'staff')) return 'staff'
  if (access.games.some((g) => playsKind(m.games, g))) return 'games'
  return null
}

