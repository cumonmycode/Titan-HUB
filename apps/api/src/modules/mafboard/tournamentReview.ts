import { randomUUID } from 'node:crypto'
import type { Context, Hono, MiddlewareHandler } from 'hono'
import { z } from 'zod'
import { body, fail, type Env, type MafboardDeps } from './router.js'
import { aimFailure, aimProtocolFor, editorData, protocolSchema, type ProtocolInput } from './tournaments.js'
import type { MafboardUser, StoredProtocolSubmission } from './types.js'

// ─────────────────────────────────────────────────────────────────────────────
// Протоколы обычных судей турниров GoMafia. Судья без прав на «Данные игр» не может сам
// внести стол в АИМ: его протокол ждёт ГС турнира, тот подтверждает (можно с правками) —
// и сервер вносит его в АИМ от имени ГС — или отклоняет с причиной. Оба узнают в боте.
// ─────────────────────────────────────────────────────────────────────────────

const REASON_MAX = 300
const rejectSchema = z.object({ reason: z.string().trim().min(1).max(REASON_MAX) })

export function submissionJSON(row: StoredProtocolSubmission) {
  return {
    id: row.id,
    gameNumber: row.gameNumber,
    tableNumber: row.tableNumber,
    refereeName: row.refereeName,
    status: row.status,
    reason: row.reason,
    protocol: row.protocol,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

function notify(deps: MafboardDeps, user: MafboardUser | null, text: string): void {
  const messenger = deps.messenger
  if (!messenger || !user || user.tgId <= 0) return
  deps.background(`mb:notify:${user.id}`, () => messenger.send(user.tgId, text))
}

/**
 * Протокол обычного судьи → очередь ГС. Стол должен быть его по рассадке GoMafia.
 * Ответ говорит, пользуется ли ГС MafBoard: если нет — приложение предложит поделиться ссылкой.
 */
export async function submitForReview(c: Context<Env>, tournamentId: number, input: ProtocolInput) {
  const deps = c.get('deps')
  const user = c.get('user')
  const player = user.gomafia!.player
  const tournament = (await deps.aimAccounts.tournaments(user.id)).find((candidate) => candidate.id === tournamentId)
  if (!tournament) return fail(c, 404, 'not_found', 'Турнира нет среди ваших турниров в АИМ')
  const seating = await deps.gomafiaSessions.run(user.id, (auth) => deps.tournaments.seating(tournamentId, auth))
  if (!seating) return fail(c, 502, 'gomafia_unavailable', 'GoMafia не отдала рассадку турнира, попробуйте позже')
  const table = seating.games.find((game) => game.number === input.gameNumber)?.tables.find((t) => t.number === input.tableNumber)
  if (!table) return fail(c, 409, 'table_mismatch', 'На GoMafia нет такого стола — обновите турнир')
  if (table.refereeId !== player.id) return fail(c, 403, 'not_your_table', 'Отправить протокол может только судья этого стола')

  const row = await deps.repo.upsertProtocolSubmission({
    id: randomUUID(),
    tournamentId,
    tournamentTitle: tournament.title,
    gameNumber: input.gameNumber,
    tableNumber: input.tableNumber,
    refereeUserId: user.id,
    refereeName: player.nickname,
    reviewerGomafiaId: seating.mainRefereeId,
    protocol: input,
    at: deps.now(),
  })
  const reviewer = seating.mainRefereeId != null ? await deps.repo.userByGomafiaId(seating.mainRefereeId) : null
  notify(
    deps,
    reviewer,
    `📝 ${player.nickname} прислал протокол: «${tournament.title}», игра ${input.gameNumber}, стол ${input.tableNumber}.\n` +
      'Откройте MafBoard → Турнир GoMafia, чтобы подтвердить и внести его в GoMafia.',
  )
  return c.json({ status: 'pending', submission: submissionJSON(row), reviewerUsesMafBoard: reviewer !== null })
}

export function registerReviewRoutes(router: Hono<Env>, requireUser: MiddlewareHandler<Env>): void {
  // Здесь, а не при загрузке модуля: tournaments.ts и этот модуль импортируют друг друга.
  const approveSchema = z.object({ protocol: protocolSchema.optional() })

  const tournamentId = (c: Context<Env>) => {
    const id = Number(c.req.param('id'))
    return Number.isInteger(id) && id > 0 ? id : null
  }

  /** Свои отправленные протоколы турнира — статус и причина отказа. */
  router.get('/v1/tournaments/:id/protocols/mine', requireUser, async (c) => {
    const deps = c.get('deps')
    const id = tournamentId(c)
    if (id === null) return fail(c, 404, 'not_found', 'Турнир не найден')
    const rows = await deps.repo.protocolSubmissions(id, { refereeUserId: c.get('user').id })
    return c.json({ protocols: rows.map(submissionJSON) })
  })

  /** Очередь ГС: протоколы судей турнира. По умолчанию — ждущие подтверждения. */
  router.get('/v1/tournaments/:id/protocols', requireUser, async (c) => {
    const deps = c.get('deps')
    const user = c.get('user')
    const id = tournamentId(c)
    if (id === null || !user.gomafia) return fail(c, 404, 'not_found', 'Турнир не найден')
    const status = c.req.query('status') === 'all' ? undefined : 'pending'
    try {
      if (!(await editorData(deps.aimAccounts, user.id, id))) return fail(c, 403, 'editor_required', 'Очередь протоколов видит только ГС турнира')
      const rows = await deps.repo.protocolSubmissions(id, status ? { status } : {})
      return c.json({ protocols: rows.map(submissionJSON) })
    } catch (error) {
      return aimFailure(c, error)
    }
  })

  /** ГС подтверждает протокол (можно с правками): сервер вносит его в АИМ от имени ГС. */
  router.post('/v1/tournaments/:id/protocols/:pid/approve', requireUser, body(approveSchema), async (c) => {
    const deps = c.get('deps')
    const user = c.get('user')
    const id = tournamentId(c)
    const row = id === null ? null : await deps.repo.protocolSubmissionById(c.req.param('pid'))
    if (!row || row.tournamentId !== id || !user.gomafia) return fail(c, 404, 'not_found', 'Протокол не найден')
    if (row.status !== 'pending') return fail(c, 409, 'already_decided', 'Протокол уже подтверждён или отклонён')
    const edited = c.req.valid('json').protocol
    // Номер игры и стола — из отправки судьи: ГС правит протокол, а не переносит его на другой стол.
    const protocol: ProtocolInput = { ...(edited ?? (row.protocol as ProtocolInput)), gameNumber: row.gameNumber, tableNumber: row.tableNumber }
    try {
      const games = await editorData(deps.aimAccounts, user.id, row.tournamentId)
      if (!games) return fail(c, 403, 'editor_required', 'Подтверждать протоколы может только ГС турнира')
      const target = aimProtocolFor(games, protocol)
      if (!target) return fail(c, 409, 'table_mismatch', 'В АИМ нет такого стола или рассадка изменилась')
      await deps.aimAccounts.saveProtocol(user.id, row.tournamentId, target.aimTableId, target.protocol)
      const decided = await deps.repo.decideProtocolSubmission(row.id, { status: 'saved', reason: null, protocol, decidedBy: user.id, at: deps.now() })
      if (!decided) return fail(c, 409, 'already_decided', 'Протокол уже подтверждён или отклонён')
      console.info(`[mafboard] протокол судьи внесён ГС: турнир ${row.tournamentId}, игра ${row.gameNumber}, стол ${row.tableNumber}, ГС ${user.id}`)
      notify(deps, await deps.repo.userById(row.refereeUserId),
        `✅ ГС внёс ваш протокол в GoMafia: «${row.tournamentTitle}», игра ${row.gameNumber}, стол ${row.tableNumber}.`)
      return c.json({ submission: submissionJSON(decided) })
    } catch (error) {
      return aimFailure(c, error)
    }
  })

  /** ГС отклоняет протокол с причиной: судья поправит и отправит заново. */
  router.post('/v1/tournaments/:id/protocols/:pid/reject', requireUser, body(rejectSchema), async (c) => {
    const deps = c.get('deps')
    const user = c.get('user')
    const id = tournamentId(c)
    const row = id === null ? null : await deps.repo.protocolSubmissionById(c.req.param('pid'))
    if (!row || row.tournamentId !== id || !user.gomafia) return fail(c, 404, 'not_found', 'Протокол не найден')
    const { reason } = c.req.valid('json')
    try {
      if (!(await editorData(deps.aimAccounts, user.id, row.tournamentId))) {
        return fail(c, 403, 'editor_required', 'Отклонять протоколы может только ГС турнира')
      }
      const decided = await deps.repo.decideProtocolSubmission(row.id, { status: 'rejected', reason, protocol: row.protocol, decidedBy: user.id, at: deps.now() })
      if (!decided) return fail(c, 409, 'already_decided', 'Протокол уже подтверждён или отклонён')
      notify(deps, await deps.repo.userById(row.refereeUserId),
        `↩️ ГС вернул протокол: «${row.tournamentTitle}», игра ${row.gameNumber}, стол ${row.tableNumber}.\nПричина: ${reason}`)
      return c.json({ submission: submissionJSON(decided) })
    } catch (error) {
      return aimFailure(c, error)
    }
  })
}
