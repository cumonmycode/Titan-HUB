import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { goMafiaPlayerID, titanPlayerID } from '../../src/modules/mafboard/titan.js'
import { call, createTestContext, signIn, TG_USER, TITAN_API_BASE, titanClient, type TestContext } from './helpers.js'

// Состав клуба одним списком (`GET /v1/club/players`, docs/MAFBOARD.md, раздел «Игроки клуба»):
// клиенты Titan HUB и резиденты клуба GoMafia без повторов, у каждого одно фото.

const CLIENT_A = '00000000-0000-4000-8000-00000000000a'
const CLIENT_B = '00000000-0000-4000-8000-00000000000b'
const CLIENT_C = '00000000-0000-4000-8000-00000000000c'
const HUB_PHOTO_B = 'https://titanpos.test/media/raven-1.jpg'
const gomafiaAvatar = (id: number) => `https://gomafia.pro/avatars/${id}.jpg`

/** Клуб HUB: Тигр — резидент с номером GoMafia 5001 без своего фото, Ворон — со своим фото, без GoMafia. */
function seeded() {
  const ctx = createTestContext()
  ctx.titan.members = [
    titanClient(CLIENT_A, 'Тигр', { gomafiaId: '5001', status: { label: 'Резидент' }, isResident: true }),
    titanClient(CLIENT_B, 'Ворон', { photoUrl: HUB_PHOTO_B }),
    titanClient(CLIENT_C, 'Ушёл', { deleted: true }),
  ]
  return ctx
}

/** Президент клуба GoMafia 77 (игрок 4242). С `titan` — ещё и подключил клуб Titan HUB. */
async function president(ctx: TestContext, { titan = true } = {}) {
  const session = await signIn(ctx)
  await call(ctx, 'POST', '/v1/me/gomafia', { token: session.accessToken, body: { login: 'host', password: 'secret' } })
  if (titan) assert.equal((await call(ctx, 'POST', '/v1/me/titan', { token: session.accessToken, body: { code: 'good-code' } })).status, 200)
  return session
}

/** Резидент клуба 77 (игрок 5001); с `grantedBy` — президент добавил его в пул судей. */
async function resident(ctx: TestContext, grantedBy?: string) {
  ctx.gomafia.passwords.set('Шерлок', { password: 'pw', userId: '5001', clubId: '77' })
  const session = await signIn(ctx, { ...TG_USER, id: 1002, username: 'other' })
  await call(ctx, 'POST', '/v1/me/gomafia', { token: session.accessToken, body: { login: 'Шерлок', password: 'pw' } })
  if (grantedBy) assert.equal((await call(ctx, 'PUT', '/v1/club/hosts/5001', { token: grantedBy })).status, 200)
  return session
}

type Player = { playerID: string; nickname: string; photoURL: string | null; titanClientID: string | null; goMafiaID: number | null; isVerified: boolean; elo: number | null; isResident: boolean; statusLabel: string | null }

const byNickname = (players: Player[]) => new Map(players.map((player) => [player.nickname, player]))

describe('Игроки клуба: один список', () => {
  it('клиенты Titan и резиденты GoMafia без повторов, фото — HUB, иначе GoMafia', async () => {
    const ctx = seeded()
    const host = await president(ctx)

    const res = await call(ctx, 'GET', '/v1/club/players', { token: host.accessToken })
    assert.equal(res.status, 200)
    assert.equal(res.json.partial, false)
    assert.equal(res.json.club.name, 'TITAN')
    // Тигр — клиент HUB с номером 5001: резидент GoMafia «Шерлок» с тем же номером в списке второй раз не появляется.
    assert.deepEqual(res.json.players.map((p: Player) => p.nickname), ['Тигр', 'Ворон', 'host'])

    const players = byNickname(res.json.players)
    const tiger = players.get('Тигр')!
    assert.equal(tiger.playerID, goMafiaPlayerID(5001))
    assert.equal(tiger.titanClientID, CLIENT_A)
    assert.equal(tiger.goMafiaID, 5001)
    // У клиента своего фото нет — берётся аватар его игрока GoMafia; ELO тоже оттуда.
    assert.equal(tiger.photoURL, gomafiaAvatar(5001))
    assert.equal(tiger.elo, 1500)
    assert.equal(tiger.isResident, true)
    assert.equal(tiger.statusLabel, 'Резидент')

    const raven = players.get('Ворон')!
    assert.equal(raven.playerID, titanPlayerID(TITAN_API_BASE, CLIENT_B))
    assert.equal(raven.photoURL, HUB_PHOTO_B)
    assert.equal(raven.goMafiaID, null)

    const self = players.get('host')!
    assert.equal(self.playerID, goMafiaPlayerID(4242))
    assert.equal(self.titanClientID, null)
    assert.equal(self.photoURL, gomafiaAvatar(4242))
    assert.equal(self.isVerified, true)
    assert.equal(tiger.isVerified, false)
  })

  it('своё фото клиента в HUB важнее аватара GoMafia', async () => {
    const ctx = seeded()
    ctx.titan.members[0] = { ...ctx.titan.members[0]!, photoUrl: 'https://titanpos.test/media/tiger-2.jpg' }
    const host = await president(ctx)
    const res = await call(ctx, 'GET', '/v1/club/players', { token: host.accessToken })
    assert.equal(byNickname(res.json.players).get('Тигр')!.photoURL, 'https://titanpos.test/media/tiger-2.jpg')
  })

  it('ручное сопоставление важнее номера из HUB: «нет GoMafia» — резидент GoMafia идёт отдельно', async () => {
    const ctx = seeded()
    const host = await president(ctx)
    assert.equal((await call(ctx, 'PUT', `/v1/titan/players/${CLIENT_A}/gomafia`, { token: host.accessToken, body: { goMafiaID: null } })).status, 200)

    const res = await call(ctx, 'GET', '/v1/club/players', { token: host.accessToken })
    const players = byNickname(res.json.players)
    assert.equal(players.get('Тигр')!.playerID, titanPlayerID(TITAN_API_BASE, CLIENT_A))
    assert.equal(players.get('Тигр')!.photoURL, null)
    assert.equal(players.get('Шерлок')!.playerID, goMafiaPlayerID(5001))
    assert.equal(players.get('Шерлок')!.photoURL, gomafiaAvatar(5001))
  })

  it('два клиента с одним номером GoMafia — один игрок, первый по порядку клуба', async () => {
    const ctx = seeded()
    ctx.titan.members.push(titanClient('00000000-0000-4000-8000-00000000000e', 'Тигр-дубль', { gomafiaId: '5001' }))
    const host = await president(ctx)
    const res = await call(ctx, 'GET', '/v1/club/players', { token: host.accessToken })
    const ids = res.json.players.map((p: Player) => p.playerID)
    assert.equal(new Set(ids).size, ids.length)
    assert.deepEqual(res.json.players.map((p: Player) => p.nickname), ['Тигр', 'Ворон', 'host'])
  })

  it('клуб без Titan HUB — только резиденты GoMafia', async () => {
    const ctx = seeded()
    const host = await president(ctx, { titan: false })
    const res = await call(ctx, 'GET', '/v1/club/players', { token: host.accessToken })
    assert.equal(res.status, 200)
    assert.equal(res.json.partial, false)
    assert.deepEqual(res.json.players.map((p: Player) => p.nickname), ['host', 'Шерлок'])
  })

  it('один источник не ответил — второй и partial; оба — ошибка', async () => {
    const ctx = seeded()
    const host = await president(ctx)
    ctx.titan.down = true
    const withoutTitan = await call(ctx, 'GET', '/v1/club/players', { token: host.accessToken })
    assert.equal(withoutTitan.status, 200)
    assert.equal(withoutTitan.json.partial, true)
    assert.deepEqual(withoutTitan.json.players.map((p: Player) => p.nickname), ['host', 'Шерлок'])

    ctx.titan.down = false
    ctx.gomafia.club = async () => {
      throw new Error('GoMafia не отвечает')
    }
    // Состав GoMafia уже в кэше — сбросим его часами, чтобы источник действительно не ответил.
    ctx.clock.now = new Date(ctx.clock.now.getTime() + 10 * 60_000)
    const withoutGoMafia = await call(ctx, 'GET', '/v1/club/players', { token: host.accessToken })
    assert.equal(withoutGoMafia.status, 200)
    assert.equal(withoutGoMafia.json.partial, true)
    assert.deepEqual(withoutGoMafia.json.players.map((p: Player) => p.nickname), ['Тигр', 'Ворон'])

    ctx.titan.down = true
    ctx.clock.now = new Date(ctx.clock.now.getTime() + 10 * 60_000)
    ctx.deps.titanRoster.forget(TITAN_API_BASE)
    const neither = await call(ctx, 'GET', '/v1/club/players', { token: host.accessToken })
    assert.equal(neither.status, 502)
    assert.equal(neither.json.error.code, 'titan_unavailable')
  })
})

describe('Игроки клуба: права', () => {
  it('судья пула видит состав клуба, резидент без доступа и ведущий без клуба — нет', async () => {
    const ctx = seeded()
    const guest = await signIn(ctx, { ...TG_USER, id: 1003, username: 'guest' })
    const noClub = await call(ctx, 'GET', '/v1/club/players', { token: guest.accessToken })
    assert.equal(noClub.status, 403)
    assert.equal(noClub.json.error.code, 'club_required')

    const host = await president(ctx)
    const judge = await resident(ctx)
    const waiting = await call(ctx, 'GET', '/v1/club/players', { token: judge.accessToken })
    assert.equal(waiting.status, 403)
    assert.equal(waiting.json.error.code, 'host_access_required')

    await call(ctx, 'PUT', '/v1/club/hosts/5001', { token: host.accessToken })
    const granted = await call(ctx, 'GET', '/v1/club/players', { token: judge.accessToken })
    assert.equal(granted.status, 200)
    assert.deepEqual(granted.json.players.map((p: Player) => p.nickname), ['Тигр', 'Ворон', 'host'])
  })
})

describe('Фото самого судьи', () => {
  it('photoURL: фото клиента клуба с его номером GoMafia, пока состава нет — аватар GoMafia', async () => {
    const ctx = seeded()
    ctx.titan.members.push(titanClient('00000000-0000-4000-8000-00000000000d', 'Хозяин', { gomafiaId: '4242', photoUrl: 'https://titanpos.test/media/host-1.jpg' }))
    const host = await president(ctx)

    // Состав клуба Titan ещё не прочитан: сразу — аватар GoMafia, состав читается в фоне.
    const cold = await call(ctx, 'GET', '/v1/me', { token: host.accessToken })
    assert.equal(cold.json.photoURL, gomafiaAvatar(4242))
    await ctx.flush()
    const warm = await call(ctx, 'GET', '/v1/me', { token: host.accessToken })
    assert.equal(warm.json.photoURL, 'https://titanpos.test/media/host-1.jpg')
  })

  it('Titan не отвечает — запросы аккаунта не множат чтения состава', async () => {
    const ctx = seeded()
    const host = await president(ctx)
    ctx.titan.down = true
    const before = ctx.titan.calls.clients
    for (let i = 0; i < 5; i++) await call(ctx, 'GET', '/v1/me', { token: host.accessToken })
    await ctx.flush()
    assert.equal(ctx.titan.calls.clients - before, 1)
  })

  it('без GoMafia фото нет, без Titan — аватар GoMafia', async () => {
    const ctx = seeded()
    const guest = await signIn(ctx, { ...TG_USER, id: 1003, username: 'guest' })
    assert.equal(guest.account.photoURL, null)
    const host = await president(ctx, { titan: false })
    assert.equal((await call(ctx, 'GET', '/v1/me', { token: host.accessToken })).json.photoURL, gomafiaAvatar(4242))
  })
})
