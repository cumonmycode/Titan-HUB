import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { call, createTestContext, NOW, signIn, TG_USER, type TestContext } from './helpers.js'

async function linkedHost(ctx: TestContext) {
  const session = await signIn(ctx)
  const linked = await call(ctx, 'POST', '/v1/me/gomafia', { token: session.accessToken, body: { login: 'host', password: 'secret' } })
  assert.equal(linked.status, 200)
  return { ...session, account: linked.json }
}

const goMafiaSeat = (n: number) => `6D616662-676D-8000-8000-${String(1000 + n).padStart(12, '0')}`

function gameRecord(hostId: string, format: string, clubID: number | null, gameID = 'A1B2C3D4-0000-4000-8000-000000000123') {
  return {
    schemaVersion: 1,
    setup: {
      gameID, format,
      ruleset: { variant: 'sport' },
      scoring: {},
      host: { userID: hostId.toUpperCase(), goMafiaPlayerID: clubID ? 4242 : null, clubID },
      seats: Array.from({ length: 10 }, (_, i) => ({ seat: i + 1, playerID: goMafiaSeat(i + 1), role: 'civilian' })),
      createdAt: '2026-10-16T17:00:00.000Z',
    },
    log: [],
    finishedAt: '2026-10-16T17:55:00.000Z',
    seats: [],
    outcome: { winner: 'red', reason: { allBlackEliminated: {} } },
    scoreAdjustments: [],
    nights: [],
    votings: [],
    events: [],
  }
}

describe('GoMafia', () => {
  it('привязка проверяет пароль, подтягивает профиль и клуб', async () => {
    const ctx = createTestContext()
    const session = await signIn(ctx)

    const bad = await call(ctx, 'POST', '/v1/me/gomafia', { token: session.accessToken, body: { login: 'host', password: 'wrong' } })
    assert.equal(bad.status, 422)
    assert.equal(bad.json.error.code, 'bad_credentials')

    const ok = await call(ctx, 'POST', '/v1/me/gomafia', { token: session.accessToken, body: { login: 'host', password: 'secret' } })
    assert.equal(ok.status, 200)
    assert.equal(ok.json.goMafia.player.id, 4242)
    assert.deepEqual(ok.json.goMafia.club, { id: 77, title: 'TITAN', city: 'Москва' })
    assert.equal(ok.json.goMafia.linkedAt, NOW.toISOString())

    const unlinked = await call(ctx, 'DELETE', '/v1/me/gomafia', { token: session.accessToken })
    assert.equal(unlinked.json.goMafia, null)
  })

  it('неверный пароль — текст GoMafia, сбой сети — не «неверный пароль»', async () => {
    const ctx = createTestContext()
    const session = await signIn(ctx)
    const bad = await call(ctx, 'POST', '/v1/me/gomafia', { token: session.accessToken, body: { login: 'host', password: 'wrong' } })
    assert.equal(bad.status, 422)
    assert.match(bad.json.error.message, /Никнейм и пароль введены неверно/)

    ctx.gomafia.loginOverride = { ok: false, error: 'network' }
    const down = await call(ctx, 'POST', '/v1/me/gomafia', { token: session.accessToken, body: { login: 'host', password: 'secret' } })
    assert.equal(down.status, 502)
    assert.equal(down.json.error.code, 'gomafia_unavailable')
  })

  it('успешный вход без id игрока: профиль находится по нику', async () => {
    const ctx = createTestContext()
    const session = await signIn(ctx)
    ctx.gomafia.loginOverride = { ok: true, sessionToken: 'gm-session' }
    const ok = await call(ctx, 'POST', '/v1/me/gomafia', { token: session.accessToken, body: { login: 'HOST', password: 'secret' } })
    assert.equal(ok.status, 200)
    assert.equal(ok.json.goMafia.player.id, 4242)
    assert.equal(ok.json.goMafia.club.id, 77)

    const byEmail = await call(ctx, 'POST', '/v1/me/gomafia', { token: session.accessToken, body: { login: 'host@example.com', password: 'secret' } })
    assert.equal(byEmail.status, 502)
  })

  it('профиль с чужим ником отменяет привязку', async () => {
    const ctx = createTestContext()
    const session = await signIn(ctx)
    ctx.gomafia.players.set('4242', { ...ctx.gomafia.players.get('4242')!, login: 'someone-else' })
    const res = await call(ctx, 'POST', '/v1/me/gomafia', { token: session.accessToken, body: { login: 'host', password: 'secret' } })
    assert.equal(res.status, 502)
    assert.equal(ctx.repo.users.get(session.account.id)?.gomafia, null)
  })

  it('подбор чужого пароля GoMafia упирается в лимит на сам логин', async () => {
    const ctx = createTestContext()
    // Входы по очереди: заглушка бота общая, кнопки ищутся в последних сообщениях.
    const attackers = [
      await signIn(ctx, { ...TG_USER, id: 5001, username: 'a1' }),
      await signIn(ctx, { ...TG_USER, id: 5002, username: 'a2' }),
    ]
    const statuses: number[] = []
    for (const attacker of attackers) {
      for (let i = 0; i < 4; i++) {
        const res = await call(ctx, 'POST', '/v1/me/gomafia', { token: attacker.accessToken, body: { login: 'Host', password: `guess-${i}` } })
        statuses.push(res.status)
      }
    }
    assert.deepEqual(statuses.slice(0, 5), [422, 422, 422, 422, 422])
    assert.ok(statuses.slice(5).every((s) => s === 429))
  })

  it('один аккаунт GoMafia — один пользователь', async () => {
    const ctx = createTestContext()
    await linkedHost(ctx)
    const other = await signIn(ctx, { ...TG_USER, id: 3003, username: 'other' })
    const taken = await call(ctx, 'POST', '/v1/me/gomafia', { token: other.accessToken, body: { login: 'host', password: 'secret' } })
    assert.equal(taken.status, 409)
    assert.equal(taken.json.error.code, 'gomafia_taken')
  })

  it('поиск: игроки своего клуба первыми, короткий запрос — 422', async () => {
    const ctx = createTestContext()
    const host = await linkedHost(ctx)
    const short = await call(ctx, 'GET', '/v1/gomafia/players?q=ш', { token: host.accessToken })
    assert.equal(short.status, 422)

    const found = await call(ctx, 'GET', `/v1/gomafia/players?q=${encodeURIComponent('шер')}`, { token: host.accessToken })
    assert.deepEqual(found.json.players.map((p: any) => [p.id, p.isInHostClub]), [[5001, true], [5002, false]])

    const player = await call(ctx, 'GET', '/v1/gomafia/players/5001', { token: host.accessToken })
    assert.equal(player.json.nickname, 'Шерлок')
    assert.equal((await call(ctx, 'GET', '/v1/gomafia/players/999', { token: host.accessToken })).status, 404)

    const roster = await call(ctx, 'GET', '/v1/gomafia/clubs/77/players?page=1', { token: host.accessToken })
    assert.ok(roster.json.players.every((p: any) => p.isInHostClub))
  })

  it('профиль старше суток обновляется в фоне: сменил клуб — сменилась история', async () => {
    const ctx = createTestContext()
    const host = await linkedHost(ctx)
    ctx.gomafia.players.set('4242', { ...ctx.gomafia.players.get('4242')!, clubId: '12', clubTitle: 'Другой клуб' })
    ctx.clock.now = new Date(NOW.getTime() + 25 * 60 * 60_000)

    await call(ctx, 'GET', '/v1/me', { token: host.accessToken })
    await ctx.flush()
    const me = await call(ctx, 'GET', '/v1/me', { token: host.accessToken })
    assert.equal(me.json.goMafia.club.id, 12)
  })
})

describe('история игр', () => {
  it('рейтинговая игра ведущего клуба — в историю клуба; повтор безопасен', async () => {
    const ctx = createTestContext()
    const host = await linkedHost(ctx)
    const record = gameRecord(host.account.id, 'rating', 77)

    assert.equal((await call(ctx, 'POST', '/v1/games', { token: host.accessToken, body: record })).status, 201)
    assert.equal((await call(ctx, 'POST', '/v1/games', { token: host.accessToken, body: record })).status, 200)

    const club = await call(ctx, 'GET', '/v1/clubs/77/games', { token: host.accessToken })
    assert.equal(club.json.games.length, 1)
    assert.equal(club.json.games[0].setup.gameID, record.setup.gameID)

    const mine = await call(ctx, 'GET', '/v1/me/games?since=2026-10-16T00:00:00.000Z', { token: host.accessToken })
    assert.equal(mine.json.games.length, 1)
  })

  it('без GoMafia — только фанки и только в личную историю', async () => {
    const ctx = createTestContext()
    const guest = await signIn(ctx)

    const rating = await call(ctx, 'POST', '/v1/games', { token: guest.accessToken, body: gameRecord(guest.account.id, 'rating', null) })
    assert.equal(rating.status, 403)
    assert.equal(rating.json.error.code, 'club_required')

    const funky = await call(ctx, 'POST', '/v1/games', { token: guest.accessToken, body: gameRecord(guest.account.id, 'funky', null) })
    assert.equal(funky.status, 201)
    assert.equal([...ctx.repo.games.values()][0]?.clubId, null)
  })

  it('чужую игру не сохранить и чужую историю клуба не прочитать', async () => {
    const ctx = createTestContext()
    const host = await linkedHost(ctx)
    const other = await signIn(ctx, { ...TG_USER, id: 3003, username: 'other' })

    const record = gameRecord(host.account.id, 'funky', 77)
    const forged = await call(ctx, 'POST', '/v1/games', { token: other.accessToken, body: record })
    assert.equal(forged.status, 403)
    assert.equal(forged.json.error.code, 'host_mismatch')

    await call(ctx, 'POST', '/v1/games', { token: host.accessToken, body: record })
    const clash = await call(ctx, 'POST', '/v1/games', { token: other.accessToken, body: gameRecord(other.account.id, 'funky', null, record.setup.gameID) })
    assert.equal(clash.status, 409)

    const peek = await call(ctx, 'GET', '/v1/clubs/77/games', { token: other.accessToken })
    assert.equal(peek.status, 403)
    assert.equal(peek.json.error.code, 'not_club_member')
  })

  it('слишком большая запись игры — 413', async () => {
    const ctx = createTestContext()
    const host = await linkedHost(ctx)
    const record = { ...gameRecord(host.account.id, 'funky', 77), padding: 'x'.repeat(300 * 1024) }
    const res = await call(ctx, 'POST', '/v1/games', { token: host.accessToken, body: record })
    assert.equal(res.status, 413)
    assert.equal(res.json.error.code, 'too_large')
  })

  it('история клуба: членство перепроверяется, ушедший из клуба теряет доступ', async () => {
    const ctx = createTestContext()
    const host = await linkedHost(ctx)
    ctx.gomafia.players.set('4242', { ...ctx.gomafia.players.get('4242')!, clubId: null })
    ctx.clock.now = new Date(NOW.getTime() + 25 * 60 * 60_000)
    const res = await call(ctx, 'GET', '/v1/clubs/77/games', { token: host.accessToken })
    assert.equal(res.status, 403)
  })

  it('GoMafia недоступна неделю — права клуба снимаются', async () => {
    const ctx = createTestContext()
    const host = await linkedHost(ctx)
    ctx.gomafia.players.clear()
    ctx.clock.now = new Date(NOW.getTime() + 2 * 24 * 60 * 60_000)
    assert.equal((await call(ctx, 'GET', '/v1/clubs/77/games', { token: host.accessToken })).status, 200)
    ctx.clock.now = new Date(NOW.getTime() + 8 * 24 * 60 * 60_000)
    assert.equal((await call(ctx, 'GET', '/v1/clubs/77/games', { token: host.accessToken })).status, 403)
  })

  it('без токена — 401', async () => {
    const ctx = createTestContext()
    const res = await call(ctx, 'POST', '/v1/games', { body: {} })
    assert.equal(res.status, 401)
  })
})
