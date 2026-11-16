import type { Context, Hono, MiddlewareHandler } from 'hono'
import { z } from 'zod'
import { clientIp } from '../../lib/clientIp.js'
import { AimError } from '../../lib/gomafiaAim.js'
import type { AimGame, AimProtocol, AimTable, AimTournament } from '../../lib/gomafiaAimParse.js'
import type { TournamentSeating, TournamentTable } from '../../lib/gomafiaTournament.js'
import { AimNotConnectedError, type AimAccounts } from './aim.js'
import { body, fail, ipKey, type Env } from './router.js'

// ─────────────────────────────────────────────────────────────────────────────
// Режим «Турнир GoMafia»: турниры пользователя из АИМ, рассадка с gomafia.pro и протоколы.
// Спецификация — ios/docs/GOMAFIA-TOURNAMENT.md в репозитории MafBoardStudio.
//
// Права: редактор протокола — тот, кому АИМ открывает «Данные игр» турнира (обычно ГС, но
// и организатор, если он ГС). Он видит все игры и столы вместе с внесёнными протоколами.
// Остальные судьи видят только свои столы (`referee_id` стола = их GoMafia id).
// ─────────────────────────────────────────────────────────────────────────────

export type TournamentRole = 'editor' | 'referee'

const AIM_CONNECT_LIMIT = { count: 5, windowSec: 600 }
const AIM_CONNECT_IP_LIMIT = { count: 20, windowSec: 3600 }
const TOURNAMENTS_PER_MIN = 30
/** Завершённые и заблокированные турниры судье уже не нужны. */
const CLOSED_STATUSES: ReadonlySet<string> = new Set(['completed', 'blocked'])

const PROTOCOLS_PER_HOUR = 120
const SEATS_PER_TABLE = 10

const points = z.number().min(-10).max(10)
const protocolSchema = z.object({
  gameNumber: z.number().int().positive(),
  tableNumber: z.number().int().positive(),
  win: z.enum(['city', 'mafia', 'draw']),
  seats: z
    .array(
      z.object({
        place: z.number().int().min(1).max(SEATS_PER_TABLE),
        role: z.enum(['sheriff', 'red', 'mafia', 'don']),
        firstKill: z.enum(['no', 'guessed_wrong', '1-ka', '2-ka', '3-ka']),
        selfKill: z.boolean(),
        sheriffOpen: z.boolean(),
        extraPoint: points,
        fine: points,
        fineDiscipline: points,
        replacement: z.boolean(),
      }),
    )
    .length(SEATS_PER_TABLE),
})
export type ProtocolInput = z.infer<typeof protocolSchema>

/**
 * Протокол приложения → форма АИМ: стол ищется по номеру игры и стола, места — по номеру
 * места (id мест в АИМ свои). null — такого стола или места в АИМ нет.
 */
export function aimProtocolFor(games: AimGame[], input: ProtocolInput): { aimTableId: number; protocol: AimProtocol } | null {
  const table = games.find((game) => game.number === input.gameNumber)?.tables.find((candidate) => candidate.number === input.tableNumber)
  if (!table || table.seats.length !== input.seats.length) return null
  const seats = []
  for (const aimSeat of table.seats) {
    const seat = input.seats.find((candidate) => candidate.place === aimSeat.place)
    if (!seat) return null
    seats.push({ aimSeatId: aimSeat.aimSeatId, ...seat })
  }
  return { aimTableId: table.aimTableId, protocol: { win: input.win, seats } }
}

const aimLoginSchema = z.object({ login: z.string().trim().min(1).max(100), password: z.string().min(1).max(200) })

/** Ошибки АИМ → ответ приложению. Пароль и ответы АИМ в лог не пишутся. */
export function aimFailure(c: Context, error: unknown) {
  if (error instanceof AimNotConnectedError) {
    return fail(c, 409, 'aim_not_connected', 'Подключите АИМ: войдите в GoMafia ещё раз в профиле')
  }
  if (error instanceof AimError) {
    switch (error.code) {
      case 'bad_credentials':
        return fail(c, 409, 'aim_relogin_required', 'АИМ не принял сохранённый пароль — войдите в GoMafia ещё раз')
      case 'access_denied':
        return fail(c, 403, 'aim_access_denied', 'Нет доступа к протоколу этого турнира')
      case 'rejected':
        return fail(c, 422, 'aim_rejected', error.message)
      default:
        return fail(c, 502, 'aim_unavailable', 'АИМ не отвечает, попробуйте позже')
    }
  }
  throw error
}

/** Протокол турнира, если пользователь — его редактор; null — АИМ не открывает ему «Данные игр». */
async function editorData(aim: AimAccounts, userId: string, tournamentId: number): Promise<AimGame[] | null> {
  try {
    return await aim.gameData(userId, tournamentId)
  } catch (error) {
    if (error instanceof AimError && error.code === 'access_denied') return null
    throw error
  }
}

function tournamentJSON(tournament: AimTournament, role: TournamentRole) {
  return {
    id: tournament.id,
    title: tournament.title,
    dateStart: tournament.dateStart,
    dateEnd: tournament.dateEnd,
    city: tournament.city,
    mainReferee: tournament.mainReferee,
    status: tournament.status,
    role,
  }
}

function protocolJSON(table: AimTable) {
  return {
    win: table.win,
    seats: table.seats.map((seat) => ({
      place: seat.place,
      login: seat.login,
      role: seat.role,
      firstKill: seat.firstKill,
      selfKill: seat.selfKill,
      sheriffOpen: seat.sheriffOpen,
      extraPoint: seat.extraPoint,
      fine: seat.fine,
      fineDiscipline: seat.fineDiscipline,
      replacement: seat.replacement,
    })),
  }
}

function tableJSON(table: TournamentTable, mine: boolean, protocol: AimTable | undefined) {
  return {
    number: table.number,
    refereeId: table.refereeId,
    refereeName: table.refereeName,
    isMine: mine,
    win: table.win,
    seats: table.seats.map((seat) => ({ place: seat.place, playerId: seat.playerId, login: seat.login, elo: seat.elo })),
    ...(protocol ? { protocol: protocolJSON(protocol) } : {}),
  }
}

/**
 * Игры турнира для пользователя. Редактор видит все столы и внесённые протоколы (из АИМ,
 * по номеру игры и стола), судья — только свои столы; игры без его столов опускаются.
 */
export function tournamentGamesJSON(seating: TournamentSeating, gomafiaId: number, aimGames: AimGame[] | null) {
  const editor = aimGames !== null
  return seating.games
    .map((game) => {
      const aimGame = aimGames?.find((candidate) => candidate.number === game.number)
      const tables = game.tables
        .filter((table) => editor || table.refereeId === gomafiaId)
        .map((table) =>
          tableJSON(table, table.refereeId === gomafiaId, aimGame?.tables.find((candidate) => candidate.number === table.number)),
        )
      return { number: game.number, stage: game.stage, tables }
    })
    .filter((game) => game.tables.length > 0)
}

export function registerTournamentRoutes(router: Hono<Env>, requireUser: MiddlewareHandler<Env>): void {
  /** Подключён ли вход в АИМ. */
  router.get('/v1/me/gomafia/aim', requireUser, async (c) => {
    const deps = c.get('deps')
    return c.json({ connected: await deps.aimAccounts.connected(c.get('user').id) })
  })

  /**
   * Подключить АИМ отдельно — если пароль АИМ не совпал с паролем GoMafia при привязке или
   * сменился. Пароль сохраняется шифротекстом: протоколы в АИМ вносит сервер.
   */
  router.post('/v1/me/gomafia/aim', requireUser, body(aimLoginSchema), async (c) => {
    const deps = c.get('deps')
    const user = c.get('user')
    if (!user.gomafia) return fail(c, 403, 'gomafia_required', 'Сначала привяжите аккаунт GoMafia')
    const strict = { failClosed: true }
    const allowed =
      (await deps.limiter.hit(`mb:aim:${user.id}`, AIM_CONNECT_LIMIT.count, AIM_CONNECT_LIMIT.windowSec, strict)) &&
      (await deps.limiter.hit(`mb:aim:ip:${ipKey(clientIp(c))}`, AIM_CONNECT_IP_LIMIT.count, AIM_CONNECT_IP_LIMIT.windowSec, strict))
    if (!allowed) return fail(c, 429, 'rate_limited', 'Слишком много попыток входа в АИМ, попробуйте позже')
    const { login, password } = c.req.valid('json')
    try {
      await deps.aimAccounts.connect(user.id, login, password)
    } catch (error) {
      if (error instanceof AimError && error.code === 'bad_credentials') {
        return fail(c, 422, 'bad_credentials', 'Неверный логин или пароль АИМ')
      }
      return aimFailure(c, error)
    }
    return c.json({ connected: true })
  })

  /** Отключить АИМ: сохранённый пароль стирается. */
  router.delete('/v1/me/gomafia/aim', requireUser, async (c) => {
    const deps = c.get('deps')
    await deps.aimAccounts.disconnect(c.get('user').id)
    return c.json({ connected: false })
  })

  /** Незавершённые турниры пользователя из АИМ и его роль в каждом. */
  router.get('/v1/tournaments', requireUser, async (c) => {
    const deps = c.get('deps')
    const user = c.get('user')
    if (!user.gomafia) return fail(c, 403, 'gomafia_required', 'Турниры доступны после привязки GoMafia')
    if (!(await deps.limiter.hit(`mb:tournaments:${user.id}`, TOURNAMENTS_PER_MIN, 60))) {
      return fail(c, 429, 'rate_limited', 'Слишком много запросов, попробуйте через минуту')
    }
    try {
      const all = await deps.aimAccounts.tournaments(user.id)
      const open = all.filter((tournament) => !CLOSED_STATUSES.has(tournament.status))
      const result = []
      // По очереди: одна сессия АИМ на пользователя, а открытых турниров у судьи единицы.
      for (const tournament of open) {
        const data = await editorData(deps.aimAccounts, user.id, tournament.id)
        result.push(tournamentJSON(tournament, data ? 'editor' : 'referee'))
      }
      return c.json({ tournaments: result })
    } catch (error) {
      return aimFailure(c, error)
    }
  })

  /** Турнир: схема, игры и столы. Редактору — все столы с протоколами, судье — только свои. */
  router.get('/v1/tournaments/:id', requireUser, async (c) => {
    const deps = c.get('deps')
    const user = c.get('user')
    if (!user.gomafia) return fail(c, 403, 'gomafia_required', 'Турниры доступны после привязки GoMafia')
    const id = Number(c.req.param('id'))
    if (!Number.isInteger(id) || id <= 0) return fail(c, 404, 'not_found', 'Турнир не найден')
    if (!(await deps.limiter.hit(`mb:tournaments:${user.id}`, TOURNAMENTS_PER_MIN, 60))) {
      return fail(c, 429, 'rate_limited', 'Слишком много запросов, попробуйте через минуту')
    }
    try {
      // Турнир должен быть в разделе «Турниры» пользователя в АИМ — иначе он к нему не относится.
      const tournament = (await deps.aimAccounts.tournaments(user.id)).find((candidate) => candidate.id === id)
      if (!tournament) return fail(c, 404, 'not_found', 'Турнира нет среди ваших турниров в АИМ')
      const [aimGames, seating] = await Promise.all([editorData(deps.aimAccounts, user.id, id), deps.tournaments.seating(id)])
      if (!seating) return fail(c, 502, 'gomafia_unavailable', 'GoMafia не отдала рассадку турнира, попробуйте позже')
      const role: TournamentRole = aimGames ? 'editor' : 'referee'
      return c.json({
        tournament: { ...tournamentJSON(tournament, role), hiddenResults: seating.hiddenResults, scheme: seating.scheme },
        role,
        games: tournamentGamesJSON(seating, user.gomafia.player.id, aimGames),
      })
    } catch (error) {
      return aimFailure(c, error)
    }
  })

  /**
   * Внести протокол стола в АИМ от имени редактора турнира. Судье без прав на «Данные игр» —
   * 403 `editor_required`: его результат подтверждает ГС (этап 4).
   */
  router.post('/v1/tournaments/:id/protocols', requireUser, body(protocolSchema), async (c) => {
    const deps = c.get('deps')
    const user = c.get('user')
    if (!user.gomafia) return fail(c, 403, 'gomafia_required', 'Турниры доступны после привязки GoMafia')
    const id = Number(c.req.param('id'))
    if (!Number.isInteger(id) || id <= 0) return fail(c, 404, 'not_found', 'Турнир не найден')
    if (!(await deps.limiter.hit(`mb:protocols:${user.id}`, PROTOCOLS_PER_HOUR, 3600))) {
      return fail(c, 429, 'rate_limited', 'Слишком много отправок, попробуйте позже')
    }
    const input = c.req.valid('json')
    try {
      const games = await editorData(deps.aimAccounts, user.id, id)
      if (!games) return fail(c, 403, 'editor_required', 'Вносить протоколы этого турнира может только ГС')
      const target = aimProtocolFor(games, input)
      if (!target) return fail(c, 409, 'table_mismatch', 'В АИМ нет такого стола или рассадка изменилась — обновите турнир')
      await deps.aimAccounts.saveProtocol(user.id, id, target.aimTableId, target.protocol)
      // Журнал внесения: кто, турнир, игра и стол. Без данных входа.
      console.info(`[mafboard] протокол внесён: турнир ${id}, игра ${input.gameNumber}, стол ${input.tableNumber}, пользователь ${user.id}`)
      return c.json({ status: 'saved' })
    } catch (error) {
      return aimFailure(c, error)
    }
  })
}
