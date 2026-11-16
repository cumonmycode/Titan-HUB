import { z } from 'zod'
import { SUPPORTED_GAME_SCHEMA_VERSION } from './config.js'
import { TITAN_PLAYER_ID } from './titan.js'
import type { MafboardUser, StoredGame } from './types.js'

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
          })
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
 *  • рейтинг/миникап/турнир — у ведущего с клубом GoMafia или подключённым клубом Titan HUB, с игроками
 *    GoMafia и (при подключённом Titan) клиентами клуба без GoMafia; гостей там нет;
 *  • игры ведущего клуба (включая фанки) идут в историю клуба, остальные — в личную.
 */
export function validateGameUpload(body: unknown, user: MafboardUser, now: Date): GameUploadResult {
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

  const userClubId = user.gomafia?.club?.id ?? null
  const hostClubId = setup.host.clubID ?? null
  if (setup.format !== 'funky') {
    const hasTitan = user.titan != null
    if (userClubId == null && !hasTitan) return fail(403, 'club_required', 'Этот режим доступен ведущему клуба GoMafia или Titan HUB')
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
