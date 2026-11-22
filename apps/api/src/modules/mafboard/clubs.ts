import { randomBytes, randomUUID } from 'node:crypto'
import type { Context, Hono, MiddlewareHandler } from 'hono'
import { z } from 'zod'
import type { ClubMembership } from './clubAccess.js'
import { hostAccess } from './clubHosts.js'
import { respondClubPlayers } from './clubPlayers.js'
import type { MafboardEnv } from './router.js'
import { body, fail } from './router.js'
import { toAccountJSON } from './serialize.js'
import { clearMirrors, disconnectClub, exchangeTitanCode, releaseLink } from './titanRoutes.js'
import { sha256 } from './tokens.js'
import type { MafboardUser } from './types.js'

// ─────────────────────────────────────────────────────────────────────────────
// Клубы MafBoard (docs/MAFBOARD.md, раздел «Клубы»):
//   POST   /v1/clubs {code}                    — клуб без GoMafia по коду Titan Connect, владелец — вы;
//   GET    /v1/clubs/:id/members, DELETE …/:userId — участники (владелец);
//   POST/GET /v1/clubs/:id/invites, DELETE …/:inviteId — ссылки-приглашения (владелец);
//   POST   /v1/clubs/join {token}              — вступить по ссылке судьёй;
//   GET    /v1/clubs/:id/players               — состав клуба (члены клуба);
//   PUT/DELETE /v1/clubs/:id/titan             — подключение Titan клуба (владелец).
// ─────────────────────────────────────────────────────────────────────────────

const INVITE_TTL_MS = 7 * 24 * 60 * 60_000
const JOIN_PER_HOUR = 20
const INVITES_PER_HOUR = 30
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const codeSchema = z.object({ code: z.string().trim().min(6).max(20) })
const joinSchema = z.object({ token: z.string().trim().min(16).max(128) })

/** Клуб пользователя по id из адреса; не член клуба — ответ 403 (клуба нет — тоже 403: не выдаём, что он есть). */
function membershipOf(c: Context<MafboardEnv>): ClubMembership | Response {
  const id = (c.req.param('id') ?? '').toLowerCase()
  const membership = UUID.test(id) ? c.get('access').clubs.find((entry) => entry.club.id === id) : undefined
  return membership ?? fail(c, 403, 'club_access_required', 'Клуб доступен его владельцу и судьям')
}

function ownedClub(c: Context<MafboardEnv>): ClubMembership | Response {
  const membership = membershipOf(c)
  if (membership instanceof Response) return membership
  return membership.role === 'owner' ? membership : fail(c, 403, 'owner_only', 'Это может только владелец клуба')
}

async function accountJSON(c: Context<MafboardEnv>, user: MafboardUser) {
  return toAccountJSON(user, await hostAccess(c.get('deps').repo, user))
}

function telegramName(user: MafboardUser): string {
  return [[user.tgFirstName, user.tgLastName].filter(Boolean).join(' '), user.tgUsername ? `@${user.tgUsername}` : null].filter(Boolean).join(', ')
}

export function registerClubRoutes(router: Hono<MafboardEnv>, requireUser: MiddlewareHandler<MafboardEnv>): void {
  /** Клуб без GoMafia: код Titan Connect от владельца клуба в HUB подтверждает право создать клуб. */
  router.post('/v1/clubs', requireUser, body(codeSchema), async (c) => {
    const deps = c.get('deps')
    const user = c.get('user')
    const link = await exchangeTitanCode(c, c.req.valid('json').code)
    if (link instanceof Response) return link
    const created = await deps.repo.createTitanClub({ name: link.clubName ?? 'Клуб Titan HUB', titan: link, ownerUserId: user.id, at: deps.now() })
    if (created === 'exists') {
      // Ключ уже выдан HUB — отзываем его, чтобы не висел без хозяина.
      releaseLink(c, link)
      return fail(c, 409, 'club_exists', 'Этот клуб Titan HUB уже подключён к MafBoard. Попросите его владельца пригласить вас')
    }
    deps.titanRoster.forget(link.apiBase)
    return c.json({ club: { id: created.id, name: created.name }, account: await accountJSON(c, user) }, 201)
  })

  router.get('/v1/clubs/:id/members', requireUser, async (c) => {
    const owned = ownedClub(c)
    if (owned instanceof Response) return owned
    const deps = c.get('deps')
    const rows = await deps.repo.clubMembers(owned.club.id)
    const users = await Promise.all(rows.map((row) => deps.repo.userById(row.userId)))
    return c.json({
      members: rows.flatMap((row, index) => {
        const member = users[index]
        if (!member) return []
        return [{
          userId: row.userId,
          name: [member.tgFirstName, member.tgLastName].filter(Boolean).join(' '),
          username: member.tgUsername,
          role: row.role,
          addedAt: row.addedAt.toISOString(),
        }]
      }),
    })
  })

  router.delete('/v1/clubs/:id/members/:userId', requireUser, async (c) => {
    const owned = ownedClub(c)
    if (owned instanceof Response) return owned
    const target = c.req.param('userId') ?? ''
    if (target.toLowerCase() === c.get('user').id.toLowerCase()) return fail(c, 422, 'validation', 'Владелец не может убрать себя из клуба')
    const removed = await c.get('deps').repo.removeClubMember(owned.club.id, target)
    if (!removed) return fail(c, 404, 'not_found', 'Такого участника в клубе нет')
    return c.json({ ok: true })
  })

  router.post('/v1/clubs/:id/invites', requireUser, async (c) => {
    const owned = ownedClub(c)
    if (owned instanceof Response) return owned
    const deps = c.get('deps')
    if (!(await deps.limiter.hit(`mb:club:invite:${c.get('user').id}`, INVITES_PER_HOUR, 3600))) {
      return fail(c, 429, 'rate_limited', 'Слишком много приглашений, попробуйте позже')
    }
    const token = randomBytes(24).toString('base64url')
    const now = deps.now()
    const invite = {
      id: randomUUID(), clubId: owned.club.id, tokenHash: sha256(token), createdBy: c.get('user').id,
      createdAt: now, expiresAt: new Date(now.getTime() + INVITE_TTL_MS), revokedAt: null,
    }
    await deps.repo.createClubInvite(invite)
    // Токен — после `#`: эта часть ссылки не уходит на сервер и не попадает в журналы nginx.
    const url = `${deps.config.appLinkBase}/club/join#t=${encodeURIComponent(token)}`
    return c.json({ id: invite.id, url, expiresAt: invite.expiresAt.toISOString() }, 201)
  })

  /** Действующие приглашения — без самих ссылок: они есть только у того, кто их создал. */
  router.get('/v1/clubs/:id/invites', requireUser, async (c) => {
    const owned = ownedClub(c)
    if (owned instanceof Response) return owned
    const invites = await c.get('deps').repo.clubInvites(owned.club.id, c.get('deps').now())
    return c.json({ invites: invites.map((invite) => ({ id: invite.id, createdAt: invite.createdAt.toISOString(), expiresAt: invite.expiresAt.toISOString() })) })
  })

  router.delete('/v1/clubs/:id/invites/:inviteId', requireUser, async (c) => {
    const owned = ownedClub(c)
    if (owned instanceof Response) return owned
    const deps = c.get('deps')
    const revoked = await deps.repo.revokeClubInvite(owned.club.id, c.req.param('inviteId') ?? '', deps.now())
    if (!revoked) return fail(c, 404, 'not_found', 'Такого приглашения нет')
    return c.json({ ok: true })
  })

  /** Вступить по ссылке судьёй. Уже состоит — ничего не меняется. Пригласившему — сообщение в боте. */
  router.post('/v1/clubs/join', requireUser, body(joinSchema), async (c) => {
    const deps = c.get('deps')
    const user = c.get('user')
    if (!(await deps.limiter.hit(`mb:club:join:${user.id}`, JOIN_PER_HOUR, 3600, { failClosed: true }))) {
      return fail(c, 429, 'rate_limited', 'Слишком много попыток, попробуйте позже')
    }
    const invite = await deps.repo.clubInviteByTokenHash(sha256(c.req.valid('json').token))
    if (!invite) return fail(c, 404, 'invite_not_found', 'Приглашение не найдено — попросите владельца клуба прислать новое')
    if (invite.revokedAt || invite.expiresAt <= deps.now()) {
      return c.json({ error: { code: 'invite_expired', message: 'Приглашение больше не действует — попросите владельца клуба прислать новое' } }, 410)
    }
    const club = await deps.repo.clubById(invite.clubId)
    if (!club) return fail(c, 404, 'invite_not_found', 'Клуб приглашения больше не существует')
    const already = c.get('access').clubs.some((entry) => entry.club.id === club.id)
    if (!already) {
      await deps.repo.addClubMember({ clubId: club.id, userId: user.id, role: 'judge', addedBy: invite.createdBy, addedAt: deps.now() })
      const inviter = invite.createdBy ? await deps.repo.userById(invite.createdBy) : null
      const messenger = deps.messenger
      if (messenger && inviter && inviter.tgId > 0) {
        deps.background(`mb:notify:${inviter.id}`, () => messenger.send(inviter.tgId, `🙌 ${telegramName(user)} вступил в клуб «${club.name}» судьёй по вашему приглашению.`))
      }
    }
    return c.json(await accountJSON(c, user))
  })

  router.get('/v1/clubs/:id/players', requireUser, async (c) => {
    const membership = membershipOf(c)
    if (membership instanceof Response) return membership
    return respondClubPlayers(c, membership)
  })

  /** Подключить Titan к клубу заново (ключ отозвали в HUB или сменили клуб HUB). Прежний ключ отзывается. */
  router.put('/v1/clubs/:id/titan', requireUser, body(codeSchema), async (c) => {
    const owned = ownedClub(c)
    if (owned instanceof Response) return owned
    const deps = c.get('deps')
    const link = await exchangeTitanCode(c, c.req.valid('json').code)
    if (link instanceof Response) return link
    let replaced
    try {
      replaced = await deps.repo.setClubTitanLink(owned.club.id, link, c.get('user').id)
    } catch (error) {
      if ((error as { code?: string }).code !== '23505') throw error
      releaseLink(c, link)
      return fail(c, 409, 'club_exists', 'Этот клуб Titan HUB уже подключён к другому клубу MafBoard')
    }
    if (replaced && replaced.connectionId !== link.connectionId) {
      releaseLink(c, replaced)
      await clearMirrors(c, replaced.connectionId)
    }
    deps.titanRoster.forget(link.apiBase)
    return c.json(await accountJSON(c, c.get('user')))
  })

  router.delete('/v1/clubs/:id/titan', requireUser, async (c) => {
    const owned = ownedClub(c)
    if (owned instanceof Response) return owned
    await disconnectClub(c, owned.club)
    return c.json(await accountJSON(c, c.get('user')))
  })
}
