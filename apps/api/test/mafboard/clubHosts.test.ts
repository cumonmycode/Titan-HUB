import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { goMafiaPlayerID } from '../../src/modules/mafboard/titan.js'
import { call, createTestContext, gmPlayer, signIn, TG_USER, type TestContext } from './helpers.js'

// Пул судей клуба: в заглушке GoMafia клуб 77, его президент — игрок 4242 (логин «host»),
// резиденты — 4242 и 5001 («Шерлок»).

const JUDGE_TG = { ...TG_USER, id: 1002, first_name: 'Диана', username: 'diana' }
const OTHER_TG = { ...TG_USER, id: 1003, first_name: 'Тигран', username: 'tigran' }

async function president(ctx: TestContext) {
  const session = await signIn(ctx)
  const linked = await call(ctx, 'POST', '/v1/me/gomafia', { token: session.accessToken, body: { login: 'host', password: 'secret' } })
  assert.equal(linked.status, 200)
  return { ...session, account: linked.json }
}

/** Резидент клуба (игрок 5001), привязавший GoMafia своим паролем. */
async function resident(ctx: TestContext, tg = JUDGE_TG) {
  ctx.gomafia.passwords.set('Шерлок', { password: 'pw', userId: '5001', clubId: '77' })
  const session = await signIn(ctx, tg)
  const linked = await call(ctx, 'POST', '/v1/me/gomafia', { token: session.accessToken, body: { login: 'Шерлок', password: 'pw' } })
  assert.equal(linked.status, 200)
  return { ...session, account: linked.json }
}

function ratingGame(hostId: string, gameID = 'A1B2C3D4-0000-4000-8000-000000000901') {
  return {
    schemaVersion: 1,
    setup: {
      gameID,
      format: 'rating',
      ruleset: { variant: 'sport' },
      host: { userID: hostId, goMafiaPlayerID: 5001, clubID: 77 },
      seats: Array.from({ length: 10 }, (_, i) => ({ seat: i + 1, playerID: goMafiaPlayerID(6000 + i), role: 'civilian' })),
      createdAt: '2026-10-16T17:00:00.000Z',
    },
    finishedAt: '2026-10-16T17:55:00.000Z',
    outcome: { winner: 'red' },
  }
}

const me = async (ctx: TestContext, token: string) => (await call(ctx, 'GET', '/v1/me', { token })).json
const lastMessageTo = (ctx: TestContext, chatId: number) => ctx.messenger.sent.filter((message) => message.chatId === chatId).at(-1)?.text ?? ''

describe('Судьи клуба: права', () => {
  it('президент клуба определяется по GoMafia и ведёт игры без пула', async () => {
    const ctx = createTestContext()
    const boss = await president(ctx)
    assert.equal(boss.account.goMafia.access, 'president')
    assert.equal(boss.account.goMafia.club.presidentID, 4242)

    const game = ratingGame(boss.account.id)
    const saved = await call(ctx, 'POST', '/v1/games', {
      token: boss.accessToken,
      body: { ...game, setup: { ...game.setup, host: { ...game.setup.host, goMafiaPlayerID: 4242 } } },
    })
    assert.equal(saved.status, 201)
  })

  it('резидент без доступа от президента рейтинг не ведёт, после добавления в пул — ведёт', async () => {
    const ctx = createTestContext()
    const boss = await president(ctx)
    const judge = await resident(ctx)
    assert.equal(judge.account.goMafia.access, 'none')
    assert.equal(judge.account.goMafia.club.id, 77)

    const denied = await call(ctx, 'POST', '/v1/games', { token: judge.accessToken, body: ratingGame(judge.account.id) })
    assert.equal(denied.status, 403)
    assert.equal(denied.json.error.code, 'host_access_required')

    const granted = await call(ctx, 'PUT', '/v1/club/hosts/5001', { token: boss.accessToken })
    assert.equal(granted.status, 200)
    assert.deepEqual(granted.json.hosts.map((host: any) => [host.player.id, host.player.nickname, host.isResident, host.account.username, host.account.source]),
      [[5001, 'Шерлок', true, 'diana', 'password']])
    await ctx.flush()
    assert.match(lastMessageTo(ctx, JUDGE_TG.id), /дал вам доступ/)

    assert.equal((await me(ctx, judge.accessToken)).goMafia.access, 'host')
    const saved = await call(ctx, 'POST', '/v1/games', { token: judge.accessToken, body: ratingGame(judge.account.id) })
    assert.equal(saved.status, 201)
    assert.equal(ctx.repo.games.get('a1b2c3d4-0000-4000-8000-000000000901')?.clubId, 77)
  })

  it('пулом управляет только президент, и только среди резидентов своего клуба', async () => {
    const ctx = createTestContext()
    const boss = await president(ctx)
    const judge = await resident(ctx)

    for (const [method, path] of [['GET', '/v1/club/hosts'], ['PUT', '/v1/club/hosts/5001'], ['DELETE', '/v1/club/hosts/5001'], ['DELETE', `/v1/club/requests/${judge.account.id}`]] as const) {
      const res = await call(ctx, method, path, { token: judge.accessToken })
      assert.deepEqual([res.status, res.json.error.code], [403, 'president_only'], `${method} ${path}`)
    }

    const stranger = await call(ctx, 'PUT', '/v1/club/hosts/5002', { token: boss.accessToken })
    assert.deepEqual([stranger.status, stranger.json.error.code], [404, 'not_resident'])
    const self = await call(ctx, 'PUT', '/v1/club/hosts/4242', { token: boss.accessToken })
    assert.equal(self.status, 422)
    assert.equal((await call(ctx, 'PUT', '/v1/club/hosts/abc', { token: boss.accessToken })).status, 422)
    assert.deepEqual(ctx.repo.hosts, [])
  })

  it('президент забирает доступ: привязка паролем остаётся, права клуба — нет', async () => {
    const ctx = createTestContext()
    const boss = await president(ctx)
    const judge = await resident(ctx)
    await call(ctx, 'PUT', '/v1/club/hosts/5001', { token: boss.accessToken })

    const revoked = await call(ctx, 'DELETE', '/v1/club/hosts/5001', { token: boss.accessToken })
    assert.equal(revoked.status, 200)
    assert.deepEqual(revoked.json.hosts, [])
    const account = await me(ctx, judge.accessToken)
    assert.equal(account.goMafia.player.id, 5001)
    assert.equal(account.goMafia.access, 'none')
  })

  it('привязка, сохранённая до пула судей, перечитывает клуб и находит президента', async () => {
    const ctx = createTestContext()
    const boss = await president(ctx)
    const stored = ctx.repo.users.get(boss.account.id)!
    ctx.repo.users.set(stored.id, { ...stored, gomafia: { ...stored.gomafia!, club: { id: 77, title: 'TITAN', city: 'Москва' } } })

    assert.equal((await me(ctx, boss.accessToken)).goMafia.access, 'none')
    await ctx.flush()
    const fresh = await me(ctx, boss.accessToken)
    assert.equal(fresh.goMafia.club.presidentID, 4242)
    assert.equal(fresh.goMafia.access, 'president')
  })

  it('сменился президент клуба в GoMafia — прежний теряет права после обновления профиля', async () => {
    const ctx = createTestContext()
    const boss = await president(ctx)
    ctx.gomafia.presidents.set('77', '5001')
    ctx.clock.now = new Date(ctx.clock.now.getTime() + 25 * 60 * 60_000)

    await me(ctx, boss.accessToken)
    await ctx.flush()
    const fresh = await me(ctx, boss.accessToken)
    assert.equal(fresh.goMafia.club.presidentID, 5001)
    assert.equal(fresh.goMafia.access, 'none')
  })
})

describe('Судьи клуба: заявка без пароля GoMafia', () => {
  it('судья оставляет ник, президент подтверждает — аккаунт привязан к игроку и получает доступ', async () => {
    const ctx = createTestContext()
    ctx.gomafia.requireAuth = true
    const boss = await president(ctx)
    const judge = await signIn(ctx, JUDGE_TG)

    const requested = await call(ctx, 'PUT', '/v1/me/club-request', { token: judge.accessToken, body: { nickname: ' шерлок ' } })
    assert.equal(requested.status, 200)
    assert.equal(requested.json.goMafia, null)
    assert.equal(requested.json.clubRequest.nickname, 'шерлок')
    await ctx.flush()
    const ping = lastMessageTo(ctx, TG_USER.id)
    assert.match(ping, /Диана, @diana просит доступ судьи клуба «TITAN» как Шерлок/)

    const list = await call(ctx, 'GET', '/v1/club/hosts', { token: boss.accessToken })
    assert.equal(list.status, 200)
    assert.deepEqual(list.json.hosts, [])
    assert.deepEqual(list.json.requests.map((request: any) => [request.id, request.player.id, request.account.name, request.account.username]),
      [[judge.account.id, 5001, 'Диана', 'diana']])

    const approved = await call(ctx, 'PUT', '/v1/club/hosts/5001', { token: boss.accessToken, body: { requestID: judge.account.id } })
    assert.equal(approved.status, 200)
    assert.deepEqual(approved.json.requests, [])
    assert.deepEqual(approved.json.hosts.map((host: any) => [host.player.id, host.account.username, host.account.source]), [[5001, 'diana', 'club']])

    const account = await me(ctx, judge.accessToken)
    assert.equal(account.goMafia.player.nickname, 'Шерлок')
    assert.equal(account.goMafia.source, 'club')
    assert.equal(account.goMafia.access, 'host')
    assert.equal(account.goMafia.club.id, 77)
    assert.equal(account.clubRequest, null)
    assert.equal(ctx.repo.gomafiaCreds.has(judge.account.id), false)

    // Своего пароля у судьи нет: в GoMafia сервер ходит входом президента.
    const search = await call(ctx, 'GET', '/v1/gomafia/players?q=ше', { token: judge.accessToken })
    assert.equal(search.status, 200)
    assert.ok(search.json.players.some((player: any) => player.id === 5001))
    assert.equal((await call(ctx, 'POST', '/v1/games', { token: judge.accessToken, body: ratingGame(judge.account.id) })).status, 201)
  })

  it('без доступа от президента судья без пароля в GoMafia не ходит', async () => {
    const ctx = createTestContext()
    ctx.gomafia.requireAuth = true
    await president(ctx)
    const judge = await signIn(ctx, JUDGE_TG)
    const search = await call(ctx, 'GET', '/v1/gomafia/players?q=ше', { token: judge.accessToken })
    assert.deepEqual([search.status, search.json.error.code], [409, 'gomafia_relogin_required'])
  })

  it('заявка привязывается только к игроку с тем же ником, и её нельзя подтвердить дважды', async () => {
    const ctx = createTestContext()
    ctx.gomafia.roster = [...ctx.gomafia.roster, gmPlayer(5003, 'Ватсон')]
    const boss = await president(ctx)
    const judge = await signIn(ctx, JUDGE_TG)
    await call(ctx, 'PUT', '/v1/me/club-request', { token: judge.accessToken, body: { nickname: 'Шерлок' } })

    const wrongPlayer = await call(ctx, 'PUT', '/v1/club/hosts/5003', { token: boss.accessToken, body: { requestID: judge.account.id } })
    assert.deepEqual([wrongPlayer.status, wrongPlayer.json.error.code], [404, 'request_not_found'])
    assert.equal(ctx.repo.users.get(judge.account.id)!.gomafia, null)

    assert.equal((await call(ctx, 'PUT', '/v1/club/hosts/5001', { token: boss.accessToken, body: { requestID: judge.account.id } })).status, 200)
    const again = await call(ctx, 'PUT', '/v1/club/hosts/5001', { token: boss.accessToken, body: { requestID: judge.account.id } })
    assert.deepEqual([again.status, again.json.error.code], [404, 'request_not_found'])
  })

  it('игрок уже вошёл со своим паролем — чужую заявку на его ник подтвердить нельзя', async () => {
    const ctx = createTestContext()
    const boss = await president(ctx)
    await resident(ctx, OTHER_TG)
    const impostor = await signIn(ctx, JUDGE_TG)
    await call(ctx, 'PUT', '/v1/me/club-request', { token: impostor.accessToken, body: { nickname: 'Шерлок' } })

    const res = await call(ctx, 'PUT', '/v1/club/hosts/5001', { token: boss.accessToken, body: { requestID: impostor.account.id } })
    assert.deepEqual([res.status, res.json.error.code], [409, 'gomafia_taken'])
    assert.equal(ctx.repo.users.get(impostor.account.id)!.gomafia, null)
    assert.deepEqual(ctx.repo.hosts, [])
  })

  it('президент забрал доступ — привязка по заявке снимается; отклонённая заявка пропадает', async () => {
    const ctx = createTestContext()
    const boss = await president(ctx)
    const judge = await signIn(ctx, JUDGE_TG)
    await call(ctx, 'PUT', '/v1/me/club-request', { token: judge.accessToken, body: { nickname: 'Шерлок' } })
    await call(ctx, 'PUT', '/v1/club/hosts/5001', { token: boss.accessToken, body: { requestID: judge.account.id } })

    await call(ctx, 'DELETE', '/v1/club/hosts/5001', { token: boss.accessToken })
    assert.equal((await me(ctx, judge.accessToken)).goMafia, null)

    await call(ctx, 'PUT', '/v1/me/club-request', { token: judge.accessToken, body: { nickname: 'Шерлок' } })
    const rejected = await call(ctx, 'DELETE', `/v1/club/requests/${judge.account.id}`, { token: boss.accessToken })
    assert.equal(rejected.status, 200)
    assert.deepEqual(rejected.json.requests, [])
    assert.equal((await me(ctx, judge.accessToken)).clubRequest, null)
  })

  it('вход своим паролем сильнее привязки по заявке: она переходит к настоящему владельцу', async () => {
    const ctx = createTestContext()
    const boss = await president(ctx)
    const judge = await signIn(ctx, JUDGE_TG)
    await call(ctx, 'PUT', '/v1/me/club-request', { token: judge.accessToken, body: { nickname: 'Шерлок' } })
    await call(ctx, 'PUT', '/v1/club/hosts/5001', { token: boss.accessToken, body: { requestID: judge.account.id } })

    const owner = await resident(ctx, OTHER_TG)
    assert.equal(owner.account.goMafia.source, 'password')
    assert.equal(owner.account.goMafia.access, 'host')
    assert.equal((await me(ctx, judge.accessToken)).goMafia, null)
  })

  it('заявка не нужна тому, кто привязал GoMafia; судья может её отозвать', async () => {
    const ctx = createTestContext()
    await president(ctx)
    const linked = await resident(ctx, OTHER_TG)
    const refused = await call(ctx, 'PUT', '/v1/me/club-request', { token: linked.accessToken, body: { nickname: 'Шерлок' } })
    assert.deepEqual([refused.status, refused.json.error.code], [409, 'gomafia_linked'])

    const judge = await signIn(ctx, JUDGE_TG)
    assert.equal((await call(ctx, 'PUT', '/v1/me/club-request', { token: judge.accessToken, body: { nickname: 'Ш' } })).status, 422)
    await call(ctx, 'PUT', '/v1/me/club-request', { token: judge.accessToken, body: { nickname: 'Шерлок' } })
    const withdrawn = await call(ctx, 'DELETE', '/v1/me/club-request', { token: judge.accessToken })
    assert.equal(withdrawn.json.clubRequest, null)
    assert.equal(ctx.repo.requests.size, 0)
  })
})
