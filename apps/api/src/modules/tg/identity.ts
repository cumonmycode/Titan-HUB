/**
 * Кто пишет Tai: профиль клуба по Telegram (основной tg_id или доп. аккаунт из
 * tg_aliases). Сотрудник может быть и игроком — тогда Tai сам понимает по вопросу,
 * о работе речь или о нём как о госте.
 */
import { profiles, eq, and, isNull, type Database, type Profile } from '@titan/database'
import { signToken } from '@titan/auth'
import { readAliases } from '../../lib/tgAliases.js'
import type { TgClub } from './club.js'
import type { TgUser } from './types.js'

export interface TgPerson {
  tgId: string
  user: TgUser
  /** Живой профиль клуба (клиент или сотрудник) или null — новый человек. */
  profile: Profile | null
  /** Владелец или сотрудник: Tai работает с ним как коллега. */
  staff: boolean
}

export const isStaffRole = (role: string | null | undefined): boolean => role === 'owner' || role === 'staff'

/** Живой профиль по Telegram: основной аккаунт, затем доп. аккаунты. */
export async function profileByTg(db: Database, tgId: string): Promise<Profile | null> {
  const [direct] = await db.select().from(profiles).where(and(eq(profiles.tgId, tgId), isNull(profiles.deletedAt))).limit(1)
  if (direct) return direct
  const alias = (await readAliases(db))[tgId]
  if (!alias) return null
  const [byAlias] = await db.select().from(profiles).where(and(eq(profiles.id, alias.profileId), isNull(profiles.deletedAt))).limit(1)
  return byAlias ?? null
}

export async function whoIs(db: Database, user: TgUser): Promise<TgPerson> {
  const tgId = String(user.id)
  const profile = await profileByTg(db, tgId)
  return { tgId, user, profile, staff: isStaffRole(profile?.role) }
}

/** Короткий токен сотрудника для вызовов API кассы от его имени (права как в HUB). */
export async function staffHeaders(club: TgClub, profile: Profile): Promise<Record<string, string>> {
  const token = await signToken({ sub: profile.id, role: profile.role, nickname: profile.nickname, clubId: club.id }, '15m')
  return {
    authorization: `Bearer ${token}`,
    host: club.host,
    'x-real-ip': '127.0.0.1',
    'user-agent': 'Tai Telegram',
  }
}

/** Как обращаться к человеку: ник клуба, иначе имя из Telegram. */
export function displayName(person: TgPerson): string {
  return person.profile?.nickname || person.user.first_name || (person.user.username ? `@${person.user.username}` : 'друг')
}
