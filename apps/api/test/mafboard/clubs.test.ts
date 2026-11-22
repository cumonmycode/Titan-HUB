import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { sealSecrets } from '../../src/modules/mafboard/studio.js'
import { goMafiaPlayerID } from '../../src/modules/mafboard/titan.js'
import type { GoMafiaClubJSON, GoMafiaPlayerJSON, TitanLinkState } from '../../src/modules/mafboard/types.js'
import { call, config, connectTitan, createTestContext, gmPlayer, NOW, signIn, TG_USER, type TestContext } from './helpers.js'

// Клубы MafBoard (docs/MAFBOARD.md, раздел «Клубы»): клуб — своя запись, на неё ссылаются игры и
// подключение Titan HUB. Подключение принадлежит клубу и читается из него (`PUT/DELETE /v1/clubs/:id/titan`);
// президент клуба по-прежнему берётся из GoMafia.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const RESIDENT_TG = { ...TG_USER, id: 1002, username: 'other' }
const JUDGE_TG = { ...TG_USER, id: 1004, username: 'judge' }
const GUEST_TG = { ...TG_USER, id: 1003, username: 'guest' }

const PLAYER: GoMafiaPlayerJSON = {
  id: 4242, nickname: 'host', fullName: null, avatarURL: null, elo: null, clubID: 77, clubTitle: 'TITAN',
  city: null, tournamentsPlayed: null, isInHostClub: false, isVerified: false,
}
const FULL_CLUB: GoMafiaClubJSON = { id: 77, title: 'TITAN', city: 'Москва', presidentID: 4242 }

/** Подключение с настоящим шифротекстом ключа: его можно отозвать в HUB. */
function titanLink(connectionId: string, token = `tcn_${connectionId}`): TitanLinkState {
  return {
    apiBase: 'https://club.titanpos.test/api/connect/v1', clubName: 'TITAN Нальчик', connectionId,
    scopes: ['clients:read'], tokenSealed: sealSecrets(config.studioSecretsKey, { token }), linkedAt: NOW,
  }
}

/** Президент клуба GoMafia 77 (логин «host», игрок 4242). */
async function president(ctx: TestContext) {
  const session = await signIn(ctx)
  const linked = await call(ctx, 'POST', '/v1/me/gomafia', { token: session.accessToken, body: { login: 'host', password: 'secret' } })
  assert.equal(linked.json.goMafia.access, 'president')
  return { ...session, account: linked.json }
}

/** Президент, подключивший клуб Titan HUB (ключ `tcn_live`, подключение `conn-1`). */
async function titanPresident(ctx: TestContext) {
  const host = await president(ctx)
  const linked = await connectTitan(ctx, host.accessToken, { clubId: host.account.clubs[0].id })
  assert.equal(linked.status, 200)
  return { ...host, account: linked.json }
}

/**
 * Копия подключения клуба в личной записи пользователя — так её оставлял `/v1/me/titan` сборок до 4в.
 * Теперь копию никто не пишет, но старые записи остаются, пока их не сотрёт отключение клуба.
 */
async function legacyMirror(ctx: TestContext, userId: string) {
  const club = (await ctx.repo.clubByGomafiaId(77))!
  await ctx.repo.setTitanLink(userId, club.titan)
}

/** Резидент клуба 77 (игрок 5001) с привязкой паролем; доступа судьи у него ещё нет. */
async function resident(ctx: TestContext) {
  ctx.gomafia.passwords.set('Шерлок', { password: 'pw', userId: '5001', clubId: '77' })
  const session = await signIn(ctx, RESIDENT_TG)
  const linked = await call(ctx, 'POST', '/v1/me/gomafia', { token: session.accessToken, body: { login: 'Шерлок', password: 'pw' } })
  return { ...session, account: linked.json }
}

/** Ещё один резидент (игрок 5003), которого президент добавил в пул судей. */
async function poolJudge(ctx: TestContext, presidentToken: string) {
  const watson = gmPlayer(5003, 'Ватсон')
  ctx.gomafia.players.set('5003', watson)
  ctx.gomafia.roster.push(watson)
  ctx.gomafia.passwords.set('Ватсон', { password: 'pw', userId: '5003', clubId: '77' })
  const session = await signIn(ctx, JUDGE_TG)
  await call(ctx, 'POST', '/v1/me/gomafia', { token: session.accessToken, body: { login: 'Ватсон', password: 'pw' } })
  assert.equal((await call(ctx, 'PUT', '/v1/club/hosts/5003', { token: presidentToken })).status, 200)
  return session
}

/** Президентом клуба 77 в GoMafia становится другой игрок; снимки привязок устаревают (старше суток). */
function changePresident(ctx: TestContext, gomafiaId: string) {
  ctx.gomafia.presidents.set('77', gomafiaId)
  ctx.clock.now = new Date(ctx.clock.now.getTime() + 25 * 60 * 60_000)
}

/** Аккаунт после фонового обновления привязки GoMafia. */
async function freshAccount(ctx: TestContext, token: string) {
  await call(ctx, 'GET', '/v1/me', { token })
  await ctx.flush()
  return (await call(ctx, 'GET', '/v1/me', { token })).json
}

function game(hostId: string, format: 'rating' | 'funky', clubID: number | null, gameID = 'A1B2C3D4-0000-4000-8000-000000000901') {
  return {
    schemaVersion: 1,
    setup: {
      gameID,
      format,
      ruleset: { variant: 'sport' },
      host: { userID: hostId, goMafiaPlayerID: null, clubID },
      seats: Array.from({ length: 10 }, (_, i) => ({ seat: i + 1, playerID: goMafiaPlayerID(5001 + i), role: 'civilian' })),
      createdAt: '2026-10-16T17:00:00.000Z',
    },
    finishedAt: '2026-10-16T17:55:00.000Z',
    outcome: { winner: 'red' },
  }
}

describe('Клубы: запись клуба', () => {
  it('привязка GoMafia заводит клуб; президент видит его в аккаунте как владелец', async () => {
    const ctx = createTestContext()
    const host = await president(ctx)

    assert.equal(host.account.clubs.length, 1)
    const [club] = host.account.clubs
    assert.match(club.id, UUID)
    assert.deepEqual({ ...club, id: null }, { id: null, name: 'TITAN', city: 'Москва', role: 'owner', goMafiaClubID: 77, titan: null })

    const stored = await ctx.repo.clubByGomafiaId(77)
    assert.equal(stored?.id, club.id)
    assert.equal(ctx.repo.clubs.size, 1)
    // Прежние поля аккаунта на месте: старые сборки приложения читают только их.
    assert.equal(host.account.goMafia.access, 'president')
    assert.equal(host.account.titan, null)
  })

  it('судья пула видит клуб как судья, резидент без доступа и ведущий без GoMafia — пустой список', async () => {
    const ctx = createTestContext()
    const guest = await signIn(ctx, GUEST_TG)
    assert.deepEqual(guest.account.clubs, [])

    const host = await president(ctx)
    const judge = await resident(ctx)
    assert.deepEqual(judge.account.clubs, [])

    assert.equal((await call(ctx, 'PUT', '/v1/club/hosts/5001', { token: host.accessToken })).status, 200)
    const me = await call(ctx, 'GET', '/v1/me', { token: judge.accessToken })
    assert.equal(me.json.clubs.length, 1)
    assert.equal(me.json.clubs[0].role, 'judge')
    assert.equal(me.json.clubs[0].id, host.account.clubs[0].id)
    assert.equal(ctx.repo.clubs.size, 1)
  })

  it('неполный снимок клуба не затирает название и город', async () => {
    const ctx = createTestContext()
    const session = await signIn(ctx)
    await ctx.repo.setGomafiaLink(session.account.id, { player: PLAYER, club: FULL_CLUB, source: 'password' }, NOW)
    // Страница клуба не открылась: в привязке заглушка названия, города и президента нет.
    await ctx.repo.setGomafiaLink(session.account.id, { player: PLAYER, club: { id: 77, title: 'Клуб #77', city: null } }, NOW)

    const club = await ctx.repo.clubByGomafiaId(77)
    assert.equal(club?.name, 'TITAN')
    assert.equal(club?.city, 'Москва')

    // Полный снимок с новым названием клуб обновляет.
    await ctx.repo.setGomafiaLink(session.account.id, { player: PLAYER, club: { ...FULL_CLUB, title: 'TITAN Москва' } }, NOW)
    assert.equal((await ctx.repo.clubByGomafiaId(77))?.name, 'TITAN Москва')
  })

  it('клуба ещё нет — неполный снимок заводит его с заглушкой', async () => {
    const ctx = createTestContext()
    const session = await signIn(ctx)
    await ctx.repo.setGomafiaLink(session.account.id, { player: PLAYER, club: { id: 78, title: 'Клуб #78', city: null }, source: 'password' }, NOW)
    assert.equal((await ctx.repo.clubByGomafiaId(78))?.name, 'Клуб #78')
  })

  it('запись клуба не читается — клубов в аккаунте нет, права и Titan берутся по-старому из записи президента', async () => {
    const ctx = createTestContext()
    const host = await titanPresident(ctx)
    await legacyMirror(ctx, host.account.id)
    ctx.repo.clubByGomafiaId = async () => {
      throw new Error('relation "mb_clubs" does not exist')
    }
    const me = await call(ctx, 'GET', '/v1/me', { token: host.accessToken })
    assert.equal(me.status, 200)
    assert.deepEqual(me.json.clubs, [])
    assert.equal(me.json.goMafia.access, 'president')
    assert.deepEqual(me.json.titan.club, { name: 'TITAN Нальчик' })
  })
})

describe('Клубы: подключение Titan принадлежит клубу', () => {
  it('подключение пишется в клуб, личная запись — нет; отключение стирает подключение, старую копию и отзывает ключ', async () => {
    const ctx = createTestContext()
    const host = await titanPresident(ctx)
    assert.deepEqual(host.account.clubs[0].titan.club, { name: 'TITAN Нальчик' })
    assert.equal(host.account.titan.isShared, false)

    const club = (await ctx.repo.clubByGomafiaId(77))!
    assert.equal(club.titan?.connectionId, 'conn-1')
    assert.equal(club.titanLinkedBy, host.account.id)
    assert.equal(ctx.repo.users.get(host.account.id)!.titan, null)
    assert.ok(!JSON.stringify(host.account).includes(club.titan!.tokenSealed))

    await legacyMirror(ctx, host.account.id)
    const unlinked = await call(ctx, 'DELETE', `/v1/clubs/${club.id}/titan`, { token: host.accessToken })
    assert.equal(unlinked.json.titan, null)
    assert.equal(unlinked.json.clubs[0].titan, null)
    assert.equal(ctx.repo.users.get(host.account.id)!.titan, null)
    const after = (await ctx.repo.clubByGomafiaId(77))!
    assert.equal(after.titan, null)
    assert.equal(after.titanLinkedBy, null)
    await ctx.flush()
    assert.deepEqual(ctx.titan.calls.disconnect, ['tcn_live'])
  })

  it('setClubTitanLink возвращает заменённое подключение', async () => {
    const ctx = createTestContext()
    const host = await president(ctx)
    const club = (await ctx.repo.clubByGomafiaId(77))!

    assert.equal(await ctx.repo.setClubTitanLink(club.id, titanLink('conn-a'), host.account.id), null)
    const replaced = await ctx.repo.setClubTitanLink(club.id, titanLink('conn-b'), host.account.id)
    assert.equal(replaced?.connectionId, 'conn-a')
    assert.equal((await ctx.repo.clubByGomafiaId(77))?.titan?.connectionId, 'conn-b')
    assert.equal((await ctx.repo.clubByGomafiaId(77))?.titanLinkedBy, host.account.id)
    assert.equal((await ctx.repo.clubByTitanConnection('conn-b'))?.id, club.id)
    assert.equal(await ctx.repo.clubByTitanConnection('conn-a'), null)
    assert.equal((await ctx.repo.setClubTitanLink(club.id, null, null))?.connectionId, 'conn-b')
    assert.equal((await ctx.repo.clubByGomafiaId(77))?.titanLinkedBy, null)
  })

  it('личная запись в клуб сама не переезжает и без подключения клуба ничего не даёт', async () => {
    const ctx = createTestContext()
    const host = await president(ctx)
    await ctx.repo.setTitanLink(host.account.id, titanLink('conn-personal'))
    // Обновление привязки GoMafia подключение клуба не трогает: его меняют только подключение и отключение.
    await ctx.repo.setGomafiaLink(host.account.id, { player: PLAYER, club: FULL_CLUB }, NOW)

    assert.equal((await ctx.repo.clubByGomafiaId(77))?.titan, null)
    const me = await call(ctx, 'GET', '/v1/me', { token: host.accessToken })
    assert.equal(me.json.titan, null)
    const roster = await call(ctx, 'GET', `/v1/clubs/${me.json.clubs[0].id}/titan/players`, { token: host.accessToken })
    assert.equal(roster.status, 409)
    assert.equal(roster.json.error.code, 'titan_not_linked')
  })

  it('смена президента: Titan остаётся у клуба — виден судье и новому президенту, бывшему — нет', async () => {
    const ctx = createTestContext()
    const former = await titanPresident(ctx)
    await legacyMirror(ctx, former.account.id)
    const successor = await resident(ctx)
    const judge = await poolJudge(ctx, former.accessToken)
    changePresident(ctx, '5001')

    const next = await freshAccount(ctx, successor.accessToken)
    assert.equal(next.goMafia.access, 'president')
    assert.deepEqual(next.titan.club, { name: 'TITAN Нальчик' })
    assert.equal(next.titan.isShared, false)
    assert.equal(next.clubs[0].role, 'owner')
    const clubId = next.clubs[0].id
    assert.equal((await call(ctx, 'GET', `/v1/clubs/${clubId}/titan/players`, { token: successor.accessToken })).status, 200)

    const seenByJudge = await freshAccount(ctx, judge.accessToken)
    assert.equal(seenByJudge.goMafia.access, 'host')
    assert.equal(seenByJudge.titan.isShared, true)

    const seenByFormer = await freshAccount(ctx, former.accessToken)
    assert.equal(seenByFormer.goMafia.access, 'none')
    assert.equal(seenByFormer.titan, null)
    assert.deepEqual(seenByFormer.clubs, [])

    // Новый президент отключает клуб, хотя подключал не он: ключ отозван, копия у бывшего стёрта.
    const unlinked = await call(ctx, 'DELETE', `/v1/clubs/${clubId}/titan`, { token: successor.accessToken })
    assert.equal(unlinked.status, 200)
    assert.equal(unlinked.json.titan, null)
    assert.equal((await ctx.repo.clubByGomafiaId(77))?.titan, null)
    assert.equal(ctx.repo.users.get(former.account.id)!.titan, null)
    await ctx.flush()
    assert.deepEqual(ctx.titan.calls.disconnect, ['tcn_live'])
    assert.equal((await freshAccount(ctx, judge.accessToken)).titan, null)
  })

  it('отключает только владелец клуба: подключивший, переставший быть президентом, и судья пула — нет', async () => {
    const ctx = createTestContext()
    const former = await titanPresident(ctx)
    const clubId = former.account.clubs[0].id
    await resident(ctx)
    const judge = await poolJudge(ctx, former.accessToken)
    changePresident(ctx, '5001')
    assert.equal((await freshAccount(ctx, former.accessToken)).goMafia.access, 'none')

    const byJudge = await call(ctx, 'DELETE', `/v1/clubs/${clubId}/titan`, { token: judge.accessToken })
    assert.equal(byJudge.status, 403)
    assert.equal(byJudge.json.error.code, 'owner_only')

    // Бывший президент в клубе больше не состоит: подключение остаётся новому президенту и судьям.
    const byFormer = await call(ctx, 'DELETE', `/v1/clubs/${clubId}/titan`, { token: former.accessToken })
    assert.equal(byFormer.status, 403)
    assert.equal(byFormer.json.error.code, 'club_access_required')
    assert.equal((await ctx.repo.clubByGomafiaId(77))?.titan?.connectionId, 'conn-1')
    await ctx.flush()
    assert.deepEqual(ctx.titan.calls.disconnect, [])
  })

  it('бывший президент с устаревшим снимком клуб не отключит', async () => {
    const ctx = createTestContext()
    const former = await titanPresident(ctx)
    changePresident(ctx, '5001')

    const denied = await call(ctx, 'DELETE', `/v1/clubs/${former.account.clubs[0].id}/titan`, { token: former.accessToken })
    assert.equal(denied.status, 403)
    assert.equal(denied.json.error.code, 'club_access_required')
    assert.equal((await ctx.repo.clubByGomafiaId(77))?.titan?.connectionId, 'conn-1')
  })

  it('новый президент подключает клуб заново: прежний ключ отзывается, копия у бывшего президента стирается', async () => {
    const ctx = createTestContext()
    const former = await titanPresident(ctx)
    await legacyMirror(ctx, former.account.id)
    const successor = await resident(ctx)
    changePresident(ctx, '5001')
    const next = await freshAccount(ctx, successor.accessToken)

    ctx.titan.issued = { accessToken: 'tcn_second', connectionId: 'conn-2' }
    const relinked = await connectTitan(ctx, successor.accessToken, { clubId: next.clubs[0].id })
    assert.equal(relinked.status, 200)

    const club = (await ctx.repo.clubByGomafiaId(77))!
    assert.equal(club.titan?.connectionId, 'conn-2')
    assert.equal(club.titanLinkedBy, successor.account.id)
    assert.equal(ctx.repo.users.get(successor.account.id)!.titan, null)
    assert.equal(ctx.repo.users.get(former.account.id)!.titan, null)
    await ctx.flush()
    assert.deepEqual(ctx.titan.calls.disconnect, ['tcn_live'])
  })

  it('клуб HUB, уже подключённый к другому клубу MafBoard, второй раз не подключается — 409, ключ отозван', async () => {
    const ctx = createTestContext()
    const other = await signIn(ctx, GUEST_TG)
    assert.equal((await call(ctx, 'POST', '/v1/clubs', { token: other.accessToken, body: { code: 'good-code' } })).status, 201)
    ctx.titan.issued = { accessToken: 'tcn_second', connectionId: 'conn-2' }

    const host = await president(ctx)
    const linked = await connectTitan(ctx, host.accessToken, { clubId: host.account.clubs[0].id })
    assert.equal(linked.status, 409)
    assert.equal(linked.json.error.code, 'club_exists')
    await ctx.flush()
    assert.deepEqual(ctx.titan.calls.disconnect, ['tcn_second'])
  })

  it('бывший президент с устаревшим снимком подключить клуб не может', async () => {
    const ctx = createTestContext()
    const former = await titanPresident(ctx)
    // Президент в GoMafia сменился, а снимок бывшего ещё называет президентом его самого.
    changePresident(ctx, '5001')
    ctx.titan.issued = { accessToken: 'tcn_second', connectionId: 'conn-2' }

    const denied = await connectTitan(ctx, former.accessToken, { clubId: former.account.clubs[0].id })
    assert.equal(denied.status, 403)
    assert.equal(denied.json.error.code, 'club_access_required')
    assert.equal((await ctx.repo.clubByGomafiaId(77))?.titan?.connectionId, 'conn-1')
    await ctx.flush()
    // Код не обменивался: новый ключ в HUB не выдан и отзывать нечего.
    assert.deepEqual(ctx.titan.calls.disconnect, [])
  })

  it('личная запись не-президента (осталась от прежних времён) ничего не даёт; удаление аккаунта отзывает только её', async () => {
    const ctx = createTestContext()
    await titanPresident(ctx)
    const guest = await signIn(ctx, GUEST_TG)
    await ctx.repo.setTitanLink(guest.account.id, titanLink('conn-legacy', 'tcn_legacy'))
    const me = await call(ctx, 'GET', '/v1/me', { token: guest.accessToken })
    assert.equal(me.json.titan, null)
    assert.deepEqual(me.json.clubs, [])

    // Прежняя ручка отключения снята — запись стирается вместе с аккаунтом.
    assert.equal((await call(ctx, 'DELETE', '/v1/me/titan', { token: guest.accessToken })).status, 426)
    assert.equal((await call(ctx, 'DELETE', '/v1/me', { token: guest.accessToken })).status, 200)
    await ctx.flush()
    assert.deepEqual(ctx.titan.calls.disconnect, ['tcn_legacy'])
    assert.equal((await ctx.repo.clubByGomafiaId(77))?.titan?.connectionId, 'conn-1')
  })

  it('удаление аккаунта бывшего президента, который подключал, подключение клуба сохраняет', async () => {
    const ctx = createTestContext()
    const former = await titanPresident(ctx)
    const successor = await resident(ctx)
    changePresident(ctx, '5001')
    await freshAccount(ctx, successor.accessToken)

    assert.equal((await call(ctx, 'DELETE', '/v1/me', { token: former.accessToken })).status, 200)
    const club = (await ctx.repo.clubByGomafiaId(77))!
    assert.equal(club.titan?.connectionId, 'conn-1')
    assert.equal(club.titanLinkedBy, null)
    await ctx.flush()
    assert.deepEqual(ctx.titan.calls.disconnect, [])
    assert.deepEqual((await call(ctx, 'GET', '/v1/me', { token: successor.accessToken })).json.titan.club, { name: 'TITAN Нальчик' })
  })

  it('удаление аккаунта действующего президента, который подключал, снимает подключение и отзывает ключ', async () => {
    const ctx = createTestContext()
    const host = await titanPresident(ctx)

    assert.equal((await call(ctx, 'DELETE', '/v1/me', { token: host.accessToken })).status, 200)
    const club = (await ctx.repo.clubByGomafiaId(77))!
    assert.equal(club.titan, null)
    assert.equal(club.titanLinkedBy, null)
    await ctx.flush()
    assert.deepEqual(ctx.titan.calls.disconnect, ['tcn_live'])
  })

  it('удаление аккаунта президента, который клуб не подключал, подключение не трогает', async () => {
    const ctx = createTestContext()
    await titanPresident(ctx)
    const successor = await resident(ctx)
    changePresident(ctx, '5001')
    assert.equal((await freshAccount(ctx, successor.accessToken)).goMafia.access, 'president')

    assert.equal((await call(ctx, 'DELETE', '/v1/me', { token: successor.accessToken })).status, 200)
    assert.equal((await ctx.repo.clubByGomafiaId(77))?.titan?.connectionId, 'conn-1')
    await ctx.flush()
    assert.deepEqual(ctx.titan.calls.disconnect, [])
  })
})

describe('Клубы: игры', () => {
  it('игра клуба ссылается на клуб, личная — нет; повторная загрузка ссылку сохраняет', async () => {
    const ctx = createTestContext()
    const host = await president(ctx)
    const clubId = host.account.clubs[0].id

    const rating = game(host.account.id, 'rating', 77)
    assert.equal((await call(ctx, 'POST', '/v1/games', { token: host.accessToken, body: rating })).status, 201)
    const stored = ctx.repo.games.get(rating.setup.gameID.toLowerCase())!
    assert.equal(stored.clubId, 77)
    assert.equal(stored.clubRef, clubId)

    assert.equal((await call(ctx, 'POST', '/v1/games', { token: host.accessToken, body: rating })).status, 200)
    assert.equal(ctx.repo.games.get(rating.setup.gameID.toLowerCase())!.clubRef, clubId)

    const guest = await signIn(ctx, GUEST_TG)
    const funky = game(guest.account.id, 'funky', null, 'A1B2C3D4-0000-4000-8000-000000000902')
    assert.equal((await call(ctx, 'POST', '/v1/games', { token: guest.accessToken, body: funky })).status, 201)
    assert.equal(ctx.repo.games.get(funky.setup.gameID.toLowerCase())!.clubRef, null)
  })
})
