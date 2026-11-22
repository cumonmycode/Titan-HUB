import { z } from 'zod'
import { SUPPORTED_GAME_SCHEMA_VERSION } from './config.js'
import { TITAN_PLAYER_ID } from './titan.js'
import type { HostAccess, MafboardUser, StoredGame } from './types.js'

// Приём завершённой игры (GameRecord приложения). Запись хранится целиком; сервер
// проверяет только то, от чего зависят права и история клуба.

/** PlayerID игрока GoMafia в приложении: UUID с префиксом «mafbgm» (PlayerID.goMafia). */
const GOMAFIA_PLAYER_ID = /^6d616662-676d-8000-8000-[0-9a-f]{12}$/i
const MAX_FUTURE_MS = 24 * 60 * 60_000

const recordSchema = z
  .object({
    schemaVersion: z.number().int().min(1),
    setup: z
      .object({
        gameID: z.string().uuid(),
        format: z.enum(['funky', 'rating', 'miniCup', 'tournament']),
        ruleset: z.object({ variant: z.enum(['sport', 'city']) }).passthrough(),
        host: z
          .object({
            userID: z.string().uuid(),
            goMafiaPlayerID: z.number().int().nullish(),
            clubID: z.number().int().nullish(),
            /** Клуб MafBoard игры: у клуба без GoMafia — единственная привязка к клубу. */
            clubRef: z.string().uuid().nullish(),
          })
          .nullish(),
        /** Игра турнира GoMafia (режим «Турнир GoMafia»): турнир, номер игры и стол. */
        tournament: z
          .object({ tournamentID: z.number().int().positive(), gameNumber: z.number().int().positive(), tableNumber: z.number().int().positive() })
          .passthrough()
          .nullish(),
        seats: z.array(z.object({ seat: z.number().int(), playerID: z.string().uuid(), role: z.string() }).passthrough()).min(1).max(30),
        createdAt: z.string(),
      })
      .passthrough(),
    finishedAt: z.string(),
    outcome: z.object({ winner: z.enum(['red', 'black', 'draw']) }).passthrough(),
  })
  .passthrough()

export type GameUploadResult =
  | { ok: true; game: StoredGame }
  | { ok: false; status: 403 | 422; code: string; message: string }

function parseDate(value: string): Date | null {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

const fail = (status: 403 | 422, code: string, message: string): GameUploadResult => ({ ok: false, status, code, message })

/**
 * Проверить загружаемую игру от имени ведущего:
 *  • ведущий в записи — это владелец токена;
 *  • рейтинг/миникап/турнир — у президента клуба GoMafia и судей из его пула (`access`), с игроками
 *    GoMafia и (если президент подключил клуб Titan HUB) клиентами клуба без GoMafia; гостей там нет;
 *  • игра турнира GoMafia — у судьи с привязанным GoMafia, клуб не нужен; игроки — только из GoMafia;
 *  • игры ведущего клуба (включая фанки) идут в историю клуба, остальные — в личную.
 */
export function validateGameUpload(body: unknown, user: MafboardUser, access: HostAccess, now: Date): GameUploadResult {
  const parsed = recordSchema.safeParse(body)
  if (!parsed.success) return fail(422, 'invalid_record', 'Запись игры повреждена или неполная')
  const record = parsed.data
  const { setup } = record

  if (record.schemaVersion > SUPPORTED_GAME_SCHEMA_VERSION) {
    return fail(422, 'unsupported_schema', 'Игра сохранена более новой версией приложения — обновите сервер')
  }
  if (!setup.host || setup.host.userID.toLowerCase() !== user.id.toLowerCase()) {
    return fail(403, 'host_mismatch', 'Игру может сохранить только её ведущий')
  }

  const startedAt = parseDate(setup.createdAt)
  const finishedAt = parseDate(record.finishedAt)
  if (!startedAt || !finishedAt || finishedAt.getTime() > now.getTime() + MAX_FUTURE_MS) {
    return fail(422, 'invalid_dates', 'Некорректные даты игры')
  }

  // Игра клуба MafBoard: её ведёт член этого клуба — владелец или судья (из GoMafia или по приглашению).
  // Все игры клуба, включая фанки, идут в его историю. Турнир GoMafia — по своим правилам ниже.
  const clubRef = setup.host.clubRef?.toLowerCase() ?? null
  if (clubRef && !setup.tournament) {
    const membership = access.clubs.find((entry) => entry.club.id === clubRef)
    if (!membership) return fail(403, 'club_access_required', 'Игры клуба ведут его владелец и судьи')
    if (setup.format !== 'funky') {
      const clubTitan = membership.titan != null
      const allowed = (id: string) => GOMAFIA_PLAYER_ID.test(id) || (clubTitan && TITAN_PLAYER_ID.test(id))
      if (!setup.seats.every((seat) => allowed(seat.playerID))) {
        return fail(422, 'guest_players', 'В рейтинговых играх все игроки должны быть из GoMafia или клуба Titan HUB')
      }
    }
    return {
      ok: true,
      game: {
        id: setup.gameID.toLowerCase(),
        hostUserId: user.id,
        clubId: membership.club.gomafiaClubId,
        clubRef,
        format: setup.format,
        variant: setup.ruleset.variant,
        startedAt,
        finishedAt,
        schemaVersion: record.schemaVersion,
        record: body,
      },
    }
  }

  // Резидент без доступа от президента игр клуба не ведёт: его фанки идут в личную историю.
  const userClubId = access.club === 'none' ? null : (user.gomafia?.club?.id ?? null)
  const hostClubId = setup.host.clubID ?? null
  if (setup.tournament) {
    // Судья турнира GoMafia может быть из любого клуба или без клуба: права даёт сам турнир.
    if (setup.format !== 'tournament') return fail(422, 'invalid_record', 'Игра турнира GoMafia должна быть в режиме «Турнир»')
    if (!user.gomafia) return fail(403, 'gomafia_required', 'Турниры GoMafia доступны после привязки GoMafia')
    if (!setup.seats.every((seat) => GOMAFIA_PLAYER_ID.test(seat.playerID))) {
      return fail(422, 'guest_players', 'В турнире GoMafia все игроки должны быть из GoMafia')
    }
  } else if (setup.format !== 'funky') {
    const hasTitan = access.titan != null
    if (userClubId == null && !hasTitan) {
      return user.gomafia?.club
        ? fail(403, 'host_access_required', 'Рейтинговые игры клуба ведут судьи, которым президент клуба дал доступ в MafBoard')
        : fail(403, 'club_required', 'Этот режим доступен судьям клуба GoMafia')
    }
    if (hostClubId !== userClubId) return fail(403, 'club_mismatch', 'Игра проведена от имени другого клуба')
    const known = (id: string) => GOMAFIA_PLAYER_ID.test(id) || (hasTitan && TITAN_PLAYER_ID.test(id))
    if (!setup.seats.every((seat) => known(seat.playerID))) {
      return fail(422, 'guest_players', 'В рейтинговых играх все игроки должны быть из GoMafia или клуба Titan HUB')
    }
  }

  return {
    ok: true,
    game: {
      id: setup.gameID.toLowerCase(),
      hostUserId: user.id,
      clubId: userClubId != null && hostClubId === userClubId ? userClubId : null,
      format: setup.format,
      variant: setup.ruleset.variant,
      startedAt,
      finishedAt,
      schemaVersion: record.schemaVersion,
      record: body,
    },
  }
}
