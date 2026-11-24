import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { goMafiaPlayerID, titanPlayerID, trustedApiBase } from '../../src/modules/mafboard/titan.js'
import { call, clubIdOf, connectTitan, createTestContext, signIn, TG_USER, TITAN_API_BASE, titanClient, type TestContext } from './helpers.js'

const CLIENT_A = '00000000-0000-4000-8000-00000000000a'
const CLIENT_B = '00000000-0000-4000-8000-00000000000b'
const CLIENT_C = '00000000-0000-4000-8000-00000000000c'

/** Президент клуба GoMafia 77 (логин «host»): владелец клуба MafBoard, клуб Titan HUB подключает только он. */
async function president(ctx: TestContext, user = TG_USER) {
  const session = await signIn(ctx, user)
  const linked = await call(ctx, 'POST', '/v1/me/gomafia', { token: session.accessToken, body: { login: 'host', password: 'secret' } })
  assert.equal(linked.json.goMafia.access, 'president')
  return { ...session, clubId: await clubIdOf(ctx, session.accessToken) }
}

async function titanHost(ctx: TestContext, user = TG_USER) {
  const session = await president(ctx, user)
  const linked = await connectTitan(ctx, session.accessToken, { clubId: session.clubId })
  assert.equal(linked.status, 200)
  return { ...session, account: linked.json }
}

/** Резидент клуба 77 (игрок 5001), которого президент добавил в пул судей. */
async function poolJudge(ctx: TestContext, presidentToken: string) {
  ctx.gomafia.passwords.set('Шерлок', { password: 'pw', userId: '5001', clubId: '77' })
  const session = await signIn(ctx, { ...TG_USER, id: 1002, username: 'other' })
  await call(ctx, 'POST', '/v1/me/gomafia', { token: session.accessToken, body: { login: 'Шерлок', password: 'pw' } })
  const granted = await call(ctx, 'PUT', '/v1/club/hosts/5001', { token: presidentToken })
  assert.equal(granted.status, 200)
  return session
}

function seededContext() {
  const ctx = createTestContext()
  ctx.titan.members = [
    titanClient(CLIENT_A, 'Тигр', { gomafiaId: '5001', status: { label: 'Резидент' }, isResident: true }),
    titanClient(CLIENT_B, 'Ворон'),
    titanClient(CLIENT_C, 'Ушёл', { deleted: true }),
  ]
  return ctx
}

function ratingGame(hostId: string, playerIDs: string[], clubID: number | null) {
  return {
    schemaVersion: 1,
    setup: {
      gameID: 'A1B2C3D4-0000-4000-8000-000000000777',
      format: 'rating',
      ruleset: { variant: 'sport' },
      host: { userID: hostId, goMafiaPlayerID: null, clubID },
      seats: playerIDs.map((playerID, i) => ({ seat: i + 1, playerID, role: 'civilian' })),
      createdAt: '2026-10-16T17:00:00.000Z',
    },
    finishedAt: '2026-10-16T17:55:00.000Z',
    outcome: { winner: 'red' },
  }
}

const players = (ctx: TestContext, token: string, clubId: string) => call(ctx, 'GET', `/v1/clubs/${clubId}/titan/players`, { token })
const match = (ctx: TestContext, token: string, clubId: string, clientId: string, goMafiaID: number | null) =>
  call(ctx, 'PUT', `/v1/clubs/${clubId}/titan/players/${clientId}/gomafia`, { token, body: { goMafiaID } })

describe('Titan Connect: подключение клуба', () => {
  it('код меняется на ключ; ключ не уходит в приложение и хранится шифротекстом в клубе', async () => {
    const ctx = createTestContext()
    const host = await president(ctx)

    const bad = await connectTitan(ctx, host.accessToken, { clubId: host.clubId, code: 'WRONG-111' })
    assert.equal(bad.status, 422)
    assert.equal(bad.json.error.code, 'invalid_code')

    const ok = await connectTitan(ctx, host.accessToken, { clubId: host.clubId })
    assert.equal(ok.status, 200)
    assert.deepEqual(ok.json.titan.club, { name: 'TITAN Нальчик' })
    assert.deepEqual(ok.json.titan.scopes, ['clients:read', 'clients:photos'])
    assert.equal(ok.json.titan.isShared, false)
    assert.deepEqual(ok.json.clubs[0].titan.club, { name: 'TITAN Нальчик' })
    assert.ok(!JSON.stringify(ok.json).includes('tcn_live'))

    const stored = ctx.repo.clubs.get(host.clubId)!.titan!
    assert.equal(stored.apiBase, TITAN_API_BASE)
    assert.ok(!stored.tokenSealed.includes('tcn_live'))
    // Личная запись президента больше не пишется: подключение — только у клуба.
    assert.equal(ctx.repo.users.get(host.account.id)!.titan, null)
  })

  it('адрес клуба вне домена Titan не принимается', async () => {
    const ctx = createTestContext()
    ctx.titan.apiBase = 'https://evil.example/api/connect/v1'
    const host = await president(ctx)
    const linked = await connectTitan(ctx, host.accessToken, { clubId: host.clubId })
    assert.equal(linked.status, 502)
    assert.equal(ctx.repo.clubs.get(host.clubId)!.titan, null)
  })

  it('Titan не отвечает — 502, а не «неверный код»', async () => {
    const ctx = createTestContext()
    ctx.titan.down = true
    const host = await president(ctx)
    const linked = await connectTitan(ctx, host.accessToken, { clubId: host.clubId })
    assert.equal(linked.status, 502)
    assert.equal(linked.json.error.code, 'titan_unavailable')
  })

  it('отключение стирает ключ и отзывает его в HUB', async () => {
    const ctx = seededContext()
    const host = await titanHost(ctx)
    const unlinked = await call(ctx, 'DELETE', `/v1/clubs/${host.clubId}/titan`, { token: host.accessToken })
    assert.equal(unlinked.status, 200)
    assert.equal(unlinked.json.titan, null)
    await ctx.flush()
    assert.deepEqual(ctx.titan.calls.disconnect, ['tcn_live'])

    const res = await players(ctx, host.accessToken, host.clubId)
    assert.equal(res.status, 409)
    assert.equal(res.json.error.code, 'titan_not_linked')
  })

  it('код вводит только владелец клуба: ведущему без клуба и резиденту без доступа — 403', async () => {
    const ctx = seededContext()
    const host = await president(ctx)
    const guest = await signIn(ctx, { ...TG_USER, id: 1003, username: 'guest' })
    const denied = await connectTitan(ctx, guest.accessToken, { clubId: host.clubId })
    assert.equal(denied.status, 403)
    assert.equal(denied.json.error.code, 'club_access_required')

    ctx.gomafia.passwords.set('Шерлок', { password: 'pw', userId: '5001', clubId: '77' })
    const resident = await signIn(ctx, { ...TG_USER, id: 1002, username: 'other' })
    await call(ctx, 'POST', '/v1/me/gomafia', { token: resident.accessToken, body: { login: 'Шерлок', password: 'pw' } })
    const alsoDenied = await connectTitan(ctx, resident.accessToken, { clubId: host.clubId })
    assert.equal(alsoDenied.status, 403)
    assert.equal(alsoDenied.json.error.code, 'club_access_required')
    assert.equal(ctx.repo.clubs.get(host.clubId)!.titan, null)
  })

  it('судье пула клуб Titan достаётся от президента: клиенты видны, подключить и отключить нельзя', async () => {
    const ctx = seededContext()
    const host = await titanHost(ctx)
    const judge = await poolJudge(ctx, host.accessToken)

    const me = await call(ctx, 'GET', '/v1/me', { token: judge.accessToken })
    assert.deepEqual(me.json.titan.club, { name: 'TITAN Нальчик' })
    assert.equal(me.json.titan.isShared, true)
    assert.equal(me.json.clubs[0].id, host.clubId)
    assert.equal(me.json.clubs[0].role, 'judge')
    assert.equal(ctx.repo.users.get(judge.account.id)!.titan, null)

    const seen = await players(ctx, judge.accessToken, host.clubId)
    assert.equal(seen.status, 200)
    assert.equal(seen.json.players.length, 2)

    const relink = await connectTitan(ctx, judge.accessToken, { clubId: host.clubId })
    assert.equal(relink.status, 403)
    assert.equal(relink.json.error.code, 'owner_only')
    const unlink = await call(ctx, 'DELETE', `/v1/clubs/${host.clubId}/titan`, { token: judge.accessToken })
    assert.equal(unlink.status, 403)
    assert.equal(unlink.json.error.code, 'owner_only')
    assert.ok(ctx.repo.clubs.get(host.clubId)!.titan)

    // Президент отключил клуб — у судьи он тоже пропал.
    await call(ctx, 'DELETE', `/v1/clubs/${host.clubId}/titan`, { token: host.accessToken })
    assert.equal((await call(ctx, 'GET', '/v1/me', { token: judge.accessToken })).json.titan, null)
  })
})

describe('Titan Connect: клиенты клуба', () => {
  it('весь состав по страницам, без удалённых, резиденты первыми', async () => {
    const ctx = seededContext()
    ctx.titan.pageSize = 2
    const host = await titanHost(ctx)

    const res = await players(ctx, host.accessToken, host.clubId)
    assert.equal(res.status, 200)
    assert.deepEqual(res.json.club, { name: 'TITAN Нальчик' })
    assert.deepEqual(res.json.players.map((p: { nickname: string }) => p.nickname), ['Тигр', 'Ворон'])
    assert.equal(ctx.titan.calls.clients, 2)

    const [tiger, raven] = res.json.players
    assert.equal(tiger.goMafiaID, 5001)
    assert.equal(tiger.goMafiaSource, 'hub')
    assert.equal(tiger.playerID, goMafiaPlayerID(5001))
    assert.equal(tiger.statusLabel, 'Резидент')
    assert.equal(raven.goMafiaID, null)
    assert.equal(raven.playerID, titanPlayerID(TITAN_API_BASE, CLIENT_B))
  })

  it('PlayerID совпадает с PlayerID.goMafia приложения', () => {
    assert.equal(goMafiaPlayerID(4242), '6d616662-676d-8000-8000-000000001092')
    assert.match(titanPlayerID(TITAN_API_BASE, CLIENT_B), /^6d616662-7463-8000-8000-[0-9a-f]{12}$/)
    assert.equal(titanPlayerID(TITAN_API_BASE, CLIENT_B), titanPlayerID(TITAN_API_BASE, CLIENT_B))
    assert.notEqual(titanPlayerID(TITAN_API_BASE, CLIENT_B), titanPlayerID('https://other.titanpos.test/api/connect/v1', CLIENT_B))
  })

  it('отозванный в HUB ключ — titan_revoked', async () => {
    const ctx = seededContext()
    const host = await titanHost(ctx)
    ctx.titan.revoked = true
    const res = await players(ctx, host.accessToken, host.clubId)
    assert.equal(res.status, 409)
    assert.equal(res.json.error.code, 'titan_revoked')
  })

  it('Titan не ответил — отдаётся последний состав', async () => {
    const ctx = seededContext()
    const host = await titanHost(ctx)
    assert.equal((await players(ctx, host.accessToken, host.clubId)).status, 200)
    ctx.clock.now = new Date(ctx.clock.now.getTime() + 10 * 60_000)
    ctx.titan.down = true
    const res = await players(ctx, host.accessToken, host.clubId)
    assert.equal(res.status, 200)
    assert.equal(res.json.players.length, 2)
  })

  it('клиенты чужого клуба не читаются', async () => {
    const ctx = seededContext()
    const host = await titanHost(ctx)
    const guest = await signIn(ctx, { ...TG_USER, id: 1003, username: 'guest' })
    const res = await players(ctx, guest.accessToken, host.clubId)
    assert.equal(res.status, 403)
    assert.equal(res.json.error.code, 'club_access_required')
  })
})

describe('Titan Connect: сопоставление с GoMafia', () => {
  it('ручное сопоставление важнее номера из HUB и общее для ведущих клуба', async () => {
    const ctx = seededContext()
    const host = await titanHost(ctx)
    const other = await poolJudge(ctx, host.accessToken)

    const matched = await match(ctx, host.accessToken, host.clubId, CLIENT_B, 4242)
    assert.equal(matched.status, 200)
    assert.equal(matched.json.goMafiaID, 4242)
    assert.equal(matched.json.goMafiaSource, 'manual')
    assert.equal(matched.json.playerID, goMafiaPlayerID(4242))

    // У Тигра в HUB чужой номер — ведущий говорит, что GoMafia у него нет.
    const none = await match(ctx, host.accessToken, host.clubId, CLIENT_A, null)
    assert.equal(none.json.goMafiaID, null)
    assert.equal(none.json.playerID, titanPlayerID(TITAN_API_BASE, CLIENT_A))

    const seenByOther = await players(ctx, other.accessToken, host.clubId)
    const byId = new Map(seenByOther.json.players.map((p: { id: string }) => [p.id, p]))
    assert.equal((byId.get(CLIENT_B) as { goMafiaID: number }).goMafiaID, 4242)
    assert.equal((byId.get(CLIENT_A) as { goMafiaID: number | null }).goMafiaID, null)

    const reset = await call(ctx, 'DELETE', `/v1/clubs/${host.clubId}/titan/players/${CLIENT_A}/gomafia`, { token: host.accessToken })
    assert.equal(reset.json.goMafiaID, 5001)
    assert.equal(reset.json.goMafiaSource, 'hub')
  })

  it('несуществующий игрок GoMafia или клиент — 404', async () => {
    const ctx = seededContext()
    const host = await titanHost(ctx)
    // С 2026-11-17 GoMafia показывает профили только вошедшим: проверка номера — входом ведущего.
    await call(ctx, 'POST', '/v1/me/gomafia', { token: host.accessToken, body: { login: 'host', password: 'secret' } })
    const noPlayer = await match(ctx, host.accessToken, host.clubId, CLIENT_B, 999)
    assert.equal(noPlayer.status, 404)
    const noClient = await match(ctx, host.accessToken, host.clubId, CLIENT_C, 4242)
    assert.equal(noClient.status, 404)
  })

  it('сопоставлять может только член клуба', async () => {
    const ctx = seededContext()
    const host = await titanHost(ctx)
    const guest = await signIn(ctx, { ...TG_USER, id: 1003, username: 'guest' })
    const denied = await match(ctx, guest.accessToken, host.clubId, CLIENT_B, 4242)
    assert.equal(denied.status, 403)
    assert.equal(denied.json.error.code, 'club_access_required')
  })
})

describe('Titan Connect: снятые ручки (выпуск 4в)', () => {
  const legacy: Array<[string, string, unknown?]> = [
    ['POST', '/v1/me/titan', { code: 'good-code' }],
    ['DELETE', '/v1/me/titan'],
    ['GET', '/v1/titan/players'],
    ['PUT', `/v1/titan/players/${CLIENT_B}/gomafia`, { goMafiaID: 4242 }],
    ['DELETE', `/v1/titan/players/${CLIENT_B}/gomafia`],
  ]
  for (const [method, path, body] of legacy) {
    it(`${method} ${path} — 426 update_required, подключение клуба не меняется`, async () => {
      const ctx = seededContext()
      const host = await titanHost(ctx)
      const reads = ctx.titan.calls.clients
      const res = await call(ctx, method, path, { token: host.accessToken, ...(body === undefined ? {} : { body }) })
      assert.equal(res.status, 426)
      assert.deepEqual(res.json, {
        error: { code: 'update_required', message: 'Эта версия MafBoard устарела — обновите приложение в TestFlight' },
      })
      await ctx.flush()
      assert.equal(ctx.repo.clubs.get(host.clubId)!.titan?.connectionId, 'conn-1')
      assert.deepEqual(ctx.titan.calls.disconnect, [])
      assert.equal(ctx.titan.calls.clients, reads)
    })
  }
})

describe('Titan Connect: игры', () => {
  const titanSeats = (n: number) => Array.from({ length: n }, (_, i) => titanPlayerID(TITAN_API_BASE, `client-${i}`))

  it('президент и судья его пула проводят рейтинговую игру с клиентами клуба Titan', async () => {
    const ctx = seededContext()
    const host = await titanHost(ctx)
    const seats = [...titanSeats(9), goMafiaPlayerID(5001)]
    const res = await call(ctx, 'POST', '/v1/games', { token: host.accessToken, body: ratingGame(host.account.id, seats, 77) })
    assert.equal(res.status, 201)

    const judge = await poolJudge(ctx, host.accessToken)
    const game = ratingGame(judge.account.id, seats, 77)
    const byJudge = await call(ctx, 'POST', '/v1/games', {
      token: judge.accessToken,
      body: { ...game, setup: { ...game.setup, gameID: 'A1B2C3D4-0000-4000-8000-000000000778' } },
    })
    assert.equal(byJudge.status, 201)
  })

  it('без подключённого Titan игроки Titan в рейтинге не принимаются', async () => {
    const ctx = seededContext()
    const session = await signIn(ctx)
    const res = await call(ctx, 'POST', '/v1/games', { token: session.accessToken, body: ratingGame(session.account.id, titanSeats(10), null) })
    assert.equal(res.status, 403)
    assert.equal(res.json.error.code, 'club_required')
  })

  it('гость в рейтинге по-прежнему не принимается', async () => {
    const ctx = seededContext()
    const host = await titanHost(ctx)
    const seats = [...titanSeats(9), '11111111-2222-4333-8444-555555555555']
    const res = await call(ctx, 'POST', '/v1/games', { token: host.accessToken, body: ratingGame(host.account.id, seats, 77) })
    assert.equal(res.status, 422)
    assert.equal(res.json.error.code, 'guest_players')
  })
})

describe('trustedApiBase', () => {
  const root = 'https://titanpos.ru/api/connect/v1'
  it('принимает домен Titan и поддомены клубов', () => {
    assert.equal(trustedApiBase('https://titanpos.ru/api/connect/v1/', root), 'https://titanpos.ru/api/connect/v1')
    assert.equal(trustedApiBase('https://club.titanpos.ru/api/connect/v1', root), 'https://club.titanpos.ru/api/connect/v1')
  })
  it('отклоняет чужие домены, http и похожие имена', () => {
    assert.equal(trustedApiBase('https://eviltitanpos.ru/api', root), null)
    assert.equal(trustedApiBase('http://club.titanpos.ru/api', root), null)
    assert.equal(trustedApiBase('https://titanpos.ru.evil.com/api', root), null)
    assert.equal(trustedApiBase('https://user@club.titanpos.ru/api', root), null)
  })
})

describe('Titan Connect: эфир клуба', () => {
  const live = {
    id: 'stream-1',
    status: 'live',
    title: 'Финал',
    links: [{ kind: 'watch', label: 'VK', url: 'https://live.vkvideo.ru/titan' }, { kind: 'donate', label: 'Донат', url: 'https://www.donationalerts.com/r/titan' }],
  }

  it('ссылки молча уходят в HUB клуба ключом клуба; решение о публикации — за HUB', async () => {
    const ctx = seededContext()
    const host = await titanHost(ctx)
    const res = await call(ctx, 'POST', `/v1/clubs/${host.clubId}/stream`, { token: host.accessToken, body: live })
    assert.equal(res.status, 200)
    assert.deepEqual(res.json, { ok: true, published: false })
    assert.equal(ctx.titan.calls.streams.length, 1)
    const sent = ctx.titan.calls.streams[0]!
    assert.equal(sent.apiBase, TITAN_API_BASE)
    assert.equal(sent.stream.source, 'mafboard')
    assert.equal(sent.stream.links.length, 2)
  })

  it('эфир без https-ссылки на трансляцию не принимается', async () => {
    const ctx = seededContext()
    const host = await titanHost(ctx)
    const res = await call(ctx, 'POST', `/v1/clubs/${host.clubId}/stream`, { token: host.accessToken, body: { ...live, links: [{ kind: 'watch', label: '', url: 'http://insecure.example/x' }] } })
    assert.equal(res.status, 422)
    assert.equal(ctx.titan.calls.streams.length, 0)
  })

  it('клуб без Titan HUB — titan_not_linked', async () => {
    const ctx = seededContext()
    const host = await president(ctx)
    const res = await call(ctx, 'POST', `/v1/clubs/${host.clubId}/stream`, { token: host.accessToken, body: live })
    assert.equal(res.status, 409)
    assert.equal(res.json.error.code, 'titan_not_linked')
  })
})
