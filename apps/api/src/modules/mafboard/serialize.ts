import type { GomafiaPlayer } from '../../lib/gomafia.js'
import type { DeviceSession, ErrorBody, GoMafiaClubJSON, GoMafiaPlayerJSON, LoginTicket, MafboardUser } from './types.js'

// Перевод внутренних данных в JSON-контракт приложения (docs/MAFBOARD.md).

const GOMAFIA_ORIGIN = 'https://gomafia.pro'

export function errorBody(code: string, message: string): ErrorBody {
  return { error: { code, message } }
}

// ─── Телефон ─────────────────────────────────────────────────────────────────

/** Номер из контакта Telegram → E.164 («79161234567» → «+79161234567»). null — не похоже на номер. */
export function normalizePhone(raw: string): string | null {
  let digits = raw.replace(/\D/g, '')
  if (digits.length === 11 && digits.startsWith('8')) digits = `7${digits.slice(1)}`
  if (digits.length < 8 || digits.length > 15) return null
  return `+${digits}`
}

/** «+79161234567» → «+7 *** ***-45-67». В приложение полный номер не уходит. */
export function maskPhone(e164: string | null): string | null {
  if (!e164) return null
  const digits = e164.replace(/\D/g, '')
  const tail = digits.slice(-4)
  const country = digits.startsWith('7') ? '7' : digits.slice(0, Math.max(1, digits.length - 10))
  return `+${country} *** ***-${tail.slice(0, 2)}-${tail.slice(2)}`
}

// ─── GoMafia ─────────────────────────────────────────────────────────────────

function avatarUrl(raw: string | null): string | null {
  if (!raw) return null
  const candidate = raw.startsWith('/') ? `${GOMAFIA_ORIGIN}${raw}` : raw
  try {
    const url = new URL(candidate)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null
  } catch {
    return null
  }
}

function intOrNull(value: string | number | null | undefined): number | null {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isInteger(n) ? n : null
}

/** Игрок из lib/gomafia → формат приложения. null, если у записи нет числового id. */
export function toPlayerJSON(player: GomafiaPlayer, isInHostClub: boolean): GoMafiaPlayerJSON | null {
  const id = intOrNull(player.gomafiaId)
  if (id == null) return null
  return {
    id,
    nickname: player.login || player.fullName || `#${id}`,
    fullName: player.fullName,
    avatarURL: avatarUrl(player.avatar),
    elo: player.elo,
    clubID: intOrNull(player.clubId),
    clubTitle: player.clubTitle,
    city: player.city,
    tournamentsPlayed: player.tournaments == null ? null : Math.round(player.tournaments),
    isInHostClub,
  }
}

export function toClubJSON(club: { id: string; title: string | null; city: string | null }): GoMafiaClubJSON | null {
  const id = intOrNull(club.id)
  if (id == null) return null
  return { id, title: club.title ?? `Клуб #${id}`, city: club.city }
}

// ─── Аккаунт и вход ──────────────────────────────────────────────────────────

/** `UserAccount` приложения. */
export function toAccountJSON(user: MafboardUser) {
  return {
    id: user.id,
    telegram: {
      id: user.tgId,
      username: user.tgUsername,
      firstName: user.tgFirstName,
      lastName: user.tgLastName,
    },
    maskedPhone: maskPhone(user.phone),
    acceptedTermsVersion: user.termsVersion,
    goMafia: user.gomafia
      ? {
          player: user.gomafia.player,
          club: user.gomafia.club,
          linkedAt: user.gomafia.linkedAt.toISOString(),
          syncedAt: user.gomafia.syncedAt.toISOString(),
        }
      : null,
  }
}

/** Сессии для блока «Сессии» в профиле: текущая первой, остальные — по свежести. */
export function toSessionsJSON(sessions: DeviceSession[], currentId: string) {
  const isCurrent = (s: DeviceSession) => s.id === currentId
  return [...sessions]
    .sort((a, b) => Number(isCurrent(b)) - Number(isCurrent(a)) || b.lastUsedAt.getTime() - a.lastUsedAt.getTime())
    .map((s) => ({
      id: s.id,
      deviceName: s.deviceName,
      platform: s.platform,
      createdAt: s.createdAt.toISOString(),
      lastUsedAt: s.lastUsedAt.toISOString(),
      isCurrent: isCurrent(s),
    }))
}

/** Статус билета для опроса приложением. */
export function toTicketStatusJSON(ticket: LoginTicket, now: Date) {
  if (ticket.status === 'rejected') return { status: 'rejected', note: ticket.note }
  if (ticket.status === 'claimed' || ticket.expiresAt <= now) return { status: 'expired' }
  if (ticket.status === 'confirmed') return { status: 'confirmed' }
  return { status: 'pending', opened: ticket.openedAt != null }
}

/** Universal Link, по которому бот возвращает пользователя в приложение. */
export function returnLink(appLinkBase: string, ticketId: string): string {
  return `${appLinkBase}/auth/return?ticket=${encodeURIComponent(ticketId)}`
}
