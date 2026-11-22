import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { handleBotUpdate, type BotDeps } from '../../src/modules/mafboard/bot.js'
import { pickPhotoSize } from '../../src/modules/mafboard/clubBot.js'
import { CLUB_PLAYER_ID } from '../../src/modules/mafboard/playerIds.js'
import { goMafiaPlayerID } from '../../src/modules/mafboard/titan.js'
import { ADMIN_TG, call, callback, config, createTestContext, JPEG_BYTES, message, signIn, TG_USER, titanClient, type TestContext } from './helpers.js'

// Клуб без подключений (docs/MAFBOARD.md, «Клуб без подключений»): заявка по названию с одобрения владельца
// платформы в боте, свои игроки клуба (их заводит владелец клуба), фото игроков в MafBoard от судей и от самих
// игроков через бота, рейтинговые игры со своими игроками.

const OWNER_TG = { ...TG_USER, id: 3001, username: 'club_owner' }
const JUDGE_TG = { ...TG_USER, id: 3002, username: 'club_judge' }
const STRANGER_TG = { ...TG_USER, id: 3003, username: 'stranger' }
const PLAYER_TG = { ...TG_USER, id: 3004, username: 'player' }

function bot(ctx: TestContext): BotDeps {
  return {
    repo: ctx.repo,
    messenger: ctx.messenger,
    config,
    now: () => ctx.clock.now,
    club: { images: ctx.images, limiter: ctx.deps.limiter, adminTgId: ADMIN_TG.id },
  }
}

async function apply(ctx: TestContext, token: string, name = 'Мафия у моря') {
  const res = await call(ctx, 'POST', '/v1/clubs/applications', { token, body: { name, city: 'Сочи' } })
  await ctx.flush()
  return res
}

/** Владелец клуба без подключений: заявка одобрена владельцем платформы. */
async function ownerWithClub(ctx: TestContext) {
  const session = await signIn(ctx, OWNER_TG)
  const applied = await apply(ctx, session.accessToken)
  assert.equal(applied.status, 201)
  await handleBotUpdate(callback(ADMIN_TG, ctx.messenger.callbackFor('Одобрить')) as any, bot(ctx))
  const me = await call(ctx, 'GET', '/v1/me', { token: session.accessToken })
  const clubId = me.json.clubs[0].id as string
  return { ...session, clubId }
}

async function judgeOf(ctx: TestContext, ownerToken: string, clubId: string) {
  const session = await signIn(ctx, JUDGE_TG)
  const invite = await call(ctx, 'POST', `/v1/clubs/${clubId}/invites`, { token: ownerToken })
  const token = new URLSearchParams(new URL(invite.json.url).hash.slice(1)).get('t')!
  const joined = await call(ctx, 'POST', '/v1/clubs/join', { token: session.accessToken, body: { token } })
  assert.equal(joined.status, 200)
  return session
}

async function addPlayer(ctx: TestContext, token: string, clubId: string, nickname: string) {
  return call(ctx, 'POST', `/v1/clubs/${clubId}/players`, { token, body: { nickname } })
}

async function putPhoto(ctx: TestContext, token: string, clubId: string, playerId: string, bytes: Buffer = JPEG_BYTES) {
  const response = await ctx.app.request(`/api/mafboard/v1/clubs/${clubId}/players/${playerId}/photo`, {
    method: 'PUT',
    headers: { 'x-real-ip': '10.0.0.1', authorization: `Bearer ${token}`, 'content-type': 'image/jpeg' },
    body: bytes,
  })
  return { status: response.status, json: await response.json() as any }
}

function ratingGame(hostId: string, clubRef: string, seats: string[], gameID = 'C1B2C3D4-0000-4000-8000-000000000c01') {
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

describe('Заявка на клуб без подключений', () => {
  it('уходит владельцу платформы с кнопками; одобрена — клуб без GoMafia и Titan, заявитель — владелец', async () => {
    const ctx = createTestContext()
    const session = await signIn(ctx, OWNER_TG)
    const applied = await apply(ctx, session.accessToken)
    assert.equal(applied.status, 201)
    assert.equal(applied.json.application.status, 'pending')
    const toAdmin = ctx.messenger.sent.find((sent) => sent.chatId === ADMIN_TG.id)
    assert.ok(toAdmin?.text.includes('Мафия у моря') && toAdmin.text.includes('@club_owner'))

    const again = await apply(ctx, session.accessToken, 'Второй клуб')
    assert.equal(again.status, 409)
    assert.equal(again.json.error.code, 'application_pending')

    // Чужая кнопка ничего не решает.
    await handleBotUpdate(callback(STRANGER_TG, ctx.messenger.callbackFor('Одобрить')) as any, bot(ctx))
    assert.equal((await call(ctx, 'GET', '/v1/me/club-application', { token: session.accessToken })).json.application.status, 'pending')

    await handleBotUpdate(callback(ADMIN_TG, ctx.messenger.callbackFor('Одобрить')) as any, bot(ctx))
    const status = await call(ctx, 'GET', '/v1/me/club-application', { token: session.accessToken })
    assert.equal(status.json.application.status, 'approved')
    assert.ok(ctx.messenger.sent.some((sent) => sent.chatId === OWNER_TG.id && sent.text.includes('вы его владелец')))

    const me = await call(ctx, 'GET', '/v1/me', { token: session.accessToken })
    assert.equal(me.json.clubs.length, 1)
    assert.equal(me.json.clubs[0].id, status.json.application.clubId)
    assert.deepEqual(
      { name: me.json.clubs[0].name, city: me.json.clubs[0].city, role: me.json.clubs[0].role, goMafia: me.json.clubs[0].goMafiaClubID, titan: me.json.clubs[0].titan ?? null },
      { name: 'Мафия у моря', city: 'Сочи', role: 'owner', goMafia: null, titan: null },
    )

    // Повторное нажатие — заявка уже решена, второго клуба нет.
    await handleBotUpdate(callback(ADMIN_TG, ctx.messenger.callbackFor('Одобрить')) as any, bot(ctx))
    assert.equal(ctx.messenger.answers.at(-1)?.text, 'Заявка уже решена')
    assert.equal(ctx.repo.clubs.size, 1)
  })

  it('отклонена — клуба нет, заявитель узнаёт; после решения можно подать новую', async () => {
    const ctx = createTestContext()
    const session = await signIn(ctx, OWNER_TG)
    await apply(ctx, session.accessToken)
    await handleBotUpdate(callback(ADMIN_TG, ctx.messenger.callbackFor('Отклонить')) as any, bot(ctx))
    assert.equal((await call(ctx, 'GET', '/v1/me/club-application', { token: session.accessToken })).json.application.status, 'rejected')
    assert.equal(ctx.repo.clubs.size, 0)
    assert.ok(ctx.messenger.sent.some((sent) => sent.chatId === OWNER_TG.id && sent.text.includes('отклонили')))
    assert.equal((await apply(ctx, session.accessToken, 'Новый клуб')).status, 201)
  })

  it('заявка без ответа дольше трёх дней не держит: новая закрывает её', async () => {
    const ctx = createTestContext()
    const session = await signIn(ctx, OWNER_TG)
    const first = await apply(ctx, session.accessToken)
    ctx.clock.now = new Date(ctx.clock.now.getTime() + 2 * 24 * 3600_000)
    assert.equal((await apply(ctx, session.accessToken, 'Снова')).status, 409)
    ctx.clock.now = new Date(ctx.clock.now.getTime() + 2 * 24 * 3600_000)
    const again = await apply(ctx, session.accessToken, 'Снова')
    assert.equal(again.status, 201)
    assert.equal(ctx.repo.applications.get(first.json.application.id)?.status, 'rejected')
  })

  it('без MAFBOARD_ADMIN_TG_ID заявки не принимаются', async () => {
    const ctx = createTestContext({ config: { ...config, adminTgId: null } })
    const session = await signIn(ctx, OWNER_TG)
    const res = await apply(ctx, session.accessToken)
    assert.equal(res.status, 503)
    assert.equal(res.json.error.code, 'applications_unavailable')
  })
})

describe('Свои игроки клуба', () => {
  it('заводит владелец; судья видит их в составе, но заводить не может; ник в клубе один', async () => {
    const ctx = createTestContext()
    const owner = await ownerWithClub(ctx)
    const judge = await judgeOf(ctx, owner.accessToken, owner.clubId)

    const added = await addPlayer(ctx, owner.accessToken, owner.clubId, 'Тигр')
    assert.equal(added.status, 201)
    assert.match(added.json.player.playerID, CLUB_PLAYER_ID)
    assert.equal((await addPlayer(ctx, owner.accessToken, owner.clubId, 'тигр')).status, 409)
    const byJudge = await addPlayer(ctx, judge.accessToken, owner.clubId, 'Ворон')
    assert.equal(byJudge.status, 403)
    assert.equal(byJudge.json.error.code, 'owner_only')

    const list = await call(ctx, 'GET', `/v1/clubs/${owner.clubId}/players`, { token: judge.accessToken })
    assert.equal(list.status, 200)
    assert.deepEqual(list.json.players.map((p: any) => [p.nickname, p.source, p.photoURL]), [['Тигр', 'club', null]])

    const id = added.json.player.playerID
    const renamed = await call(ctx, 'PATCH', `/v1/clubs/${owner.clubId}/players/${id}`, { token: owner.accessToken, body: { nickname: 'Тигрица' } })
    assert.equal(renamed.json.player.nickname, 'Тигрица')
    assert.equal((await call(ctx, 'DELETE', `/v1/clubs/${owner.clubId}/players/${id}`, { token: owner.accessToken })).status, 200)
    const after = await call(ctx, 'GET', `/v1/clubs/${owner.clubId}/players`, { token: owner.accessToken })
    assert.deepEqual(after.json.players, [])
  })

  it('идут в рейтинг клуба; игрок другого клуба — нет; убранный после начала игры — да', async () => {
    const ctx = createTestContext()
    const owner = await ownerWithClub(ctx)
    const judge = await judgeOf(ctx, owner.accessToken, owner.clubId)
    const ids: string[] = []
    for (let i = 0; i < 9; i++) ids.push((await addPlayer(ctx, owner.accessToken, owner.clubId, `Игрок ${i + 1}`)).json.player.playerID)
    const seats = [...ids, goMafiaPlayerID(7001)]
    const judgeId = (await call(ctx, 'GET', '/v1/me', { token: judge.accessToken })).json.id

    const ok = await call(ctx, 'POST', '/v1/games', { token: judge.accessToken, body: ratingGame(judgeId, owner.clubId, seats) })
    assert.equal(ok.status, 201)

    const foreign = '6d616662-6370-8000-8000-0000000000ff'
    const bad = await call(ctx, 'POST', '/v1/games', {
      token: judge.accessToken,
      body: ratingGame(judgeId, owner.clubId, [foreign, ...seats.slice(1)], 'C1B2C3D4-0000-4000-8000-000000000c02'),
    })
    assert.equal(bad.status, 422)
    assert.equal(bad.json.error.code, 'guest_players')

    await call(ctx, 'DELETE', `/v1/clubs/${owner.clubId}/players/${ids[0]}`, { token: owner.accessToken })
    const late = await call(ctx, 'POST', '/v1/games', {
      token: judge.accessToken, body: ratingGame(judgeId, owner.clubId, seats, 'C1B2C3D4-0000-4000-8000-000000000c03'),
    })
    assert.equal(late.status, 201)
  })
})

describe('Фото игроков в MafBoard', () => {
  it('судья ставит фото — оно главнее остальных и у каждого нового фото свой адрес; не картинка — 422; посторонний — 403', async () => {
    const ctx = createTestContext()
    const owner = await ownerWithClub(ctx)
    const judge = await judgeOf(ctx, owner.accessToken, owner.clubId)
    const id = (await addPlayer(ctx, owner.accessToken, owner.clubId, 'Тигр')).json.player.playerID

    const first = await putPhoto(ctx, judge.accessToken, owner.clubId, id)
    assert.equal(first.status, 200)
    const second = await putPhoto(ctx, judge.accessToken, owner.clubId, id)
    assert.notEqual(second.json.photoURL, first.json.photoURL)
    const list = await call(ctx, 'GET', `/v1/clubs/${owner.clubId}/players`, { token: owner.accessToken })
    assert.equal(list.json.players[0].photoURL, second.json.photoURL)

    // Фото можно поставить и игроку GoMafia: его состав внешний, номер проверяется только по виду.
    assert.equal((await putPhoto(ctx, judge.accessToken, owner.clubId, goMafiaPlayerID(7001))).status, 200)

    const notImage = await putPhoto(ctx, judge.accessToken, owner.clubId, id, Buffer.from('<svg onload="x">'))
    assert.equal(notImage.status, 422)
    assert.equal(notImage.json.error.code, 'invalid_photo')
    const unknown = await putPhoto(ctx, judge.accessToken, owner.clubId, '6d616662-6370-8000-8000-0000000000ff')
    assert.equal(unknown.status, 404)
    const stranger = await signIn(ctx, STRANGER_TG)
    assert.equal((await putPhoto(ctx, stranger.accessToken, owner.clubId, id)).status, 403)

    await call(ctx, 'DELETE', `/v1/clubs/${owner.clubId}/players/${id}/photo`, { token: judge.accessToken })
    const cleared = await call(ctx, 'GET', `/v1/clubs/${owner.clubId}/players`, { token: owner.accessToken })
    assert.equal(cleared.json.players[0].photoURL, null)
  })

  it('ссылка игрока: одноразовая, игрок присылает фото в бота — оно становится фото игрока в клубе', async () => {
    const ctx = createTestContext()
    const owner = await ownerWithClub(ctx)
    const judge = await judgeOf(ctx, owner.accessToken, owner.clubId)
    const id = (await addPlayer(ctx, owner.accessToken, owner.clubId, 'Тигр')).json.player.playerID

    const link = await call(ctx, 'POST', `/v1/clubs/${owner.clubId}/players/${id}/link`, { token: judge.accessToken })
    assert.equal(link.status, 201)
    const url = new URL(link.json.url)
    assert.equal(url.host, 't.me')
    assert.equal(url.pathname, '/mafboard_test_bot')
    const start = url.searchParams.get('start')!
    assert.match(start, /^p_[A-Za-z0-9_-]{32}$/)

    // Фото до привязки не принимается.
    await handleBotUpdate(message(PLAYER_TG, { photo: [{ file_id: 'f1', width: 800, height: 800 }] }) as any, bot(ctx))
    assert.ok(ctx.messenger.last?.text.includes('ссылку'))

    await handleBotUpdate(message(PLAYER_TG, { text: `/start ${start}` }) as any, bot(ctx))
    assert.ok(ctx.messenger.last?.text.includes('игрок «Тигр»'))
    await handleBotUpdate(message(STRANGER_TG, { text: `/start ${start}` }) as any, bot(ctx))
    assert.ok(ctx.messenger.last?.text.includes('уже использована'))

    ctx.messenger.files.set('big', Buffer.concat([JPEG_BYTES, Buffer.alloc(10)]))
    await handleBotUpdate(message(PLAYER_TG, {
      photo: [{ file_id: 'small', width: 90, height: 90 }, { file_id: 'big', width: 1280, height: 960 }, { file_id: 'huge', width: 2560, height: 1920 }],
    }) as any, bot(ctx))
    assert.ok(ctx.messenger.last?.text.includes('Фото обновлено'))
    const list = await call(ctx, 'GET', `/v1/clubs/${owner.clubId}/players`, { token: owner.accessToken })
    assert.equal(list.json.players[0].photoURL, `https://media.mafboard.test/photo-${ctx.images.stored.length}.jpg`)
    assert.equal(ctx.repo.photos[0]?.setByTg, PLAYER_TG.id)

    // Новую ссылку на того же игрока открыл другой Telegram — прежний узнаёт об этом.
    const second = await call(ctx, 'POST', `/v1/clubs/${owner.clubId}/players/${id}/link`, { token: judge.accessToken })
    await handleBotUpdate(message(STRANGER_TG, { text: `/start ${new URL(second.json.url).searchParams.get('start')}` }) as any, bot(ctx))
    assert.ok(ctx.messenger.sent.some((sent) => sent.chatId === PLAYER_TG.id && sent.text.includes('открыл другой аккаунт')))

    // Убранный в архив игрок фото из бота больше не получает.
    await call(ctx, 'DELETE', `/v1/clubs/${owner.clubId}/players/${id}`, { token: owner.accessToken })
    const before = ctx.repo.photos.length
    ctx.messenger.files.set('later', JPEG_BYTES)
    await handleBotUpdate(message(STRANGER_TG, { photo: [{ file_id: 'later', width: 800, height: 800 }] }) as any, bot(ctx))
    assert.ok(ctx.messenger.last?.text.includes('ссылку'))
    assert.equal(ctx.repo.photos.length, before)
  })

  it('Titan HUB по клубу из адреса: состав и сопоставление клиента; у клуба без Titan — 409', async () => {
    const ctx = createTestContext()
    const client = '00000000-0000-4000-8000-00000000000a'
    ctx.titan.members = [titanClient(client, 'Тигр', { isResident: true })]
    const session = await signIn(ctx, OWNER_TG)
    const created = await call(ctx, 'POST', '/v1/clubs', { token: session.accessToken, body: { code: 'good-code' } })
    const clubId = created.json.club.id
    const roster = await call(ctx, 'GET', `/v1/clubs/${clubId}/titan/players`, { token: session.accessToken })
    assert.equal(roster.status, 200)
    assert.deepEqual(roster.json.players.map((p: any) => p.nickname), ['Тигр'])
    const matched = await call(ctx, 'PUT', `/v1/clubs/${clubId}/titan/players/${client}/gomafia`, { token: session.accessToken, body: { goMafiaID: null } })
    assert.equal(matched.status, 200)
    assert.equal(matched.json.goMafiaID, null)
    assert.equal(ctx.repo.titanMatchRows.size, 1)
    const stranger = await signIn(ctx, STRANGER_TG)
    assert.equal((await call(ctx, 'GET', `/v1/clubs/${clubId}/titan/players`, { token: stranger.accessToken })).status, 403)

    const plain = createTestContext()
    const owner = await ownerWithClub(plain)
    const none = await call(plain, 'GET', `/v1/clubs/${owner.clubId}/titan/players`, { token: owner.accessToken })
    assert.equal(none.status, 409)
    assert.equal(none.json.error.code, 'titan_not_linked')
  })

  it('из размеров Telegram берётся самый большой не шире 1280', () => {
    assert.equal(pickPhotoSize([{ file_id: 'a', width: 90 }, { file_id: 'b', width: 1280 }, { file_id: 'c', width: 2560 }])?.file_id, 'b')
    assert.equal(pickPhotoSize([{ file_id: 'c', width: 2560 }, { file_id: 'd', width: 1600 }])?.file_id, 'd')
    assert.equal(pickPhotoSize([]), null)
  })
})
