import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { goMafiaPlayerID } from '../../src/modules/mafboard/titan.js'
import type { GoMafiaClubJSON, GoMafiaPlayerJSON, TitanLinkState } from '../../src/modules/mafboard/types.js'
import { call, createTestContext, NOW, signIn, TG_USER, type TestContext } from './helpers.js'

// Клубы MafBoard (docs/MAFBOARD.md, раздел «Клубы»). Выпуск 1а: клуб — своя запись, на неё
// ссылаются игры и подключение Titan, а права и чтение Titan пока считаются по-старому.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const JUDGE_TG = { ...TG_USER, id: 1002, username: 'other' }

const PLAYER: GoMafiaPlayerJSON = {
  id: 4242, nickname: 'host', fullName: null, avatarURL: null, elo: null, clubID: 77, clubTitle: 'TITAN',
  city: null, tournamentsPlayed: null, isInHostClub: false, isVerified: false,
}
const FULL_CLUB: GoMafiaClubJSON = { id: 77, title: 'TITAN', city: 'Москва', presidentID: 4242 }

function titanLink(connectionId: string): TitanLinkState {
  return {
    apiBase: 'https://club.titanpos.test/api/connect/v1', clubName: 'TITAN Нальчик', connectionId,
    scopes: ['clients:read'], tokenSealed: `sealed-${connectionId}`, linkedAt: NOW,
  }
}

/** Президент клуба GoMafia 77 (логин «host»). */
async function president(ctx: TestContext) {
  const session = await signIn(ctx)
  const linked = await call(ctx, 'POST', '/v1/me/gomafia', { token: session.accessToken, body: { login: 'host', password: 'secret' } })
  assert.equal(linked.json.goMafia.access, 'president')
  return { ...session, account: linked.json }
}

/** Резидент клуба 77 (игрок 5001) с привязкой паролем; доступа судьи у него ещё нет. */
async function resident(ctx: TestContext) {
  ctx.gomafia.passwords.set('Шерлок', { password: 'pw', userId: '5001', clubId: '77' })
  const session = await signIn(ctx, JUDGE_TG)
  const linked = await call(ctx, 'POST', '/v1/me/gomafia', { token: session.accessToken, body: { login: 'Шерлок', password: 'pw' } })
  return { ...session, account: linked.json }
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
    const guest = await signIn(ctx, { ...TG_USER, id: 1003, username: 'guest' })
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

  it('чтение клуба не удалось — аккаунт отдаётся с пустым списком клубов', async () => {
    const ctx = createTestContext()
    const host = await president(ctx)
    ctx.repo.clubByGomafiaId = async () => {
      throw new Error('relation "mb_clubs" does not exist')
    }
    const me = await call(ctx, 'GET', '/v1/me', { token: host.accessToken })
    assert.equal(me.status, 200)
    assert.deepEqual(me.json.clubs, [])
    assert.equal(me.json.goMafia.access, 'president')
  })
})

describe('Клубы: подключение Titan', () => {
  it('подключение пишется и в клуб, и в запись президента; отключение стирает оба', async () => {
    const ctx = createTestContext()
    const host = await president(ctx)

    const linked = await call(ctx, 'POST', '/v1/me/titan', { token: host.accessToken, body: { code: 'good-code' } })
    assert.equal(linked.status, 200)
    assert.deepEqual(linked.json.clubs[0].titan.club, { name: 'TITAN Нальчик' })

    const personal = ctx.repo.users.get(host.account.id)!.titan!
    const club = (await ctx.repo.clubByGomafiaId(77))!
    assert.equal(club.titan?.connectionId, personal.connectionId)
    assert.equal(club.titan?.tokenSealed, personal.tokenSealed)
    assert.equal(club.titanLinkedBy, host.account.id)
    assert.ok(!JSON.stringify(linked.json).includes(personal.tokenSealed))

    const unlinked = await call(ctx, 'DELETE', '/v1/me/titan', { token: host.accessToken })
    assert.equal(unlinked.json.clubs[0].titan, null)
    assert.equal(ctx.repo.users.get(host.account.id)!.titan, null)
    const after = (await ctx.repo.clubByGomafiaId(77))!
    assert.equal(after.titan, null)
    assert.equal(after.titanLinkedBy, null)
  })

  it('setClubTitanLink возвращает заменённое подключение', async () => {
    const ctx = createTestContext()
    const host = await president(ctx)
    const club = (await ctx.repo.clubByGomafiaId(77))!

    assert.equal(await ctx.repo.setClubTitanLink(club.id, titanLink('conn-a'), host.account.id), null)
    const replaced = await ctx.repo.setClubTitanLink(club.id, titanLink('conn-b'), host.account.id)
    assert.equal(replaced?.connectionId, 'conn-a')
    assert.equal((await ctx.repo.clubByGomafiaId(77))?.titan?.connectionId, 'conn-b')
    assert.equal((await ctx.repo.setClubTitanLink(club.id, null, null))?.connectionId, 'conn-b')
  })

  it('старый личный ключ президента переезжает в клуб при обновлении привязки', async () => {
    const ctx = createTestContext()
    const session = await signIn(ctx)
    // Привязка без президента (страница клуба тогда не открылась), а клуб Titan уже подключён.
    await ctx.repo.setGomafiaLink(session.account.id, { player: PLAYER, club: { id: 77, title: 'TITAN', city: null }, source: 'password' }, NOW)
    await ctx.repo.setTitanLink(session.account.id, titanLink('conn-old'))
    assert.equal((await ctx.repo.clubByGomafiaId(77))?.titan, null)

    await ctx.repo.setGomafiaLink(session.account.id, { player: PLAYER, club: FULL_CLUB }, NOW)
    const club = (await ctx.repo.clubByGomafiaId(77))!
    assert.equal(club.titan?.connectionId, 'conn-old')
    assert.equal(club.titanLinkedBy, session.account.id)
  })

  it('у клуба уже есть подключение — личный ключ нового президента его не заменяет', async () => {
    const ctx = createTestContext()
    const session = await signIn(ctx)
    await ctx.repo.setGomafiaLink(session.account.id, { player: PLAYER, club: FULL_CLUB, source: 'password' }, NOW)
    const club = (await ctx.repo.clubByGomafiaId(77))!
    await ctx.repo.setClubTitanLink(club.id, titanLink('conn-club'), null)
    await ctx.repo.setTitanLink(session.account.id, titanLink('conn-personal'))

    await ctx.repo.setGomafiaLink(session.account.id, { player: PLAYER, club: FULL_CLUB }, NOW)
    assert.equal((await ctx.repo.clubByGomafiaId(77))?.titan?.connectionId, 'conn-club')
  })

  it('резидент без прав президента личным ключом клуб не подключает', async () => {
    const ctx = createTestContext()
    const session = await signIn(ctx)
    const notPresident = { ...FULL_CLUB, presidentID: 9999 }
    await ctx.repo.setGomafiaLink(session.account.id, { player: PLAYER, club: notPresident, source: 'password' }, NOW)
    await ctx.repo.setTitanLink(session.account.id, titanLink('conn-stale'))
    await ctx.repo.setGomafiaLink(session.account.id, { player: PLAYER, club: notPresident }, NOW)
    assert.equal((await ctx.repo.clubByGomafiaId(77))?.titan, null)
  })

  it('удаление аккаунта подключившего снимает подключение с клуба', async () => {
    const ctx = createTestContext()
    const host = await president(ctx)
    await call(ctx, 'POST', '/v1/me/titan', { token: host.accessToken, body: { code: 'good-code' } })
    assert.ok((await ctx.repo.clubByGomafiaId(77))?.titan)

    assert.equal((await call(ctx, 'DELETE', '/v1/me', { token: host.accessToken })).status, 200)
    const club = (await ctx.repo.clubByGomafiaId(77))!
    assert.equal(club.titan, null)
    assert.equal(club.titanLinkedBy, null)
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

    const guest = await signIn(ctx, { ...TG_USER, id: 1003, username: 'guest' })
    const funky = game(guest.account.id, 'funky', null, 'A1B2C3D4-0000-4000-8000-000000000902')
    assert.equal((await call(ctx, 'POST', '/v1/games', { token: guest.accessToken, body: funky })).status, 201)
    assert.equal(ctx.repo.games.get(funky.setup.gameID.toLowerCase())!.clubRef, null)
  })
})
