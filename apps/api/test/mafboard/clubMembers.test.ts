import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { goMafiaPlayerID, titanPlayerID } from '../../src/modules/mafboard/titan.js'
import { call, createTestContext, signIn, TG_USER, TITAN_API_BASE, titanClient, type TestContext } from './helpers.js'

// Клубы без GoMafia, члены клуба и приглашения (docs/MAFBOARD.md, раздел «Клубы»). Клуб создаётся кодом
// Titan Connect, судьи вступают по ссылке-приглашению, игры и рейтинг идут по клубу MafBoard (`clubRef`).

const CLIENT_A = '00000000-0000-4000-8000-00000000000a'
const CLIENT_B = '00000000-0000-4000-8000-00000000000b'
const OWNER_TG = { ...TG_USER, id: 2001, username: 'owner' }
const JUDGE_TG = { ...TG_USER, id: 2002, username: 'judge' }
const STRANGER_TG = { ...TG_USER, id: 2003, username: 'stranger' }

function seeded() {
  const ctx = createTestContext()
  ctx.titan.members = [titanClient(CLIENT_A, 'Тигр', { isResident: true }), titanClient(CLIENT_B, 'Ворон', { gomafiaId: '5001' })]
  return ctx
}

/** Владелец клуба без GoMafia: клуб создан кодом Titan Connect. */
async function owner(ctx: TestContext) {
  const session = await signIn(ctx, OWNER_TG)
  const created = await call(ctx, 'POST', '/v1/clubs', { token: session.accessToken, body: { code: 'good-code' } })
  assert.equal(created.status, 201)
  return { ...session, clubId: created.json.club.id as string, account: created.json.account }
}

async function invite(ctx: TestContext, token: string, clubId: string) {
  const res = await call(ctx, 'POST', `/v1/clubs/${clubId}/invites`, { token })
  assert.equal(res.status, 201)
  return { id: res.json.id as string, token: new URL(res.json.url).searchParams.get('t')! }
}

async function judge(ctx: TestContext, ownerToken: string, clubId: string, user = JUDGE_TG) {
  const session = await signIn(ctx, user)
  const { token } = await invite(ctx, ownerToken, clubId)
  const joined = await call(ctx, 'POST', '/v1/clubs/join', { token: session.accessToken, body: { token } })
  assert.equal(joined.status, 200)
  return { ...session, account: joined.json }
}

function ratingGame(hostId: string, clubRef: string | null, seats: string[], gameID = 'A1B2C3D4-0000-4000-8000-000000000a01') {
  return {
    schemaVersion: 1,
    setup: {
      gameID,
      format: 'rating',
      ruleset: { variant: 'sport' },
      host: { userID: hostId, goMafiaPlayerID: null, clubID: null, clubRef },
      seats: seats.map((playerID, i) => ({ seat: i + 1, playerID, role: 'civilian' })),
      createdAt: '2026-10-16T17:00:00.000Z',
    },
    finishedAt: '2026-10-16T17:55:00.000Z',
    outcome: { winner: 'red' },
  }
}

const clubSeats = () => [titanPlayerID(TITAN_API_BASE, CLIENT_A), goMafiaPlayerID(5001), ...Array.from({ length: 8 }, (_, i) => goMafiaPlayerID(6001 + i))]

describe('Клуб без GoMafia: создание кодом Titan Connect', () => {
  it('владелец — тот, кто ввёл код; клуб в аккаунте с Titan; тот же клуб HUB второй раз не создаётся', async () => {
    const ctx = seeded()
    const host = await owner(ctx)
    const clubs = host.account.clubs as Array<{ id: string; name: string; role: string; goMafiaClubID: number | null; titan: unknown }>
    assert.equal(clubs.length, 1)
    assert.deepEqual({ ...clubs[0], titan: Boolean(clubs[0]!.titan) }, { id: host.clubId, name: 'TITAN Нальчик', city: null, role: 'owner', goMafiaClubID: null, titan: true })

    const other = await signIn(ctx, STRANGER_TG)
    const again = await call(ctx, 'POST', '/v1/clubs', { token: other.accessToken, body: { code: 'good-code' } })
    assert.equal(again.status, 409)
    assert.equal(again.json.error.code, 'club_exists')

    const bad = await call(ctx, 'POST', '/v1/clubs', { token: other.accessToken, body: { code: 'WRONG-111' } })
    assert.equal(bad.status, 422)
  })

  it('владелец видит клиентов своего клуба Titan; посторонний — нет', async () => {
    const ctx = seeded()
    const host = await owner(ctx)
    const players = await call(ctx, 'GET', `/v1/clubs/${host.clubId}/players`, { token: host.accessToken })
    assert.equal(players.status, 200)
    assert.deepEqual(players.json.players.map((p: { nickname: string }) => p.nickname), ['Тигр', 'Ворон'])
    assert.equal(players.json.club.name, 'TITAN Нальчик')

    const stranger = await signIn(ctx, STRANGER_TG)
    assert.equal((await call(ctx, 'GET', `/v1/clubs/${host.clubId}/players`, { token: stranger.accessToken })).status, 403)
  })

  it('владелец отключает и снова подключает Titan; прежний ключ отзывается', async () => {
    const ctx = seeded()
    const host = await owner(ctx)
    const off = await call(ctx, 'DELETE', `/v1/clubs/${host.clubId}/titan`, { token: host.accessToken })
    assert.equal(off.status, 200)
    await ctx.flush()
    assert.deepEqual(ctx.titan.calls.disconnect, ['tcn_live'])
    assert.equal((await call(ctx, 'GET', `/v1/clubs/${host.clubId}/players`, { token: host.accessToken })).json.players.length, 0)

    ctx.titan.issued = { accessToken: 'tcn_second', connectionId: 'conn-2' }
    const on = await call(ctx, 'PUT', `/v1/clubs/${host.clubId}/titan`, { token: host.accessToken, body: { code: 'good-code' } })
    assert.equal(on.status, 200)
    assert.equal((await ctx.repo.clubById(host.clubId))?.titan?.connectionId, 'conn-2')
  })
})

describe('Приглашения', () => {
  it('судья вступает по ссылке; владелец получает сообщение и видит его в участниках', async () => {
    const ctx = seeded()
    const host = await owner(ctx)
    const { id, token } = await invite(ctx, host.accessToken, host.clubId)
    const listed = await call(ctx, 'GET', `/v1/clubs/${host.clubId}/invites`, { token: host.accessToken })
    assert.deepEqual(listed.json.invites.map((i: { id: string }) => i.id), [id])
    assert.ok(!JSON.stringify(listed.json).includes(token))

    const session = await signIn(ctx, JUDGE_TG)
    const sentBefore = ctx.messenger.sent.length
    const joined = await call(ctx, 'POST', '/v1/clubs/join', { token: session.accessToken, body: { token } })
    assert.equal(joined.status, 200)
    assert.deepEqual(joined.json.clubs.map((c: { id: string; role: string }) => [c.id, c.role]), [[host.clubId, 'judge']])
    await ctx.flush()
    assert.ok(ctx.messenger.sent.slice(sentBefore).some((m) => m.chatId === OWNER_TG.id && m.text.includes('Кай')))

    const members = await call(ctx, 'GET', `/v1/clubs/${host.clubId}/members`, { token: host.accessToken })
    assert.deepEqual(members.json.members.map((m: { role: string }) => m.role).sort(), ['judge', 'owner'])
    // Повторное вступление ничего не ломает.
    assert.equal((await call(ctx, 'POST', '/v1/clubs/join', { token: session.accessToken, body: { token } })).status, 200)
  })

  it('ссылку делает только владелец; истёкшая и отозванная не действуют, чужая — не найдена', async () => {
    const ctx = seeded()
    const host = await owner(ctx)
    const member = await judge(ctx, host.accessToken, host.clubId)
    assert.equal((await call(ctx, 'POST', `/v1/clubs/${host.clubId}/invites`, { token: member.accessToken })).status, 403)

    const stranger = await signIn(ctx, STRANGER_TG)
    const revoked = await invite(ctx, host.accessToken, host.clubId)
    assert.equal((await call(ctx, 'DELETE', `/v1/clubs/${host.clubId}/invites/${revoked.id}`, { token: host.accessToken })).status, 200)
    const afterRevoke = await call(ctx, 'POST', '/v1/clubs/join', { token: stranger.accessToken, body: { token: revoked.token } })
    assert.equal(afterRevoke.status, 410)
    assert.equal(afterRevoke.json.error.code, 'invite_expired')

    const old = await invite(ctx, host.accessToken, host.clubId)
    ctx.clock.now = new Date(ctx.clock.now.getTime() + 8 * 24 * 60 * 60_000)
    assert.equal((await call(ctx, 'POST', '/v1/clubs/join', { token: stranger.accessToken, body: { token: old.token } })).status, 410)
    assert.equal((await call(ctx, 'POST', '/v1/clubs/join', { token: stranger.accessToken, body: { token: 'x'.repeat(32) } })).status, 404)
  })

  it('владелец убирает судью — клуб у судьи пропадает; себя убрать нельзя', async () => {
    const ctx = seeded()
    const host = await owner(ctx)
    const member = await judge(ctx, host.accessToken, host.clubId)
    assert.equal((await call(ctx, 'DELETE', `/v1/clubs/${host.clubId}/members/${member.account.id}`, { token: host.accessToken })).status, 200)
    assert.deepEqual((await call(ctx, 'GET', '/v1/me', { token: member.accessToken })).json.clubs, [])
    assert.equal((await call(ctx, 'GET', `/v1/clubs/${host.clubId}/players`, { token: member.accessToken })).status, 403)
    const self = await call(ctx, 'DELETE', `/v1/clubs/${host.clubId}/members/${host.account.id}`, { token: host.accessToken })
    assert.equal(self.status, 422)
  })

  it('судья без GoMafia вступает и в клуб GoMafia по приглашению президента', async () => {
    const ctx = seeded()
    const president = await signIn(ctx)
    await call(ctx, 'POST', '/v1/me/gomafia', { token: president.accessToken, body: { login: 'host', password: 'secret' } })
    const clubId = (await call(ctx, 'GET', '/v1/me', { token: president.accessToken })).json.clubs[0].id as string
    const member = await judge(ctx, president.accessToken, clubId)
    assert.deepEqual(member.account.clubs.map((c: { goMafiaClubID: number; role: string }) => [c.goMafiaClubID, c.role]), [[77, 'judge']])
    // Права GoMafia у него прежние (их считает GoMafia), но клуб MafBoard открыт.
    assert.equal(member.account.goMafia, null)
  })
})

describe('Игры и рейтинг клуба', () => {
  it('судья клуба загружает рейтинговую игру с клиентами Titan этого клуба; история клуба — у всех его судей', async () => {
    const ctx = seeded()
    const host = await owner(ctx)
    const member = await judge(ctx, host.accessToken, host.clubId)

    const game = ratingGame(member.account.id, host.clubId, clubSeats())
    assert.equal((await call(ctx, 'POST', '/v1/games', { token: member.accessToken, body: game })).status, 201)
    assert.equal(ctx.repo.games.get(game.setup.gameID.toLowerCase())!.clubRef, host.clubId)

    const history = await call(ctx, 'GET', `/v1/clubs/${host.clubId}/games`, { token: host.accessToken })
    assert.equal(history.status, 200)
    assert.deepEqual(history.json.games.map((g: { setup: { gameID: string } }) => g.setup.gameID), [game.setup.gameID])

    const stranger = await signIn(ctx, STRANGER_TG)
    assert.equal((await call(ctx, 'GET', `/v1/clubs/${host.clubId}/games`, { token: stranger.accessToken })).status, 403)
  })

  it('чужой клуб и гости в рейтинг клуба не проходят', async () => {
    const ctx = seeded()
    const host = await owner(ctx)
    const stranger = await signIn(ctx, STRANGER_TG)
    const foreign = await call(ctx, 'POST', '/v1/games', { token: stranger.accessToken, body: ratingGame(stranger.account.id, host.clubId, clubSeats()) })
    assert.equal(foreign.status, 403)
    assert.equal(foreign.json.error.code, 'club_access_required')

    const guests = [...clubSeats().slice(0, 9), '11111111-2222-4333-8444-555555555555']
    const withGuest = await call(ctx, 'POST', '/v1/games', { token: host.accessToken, body: ratingGame(host.account.id, host.clubId, guests) })
    assert.equal(withGuest.status, 422)
    assert.equal(withGuest.json.error.code, 'guest_players')
  })

  it('фанка от клуба идёт в историю клуба', async () => {
    const ctx = seeded()
    const host = await owner(ctx)
    const funky = ratingGame(host.account.id, host.clubId, ['11111111-2222-4333-8444-555555555555'], 'A1B2C3D4-0000-4000-8000-000000000a02')
    funky.setup.format = 'funky'
    assert.equal((await call(ctx, 'POST', '/v1/games', { token: host.accessToken, body: funky })).status, 201)
    assert.equal(ctx.repo.games.get(funky.setup.gameID.toLowerCase())!.clubRef, host.clubId)
  })
})
