import { randomBytes } from 'node:crypto'
import type { Context, Hono, MiddlewareHandler } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import { MAX_UPLOAD_BYTES } from '../../lib/imageStore.js'
import { PLAYER_LINK_PREFIX } from './clubBot.js'
import { membershipOf, ownedClub } from './clubs.js'
import { CLUB_PLAYER_ID, isKnownPlayerID, newClubPlayerID } from './playerIds.js'
import type { MafboardEnv } from './router.js'
import { body, fail } from './router.js'
import { errorBody } from './serialize.js'
import { sha256 } from './tokens.js'
import type { StoredClubPlayer } from './types.js'

// ─────────────────────────────────────────────────────────────────────────────
// Состав клуба MafBoard (docs/MAFBOARD.md, «Клуб без подключений»):
//   POST   /v1/clubs/:id/players {nickname}             — свой игрок клуба (владелец);
//   PATCH  /v1/clubs/:id/players/:playerID {nickname}   — переименовать (владелец);
//   DELETE /v1/clubs/:id/players/:playerID              — убрать в архив (владелец): старые игры не ломаются;
//   PUT    /v1/clubs/:id/players/:playerID/photo        — фото игрока (тело — сама картинка; владелец и судьи);
//   DELETE /v1/clubs/:id/players/:playerID/photo        — снова фото из Titan HUB / GoMafia;
//   POST   /v1/clubs/:id/players/:playerID/link         — ссылка игрока на бота, чтобы он сам менял фото.
// Фото и ссылка — для любого игрока клуба: своего, из GoMafia или из Titan HUB.
// ─────────────────────────────────────────────────────────────────────────────

const PLAYERS_PER_CLUB = 500
const PHOTOS_PER_HOUR = 60
const LINKS_PER_HOUR = 30
const LINK_TTL_MS = 7 * 24 * 60 * 60_000

const nicknameSchema = z.object({ nickname: z.string().trim().min(1).max(40) })

const photoBodyLimit = bodyLimit({
  maxSize: MAX_UPLOAD_BYTES,
  onError: (c) => c.json(errorBody('too_large', 'Фото больше 8 МБ'), 413),
})

function toClubPlayerJSON(player: StoredClubPlayer) {
  return { playerID: player.playerId, nickname: player.nickname, createdAt: player.createdAt.toISOString() }
}

/** Номер игрока из адреса: только известные виды (GoMafia, Titan, свой) — в нижнем регистре. */
function playerIdOf(c: Context<MafboardEnv>): string | null {
  const id = (c.req.param('playerID') ?? '').toLowerCase()
  return isKnownPlayerID(id) ? id : null
}

/** Свой игрок должен быть в этом клубе и не убран; игроков GoMafia и Titan сверять не с чем — их состав внешний. */
async function playerOfClub(c: Context<MafboardEnv>, clubId: string): Promise<string | Response> {
  const playerId = playerIdOf(c)
  if (!playerId) return fail(c, 404, 'not_found', 'Такого игрока нет')
  if (!CLUB_PLAYER_ID.test(playerId)) return playerId
  const own = await c.get('deps').repo.clubPlayers(clubId, false)
  return own.some((player) => player.playerId === playerId) ? playerId : fail(c, 404, 'not_found', 'Такого игрока в клубе нет')
}

export function registerClubRosterRoutes(router: Hono<MafboardEnv>, requireUser: MiddlewareHandler<MafboardEnv>): void {
  router.post('/v1/clubs/:id/players', requireUser, body(nicknameSchema), async (c) => {
    const owned = ownedClub(c)
    if (owned instanceof Response) return owned
    const deps = c.get('deps')
    const current = await deps.repo.clubPlayers(owned.club.id, false)
    if (current.length >= PLAYERS_PER_CLUB) return fail(c, 422, 'too_many_players', `В клубе не больше ${PLAYERS_PER_CLUB} своих игроков`)
    const added = await deps.repo.addClubPlayer({
      clubId: owned.club.id,
      playerId: newClubPlayerID(),
      nickname: c.req.valid('json').nickname,
      createdBy: c.get('user').id,
      createdAt: deps.now(),
      archivedAt: null,
    })
    if (added === 'nickname_taken') return fail(c, 409, 'nickname_taken', 'Игрок с таким ником в клубе уже есть')
    return c.json({ player: toClubPlayerJSON(added) }, 201)
  })

  router.patch('/v1/clubs/:id/players/:playerID', requireUser, body(nicknameSchema), async (c) => {
    const owned = ownedClub(c)
    if (owned instanceof Response) return owned
    const playerId = playerIdOf(c)
    if (!playerId || !CLUB_PLAYER_ID.test(playerId)) return fail(c, 422, 'validation', 'Переименовать можно только своего игрока клуба')
    const renamed = await c.get('deps').repo.renameClubPlayer(owned.club.id, playerId, c.req.valid('json').nickname)
    if (renamed === 'nickname_taken') return fail(c, 409, 'nickname_taken', 'Игрок с таким ником в клубе уже есть')
    if (!renamed) return fail(c, 404, 'not_found', 'Такого игрока в клубе нет')
    return c.json({ player: toClubPlayerJSON(renamed) })
  })

  router.delete('/v1/clubs/:id/players/:playerID', requireUser, async (c) => {
    const owned = ownedClub(c)
    if (owned instanceof Response) return owned
    const playerId = playerIdOf(c)
    if (!playerId || !CLUB_PLAYER_ID.test(playerId)) return fail(c, 422, 'validation', 'Убрать можно только своего игрока клуба')
    const archived = await c.get('deps').repo.archiveClubPlayer(owned.club.id, playerId, c.get('deps').now())
    if (!archived) return fail(c, 404, 'not_found', 'Такого игрока в клубе нет')
    return c.json({ ok: true })
  })

  router.put('/v1/clubs/:id/players/:playerID/photo', photoBodyLimit, requireUser, async (c) => {
    const membership = membershipOf(c)
    if (membership instanceof Response) return membership
    const deps = c.get('deps')
    const user = c.get('user')
    const playerId = await playerOfClub(c, membership.club.id)
    if (playerId instanceof Response) return playerId
    if (!(await deps.limiter.hit(`mb:club:photo:${user.id}`, PHOTOS_PER_HOUR, 3600))) {
      return fail(c, 429, 'rate_limited', 'Слишком много фото, попробуйте позже')
    }
    const stored = await deps.images.store(Buffer.from(await c.req.arrayBuffer()))
    if (!stored.ok) {
      return stored.status === 400 ? fail(c, 422, 'invalid_photo', stored.error) : fail(c, 503, 'storage_unavailable', 'Не удалось сохранить фото, попробуйте позже')
    }
    await deps.repo.setPlayerPhoto({
      clubId: membership.club.id, playerId, url: stored.url, setByUser: user.id, setByTg: null, setAt: deps.now(),
    })
    return c.json({ playerID: playerId, photoURL: stored.url })
  })

  router.delete('/v1/clubs/:id/players/:playerID/photo', requireUser, async (c) => {
    const membership = membershipOf(c)
    if (membership instanceof Response) return membership
    const playerId = playerIdOf(c)
    if (!playerId) return fail(c, 404, 'not_found', 'Такого игрока нет')
    await c.get('deps').repo.clearPlayerPhoto(membership.club.id, playerId)
    return c.json({ ok: true })
  })

  router.post('/v1/clubs/:id/players/:playerID/link', requireUser, async (c) => {
    const membership = membershipOf(c)
    if (membership instanceof Response) return membership
    const deps = c.get('deps')
    const user = c.get('user')
    const playerId = await playerOfClub(c, membership.club.id)
    if (playerId instanceof Response) return playerId
    const botUsername = deps.config.botUsername ?? (await deps.messenger?.username()) ?? null
    if (!botUsername) return fail(c, 503, 'bot_unavailable', 'Бот MafBoard временно недоступен')
    if (!(await deps.limiter.hit(`mb:club:player-link:${user.id}`, LINKS_PER_HOUR, 3600))) {
      return fail(c, 429, 'rate_limited', 'Слишком много ссылок, попробуйте позже')
    }
    // 24 байта в base64url — 32 знака: вместе с «p_» влезает в параметр /start (до 64 знаков, [A-Za-z0-9_-]).
    const token = randomBytes(24).toString('base64url')
    const now = deps.now()
    const expiresAt = new Date(now.getTime() + LINK_TTL_MS)
    await deps.repo.createPlayerLinkToken({
      tokenHash: sha256(token), clubId: membership.club.id, playerId, createdBy: user.id, createdAt: now, expiresAt, usedAt: null,
    })
    return c.json({ url: `https://t.me/${botUsername}?start=${PLAYER_LINK_PREFIX}${token}`, expiresAt: expiresAt.toISOString() }, 201)
  })
}
