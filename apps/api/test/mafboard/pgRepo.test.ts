import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import type { MafboardRepo } from '../../src/modules/mafboard/repo.js'

// SQL входа по QR на настоящем Postgres. Остальные тесты модуля работают с MemoryRepo и SQL не видят.
// Без MAFBOARD_TEST_DATABASE_URL (адрес пустой базы) тест пропускается; DATABASE_URL задать тем же адресом.
// Запускать из скомпилированного кода: tsx на Node 25 не видит именованные экспорты @titan/database.
//   npx tsc -p tsconfig.test.json --noEmit false --outDir .pgtest && node --test .pgtest/test/mafboard/pgRepo.test.js
const url = process.env['MAFBOARD_TEST_DATABASE_URL']

const NOW = new Date('2026-11-05T12:00:00.000Z')
const SOON = new Date(NOW.getTime() + 3 * 60_000)
const HASH = 'a'.repeat(64)

// Соединения закрываются один раз на файл: закрытый пул `getClubDb` отдаёт следующему блоку как живой.
after(async () => {
  if (!url) return
  const database = await import('@titan/database')
  await database.closeClubDbs()
  await database.closeDb()
})

describe('PgMafboardRepo: билеты QR', { skip: url ? false : 'нет MAFBOARD_TEST_DATABASE_URL' }, () => {
  let repo: MafboardRepo
  let userId: string
  let sequence = 0

  const newTicket = async (overrides: { expiresAt?: Date; platform?: string } = {}) => {
    sequence += 1
    return repo.createQrTicket({
      scanCode: `scan-code-${String(sequence).padStart(14, '0')}`,
      confirmCode: '42',
      choiceCodes: [17, 42, 88],
      deviceSecretHash: HASH,
      deviceName: 'MacBook',
      platform: overrides.platform ?? 'macos',
      expiresAt: overrides.expiresAt ?? SOON,
    })
  }

  before(async () => {
    const database = await import('@titan/database')
    const { runMafboardMigrations } = await import('../../src/modules/mafboard/migrations.js')
    const { PgMafboardRepo } = await import('../../src/modules/mafboard/pgRepo.js')
    const db = database.getClubDb(url)
    await runMafboardMigrations(db)
    // Повторный запуск ничего не меняет: так проходит каждый рестарт сервера.
    await runMafboardMigrations(db)
    repo = new PgMafboardRepo(db)
    const user = await repo.upsertUserFromTelegram({
      tgId: 777, tgUsername: 'kai', tgFirstName: 'Кай', tgLastName: null, phone: '+79160000000', termsVersion: '1',
    })
    userId = user.id
  })

  it('создаёт билет и находит его по номеру и по коду из QR', async () => {
    const ticket = await newTicket()
    assert.equal(ticket.status, 'pending')
    assert.equal(ticket.userId, null)
    assert.deepEqual(ticket.choiceCodes, [17, 42, 88])
    assert.equal(ticket.expiresAt.toISOString(), SOON.toISOString())
    assert.deepEqual(await repo.qrTicketById(ticket.id), ticket)
    assert.deepEqual(await repo.qrTicketByScan(ticket.scanCode), ticket)
    assert.equal(await repo.qrTicketById('not-a-uuid'), null)
    assert.equal(await repo.qrTicketByScan('no-such-code'), null)
  })

  it('верный код подтверждает билет и записывает пользователя, второго решения нет', async () => {
    const ticket = await newTicket()
    const decided = await repo.decideQrTicket(ticket.scanCode, '42', userId, NOW)
    assert.equal(decided?.status, 'confirmed')
    assert.equal(decided?.userId, userId)
    assert.equal(await repo.decideQrTicket(ticket.scanCode, '42', userId, NOW), null)
  })

  it('неверный код отклоняет билет и пользователя не записывает', async () => {
    const ticket = await newTicket()
    const decided = await repo.decideQrTicket(ticket.scanCode, '17', userId, NOW)
    assert.equal(decided?.status, 'rejected')
    assert.equal(decided?.userId, null)
    assert.equal(await repo.decideQrTicket(ticket.scanCode, '42', userId, NOW), null)
  })

  it('истёкший билет не решается', async () => {
    const ticket = await newTicket({ expiresAt: new Date(NOW.getTime() - 1) })
    assert.equal(await repo.decideQrTicket(ticket.scanCode, '42', userId, NOW), null)
    assert.equal((await repo.qrTicketById(ticket.id))?.status, 'pending')
  })

  it('обмен: только подтверждённый, не истёкший и с верным секретом, один раз', async () => {
    const pending = await newTicket()
    assert.equal(await repo.claimQrTicket(pending.id, HASH, NOW), null)

    const ticket = await newTicket()
    await repo.decideQrTicket(ticket.scanCode, '42', userId, NOW)
    assert.equal(await repo.claimQrTicket(ticket.id, 'b'.repeat(64), NOW), null)
    assert.equal(await repo.claimQrTicket(ticket.id, HASH, SOON), null)
    const claimed = await repo.claimQrTicket(ticket.id, HASH, NOW)
    assert.equal(claimed?.status, 'claimed')
    assert.equal(claimed?.userId, userId)
    assert.equal(await repo.claimQrTicket(ticket.id, HASH, NOW), null)
  })

  it('телефонная платформа не проходит ограничение таблицы', async () => {
    await assert.rejects(newTicket({ platform: 'ios' }))
  })

  it('refreshToken отдаёт платформу сессии: от неё зависит отзыв при позднем повторе', async () => {
    const laptop = await repo.createSession({
      userId, deviceName: 'MacBook', platform: 'macos', refreshTokenHash: 'laptop-token', at: NOW, expiresAt: SOON,
    })
    const phone = await repo.createSession({
      userId, deviceName: 'iPhone', platform: 'ios', refreshTokenHash: 'phone-token', at: NOW, expiresAt: SOON,
    })
    assert.equal((await repo.refreshToken('laptop-token'))?.sessionPlatform, 'macos')
    assert.equal((await repo.refreshToken('phone-token'))?.sessionPlatform, 'ios')

    assert.equal(await repo.revokeSession(userId, laptop.id, NOW), true)
    assert.ok((await repo.refreshToken('laptop-token'))?.sessionRevokedAt)
    assert.equal((await repo.refreshToken('phone-token'))?.sessionRevokedAt, null)
    assert.equal((await repo.sessionById(phone.id))?.revokedAt, null)
  })

  it('чистка считает и удаляет истёкшие билеты QR, живые оставляет', async () => {
    const stale = await newTicket({ expiresAt: new Date(NOW.getTime() - 60_000) })
    const live = await newTicket({ expiresAt: new Date(NOW.getTime() + 24 * 60 * 60_000) })
    const removed = await repo.purgeExpired(NOW)
    assert.ok(removed.tickets >= 1)
    assert.equal(await repo.qrTicketById(stale.id), null)
    assert.ok(await repo.qrTicketById(live.id))
  })

  it('удаление аккаунта уносит подтверждённые им билеты', async () => {
    const owner = await repo.upsertUserFromTelegram({
      tgId: 778, tgUsername: null, tgFirstName: 'Лис', tgLastName: null, phone: '+79160000001', termsVersion: '1',
    })
    const ticket = await newTicket()
    await repo.decideQrTicket(ticket.scanCode, '42', owner.id, NOW)
    assert.equal(await repo.deleteUser(owner.id), true)
    assert.equal(await repo.qrTicketById(ticket.id), null)
  })

  // ─── Пул судей клуба ───────────────────────────────────────────────────────

  const gmPlayer = (id: number, nickname: string) => ({
    id, nickname, fullName: null, avatarURL: null, elo: null, clubID: 40, clubTitle: 'TITAN', city: null,
    tournamentsPlayed: null, isInHostClub: false, isVerified: false,
  })
  const club = { id: 40, title: 'TITAN', city: 'Нальчик', presidentID: 112 }

  it('способ подтверждения GoMafia: по умолчанию пароль, обновление профиля его не меняет', async () => {
    const linked = await repo.setGomafiaLink(userId, { player: gmPlayer(112, 'Kai'), club }, NOW)
    assert.equal(linked?.gomafia?.source, 'password')
    assert.equal(linked?.gomafia?.club?.presidentID, 112)

    const judge = await repo.upsertUserFromTelegram({
      tgId: 779, tgUsername: 'diana', tgFirstName: 'Диана', tgLastName: null, phone: '+79160000002', termsVersion: '1',
    })
    const byClub = await repo.setGomafiaLink(judge.id, { player: gmPlayer(984, 'Altman'), club, source: 'club' }, NOW)
    assert.equal(byClub?.gomafia?.source, 'club')
    const refreshed = await repo.setGomafiaLink(judge.id, { player: gmPlayer(984, 'Altman'), club }, SOON)
    assert.equal(refreshed?.gomafia?.source, 'club')
    assert.equal(refreshed?.gomafia?.linkedAt.toISOString(), NOW.toISOString())
    const byPassword = await repo.setGomafiaLink(judge.id, { player: gmPlayer(984, 'Altman'), club, source: 'password' }, SOON)
    assert.equal(byPassword?.gomafia?.source, 'password')

    assert.deepEqual((await repo.clubPresidents(10)).map((user) => user.id), [userId])
    assert.deepEqual((await repo.usersByGomafiaIds([984, 112, 5])).map((user) => user.gomafia?.player.id).sort(), [112, 984])
    assert.deepEqual(await repo.usersByGomafiaIds([]), [])
  })

  it('пул судей: добавление, повтор, удаление; удалённый президент не уносит пул', async () => {
    const boss = await repo.upsertUserFromTelegram({
      tgId: 780, tgUsername: null, tgFirstName: 'Босс', tgLastName: null, phone: '+79160000003', termsVersion: '1',
    })
    await repo.addClubHost({ clubId: 40, gomafiaId: 984, nickname: 'Altman', grantedBy: boss.id, grantedAt: NOW })
    await repo.addClubHost({ clubId: 40, gomafiaId: 114, nickname: 'Минахор', grantedBy: null, grantedAt: SOON })
    await repo.addClubHost({ clubId: 40, gomafiaId: 984, nickname: 'Altman2', grantedBy: null, grantedAt: SOON })

    assert.deepEqual(await repo.clubHosts(40), [
      { clubId: 40, gomafiaId: 984, nickname: 'Altman2', grantedBy: boss.id, grantedAt: NOW },
      { clubId: 40, gomafiaId: 114, nickname: 'Минахор', grantedBy: null, grantedAt: SOON },
    ])
    assert.deepEqual(await repo.clubHosts(41), [])
    assert.equal(await repo.isClubHost(40, 984), true)
    assert.equal(await repo.isClubHost(41, 984), false)

    assert.equal(await repo.deleteUser(boss.id), true)
    assert.equal((await repo.clubHosts(40))[0]?.grantedBy, null)
    assert.equal(await repo.removeClubHost(40, 984), true)
    assert.equal(await repo.removeClubHost(40, 984), false)
    assert.equal(await repo.isClubHost(40, 984), false)
  })

  it('заявки без пароля: одна на пользователя, поиск по нику без регистра, уходят вместе с аккаунтом', async () => {
    const judge = await repo.upsertUserFromTelegram({
      tgId: 781, tgUsername: null, tgFirstName: 'Судья', tgLastName: null, phone: '+79160000004', termsVersion: '1',
    })
    assert.equal(await repo.clubRequest(judge.id), null)
    await repo.setClubRequest(judge.id, { nickname: 'Шерлок', at: NOW })
    await repo.setClubRequest(judge.id, { nickname: 'Минахор', at: SOON })
    assert.deepEqual(await repo.clubRequest(judge.id), { userId: judge.id, nickname: 'Минахор', createdAt: SOON })

    assert.deepEqual((await repo.clubRequestsByNicknames(['kai', ' МИНАХОР '])).map((request) => request.userId), [judge.id])
    assert.deepEqual(await repo.clubRequestsByNicknames(['Шерлок']), [])
    assert.deepEqual(await repo.clubRequestsByNicknames([]), [])

    await repo.setClubRequest(judge.id, null)
    assert.equal(await repo.clubRequest(judge.id), null)
    await repo.setClubRequest(judge.id, { nickname: 'Минахор', at: NOW })
    assert.equal(await repo.deleteUser(judge.id), true)
    assert.deepEqual(await repo.clubRequestsByNicknames(['минахор']), [])
    assert.equal(await repo.clubRequest('not-a-uuid'), null)
  })
})

// Клубы MafBoard (миграция 012): сверка поверх данных, записанных до неё, и SQL хранилища.
describe('PgMafboardRepo: клубы', { skip: url ? false : 'нет MAFBOARD_TEST_DATABASE_URL' }, () => {
  let repo: MafboardRepo
  let exec: (statement: string) => Promise<Record<string, unknown>[]>
  let migrate: () => Promise<void>
  let reconcile: () => Promise<void>
  let tgId = 800

  const player = (id: number, clubID: number) => ({
    id, nickname: `игрок-${id}`, fullName: null, avatarURL: null, elo: null, clubID, clubTitle: null, city: null,
    tournamentsPlayed: null, isInHostClub: false, isVerified: false,
  })
  // Один клуб Titan HUB — один клуб MafBoard (уникальный apiBase): у каждого подключения свой адрес.
  const titan = (connectionId: string) => ({
    apiBase: `https://${connectionId}.titanpos.test/api/connect/v1`, clubName: 'TITAN', connectionId, scopes: ['clients:read'],
    tokenSealed: `sealed-${connectionId}`, linkedAt: NOW,
  })
  const newUser = async () => {
    tgId += 1
    return repo.upsertUserFromTelegram({ tgId, tgUsername: null, tgFirstName: 'Клуб', tgLastName: null, phone: `+7916${tgId}0000`, termsVersion: '1' })
  }
  const jsonb = (value: unknown) => (value == null ? 'NULL' : `'${JSON.stringify(value)}'::jsonb`)
  const text = (value: string | null) => (value == null ? 'NULL' : `'${value}'`)

  /** Привязка, записанная прежним кодом: мимо `setGomafiaLink`, запись клуба не заводится. */
  const legacyUser = async (input: { gomafiaId: number; club: unknown; source?: string | null; titanLink?: unknown; syncedAt?: Date }) => {
    const user = await newUser()
    await exec(`
      UPDATE mb_users SET gomafia_id = ${input.gomafiaId}, gomafia_player = ${jsonb(player(input.gomafiaId, 0))},
        gomafia_club = ${jsonb(input.club)}, gomafia_link_source = ${text(input.source ?? null)},
        gomafia_linked_at = '${NOW.toISOString()}', gomafia_synced_at = '${(input.syncedAt ?? NOW).toISOString()}',
        titan_link = ${jsonb(input.titanLink ?? null)}
      WHERE id = '${user.id}'
    `)
    return user
  }
  const legacyGame = async (id: string, clubId: number | null) => {
    await exec(`
      INSERT INTO mb_games (id, host_user_id, club_id, format, variant, started_at, finished_at, schema_version, record)
      VALUES ('${id}', NULL, ${clubId ?? 'NULL'}, 'rating', 'sport', '${NOW.toISOString()}', '${SOON.toISOString()}', 1, '{}'::jsonb)
    `)
  }
  const clubRef = async (gameId: string) => (await exec(`SELECT club_ref FROM mb_games WHERE id = '${gameId}'`))[0]?.['club_ref'] ?? null
  const clubsState = () => exec('SELECT id, name, city, gomafia_club_id, titan_link, titan_linked_by, updated_at FROM mb_clubs ORDER BY gomafia_club_id')

  before(async () => {
    const database = await import('@titan/database')
    const { reconcileMafboardClubs, runMafboardMigrations } = await import('../../src/modules/mafboard/migrations.js')
    const { PgMafboardRepo } = await import('../../src/modules/mafboard/pgRepo.js')
    const db = database.getClubDb(url)
    await runMafboardMigrations(db)
    repo = new PgMafboardRepo(db)
    exec = async (statement) => {
      const result: unknown = await db.execute(database.sql.raw(statement))
      return (Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? [])) as Record<string, unknown>[]
    }
    migrate = () => runMafboardMigrations(db)
    reconcile = () => reconcileMafboardClubs(db)
  })

  it('сверка поверх данных до миграции 012: клубы и ссылки игр, Titan не трогает; повтор ничего не меняет', async () => {
    // Президент с личной записью о Titan: клуб заводится, но подключение в него само не переезжает.
    await legacyUser({ gomafiaId: 201, club: { id: 61, title: 'Альфа', city: 'Казань', presidentID: 201 }, titanLink: titan('conn-61') })
    // Снимок без президента (страница клуба тогда не открылась): клуб заводится с его названием.
    await legacyUser({ gomafiaId: 202, club: { id: 62, title: 'Бета', city: null }, titanLink: titan('conn-62') })
    // Два снимка одного клуба: название берётся из более свежего.
    await legacyUser({ gomafiaId: 203, club: { id: 63, title: 'Гамма', city: 'Уфа', presidentID: 203 }, titanLink: titan('conn-63-old') })
    await legacyUser({ gomafiaId: 204, club: { id: 63, title: 'Гамма Новая', city: 'Уфа', presidentID: 204 }, syncedAt: SOON })
    await legacyUser({ gomafiaId: 205, club: { id: 64, title: 'Дельта', city: null, presidentID: 205 }, source: 'club', titanLink: titan('conn-64') })
    // Кривые снимки миграцию не роняют и клубов не заводят.
    await legacyUser({ gomafiaId: 206, club: { id: 'abc', title: 'Кривой' } })
    await legacyUser({ gomafiaId: 207, club: 'строка' })
    // Клуб известен только по пулу судей и только по игре.
    await exec(`INSERT INTO mb_club_hosts (club_id, gomafia_id, nickname, granted_at) VALUES (65, 301, 'судья', '${NOW.toISOString()}')`)
    await legacyGame('00000000-0000-4000-8000-000000000661', 66)
    await legacyGame('00000000-0000-4000-8000-000000000611', 61)
    await legacyGame('00000000-0000-4000-8000-000000000600', null)

    // Состояние сразу после миграции 012: схема есть, записей клубов и ссылок ещё нет.
    await exec('UPDATE mb_games SET club_ref = NULL')
    assert.equal((await exec('SELECT 1 AS found FROM mb_clubs WHERE gomafia_club_id BETWEEN 61 AND 66')).length, 0)
    await reconcile()

    const byId = async (id: number) => repo.clubByGomafiaId(id)
    const club61 = await byId(61)
    assert.deepEqual({ name: club61?.name, city: club61?.city }, { name: 'Альфа', city: 'Казань' })
    assert.equal(club61?.titan, null)
    assert.equal(club61?.titanLinkedBy, null)

    const club62 = await byId(62)
    assert.equal(club62?.name, 'Бета')
    assert.equal(club62?.titan, null)

    const club63 = await byId(63)
    assert.equal(club63?.name, 'Гамма Новая')
    assert.equal(club63?.titan, null)

    assert.equal((await byId(64))?.titan, null)
    assert.equal((await byId(65))?.name, 'Клуб #65')
    assert.equal((await byId(66))?.name, 'Клуб #66')

    assert.equal(await clubRef('00000000-0000-4000-8000-000000000661'), (await byId(66))?.id)
    assert.equal(await clubRef('00000000-0000-4000-8000-000000000611'), club61?.id)
    assert.equal(await clubRef('00000000-0000-4000-8000-000000000600'), null)

    // Сверка при каждом старте: на сверенной базе не пишет ничего (updated_at тот же).
    const before = await clubsState()
    await reconcile()
    await migrate()
    assert.deepEqual(await clubsState(), before)
  })

  it('сверка дозаполняет клуб и ссылку игры, которые записал прежний код после отката', async () => {
    await legacyUser({ gomafiaId: 211, club: { id: 71, title: 'Эпсилон', city: null, presidentID: 211 }, titanLink: titan('conn-71') })
    await legacyGame('00000000-0000-4000-8000-000000000711', 71)
    assert.equal(await repo.clubByGomafiaId(71), null)

    await reconcile()
    const club = await repo.clubByGomafiaId(71)
    assert.equal(club?.name, 'Эпсилон')
    assert.equal(club?.titan, null)
    assert.equal(await clubRef('00000000-0000-4000-8000-000000000711'), club?.id)
  })

  it('привязка заводит клуб; неполный снимок название и город не затирает, полный — обновляет', async () => {
    const user = await newUser()
    await repo.setGomafiaLink(user.id, { player: player(221, 81), club: { id: 81, title: 'Клуб #81', city: null } }, NOW)
    assert.equal((await repo.clubByGomafiaId(81))?.name, 'Клуб #81')

    await repo.setGomafiaLink(user.id, { player: player(221, 81), club: { id: 81, title: 'Зета', city: 'Сочи', presidentID: 999 } }, NOW)
    await repo.setGomafiaLink(user.id, { player: player(221, 81), club: { id: 81, title: 'Клуб #81', city: null } }, NOW)
    const kept = await repo.clubByGomafiaId(81)
    assert.deepEqual({ name: kept?.name, city: kept?.city }, { name: 'Зета', city: 'Сочи' })

    // Полный снимок без города город не стирает; без изменений запись не трогается.
    const stamp = (await clubsState()).find((row) => row['gomafia_club_id'] === 81)?.['updated_at']
    await repo.setGomafiaLink(user.id, { player: player(221, 81), club: { id: 81, title: 'Зета', city: null, presidentID: 999 } }, NOW)
    assert.deepEqual((await clubsState()).find((row) => row['gomafia_club_id'] === 81)?.['updated_at'], stamp)
    await repo.setGomafiaLink(user.id, { player: player(221, 81), club: { id: 81, title: 'Зета Сочи', city: null, presidentID: 999 } }, NOW)
    const renamed = await repo.clubByGomafiaId(81)
    assert.deepEqual({ name: renamed?.name, city: renamed?.city }, { name: 'Зета Сочи', city: 'Сочи' })
    assert.equal(await repo.clubByGomafiaId(999_999), null)
  })

  it('личная запись президента в клуб сама не переезжает; удалился подключивший — подключение остаётся без него', async () => {
    const boss = await newUser()
    await repo.setTitanLink(boss.id, titan('conn-82'))
    await repo.setGomafiaLink(boss.id, { player: player(231, 82), club: { id: 82, title: 'Эта', city: null, presidentID: 231 } }, NOW)
    const club = (await repo.clubByGomafiaId(82))!
    assert.equal(club.titan, null)

    await repo.setClubTitanLink(club.id, titan('conn-82'), boss.id)
    assert.equal(await repo.deleteUser(boss.id), true)
    const orphan = await repo.clubByGomafiaId(82)
    assert.equal(orphan?.titan?.connectionId, 'conn-82')
    assert.equal(orphan?.titanLinkedBy, null)
  })

  it('подключение клуба: замена возвращает прежнее, поиск по подключившему и по номеру, копии стираются', async () => {
    const boss = await newUser()
    const former = await newUser()
    await repo.setGomafiaLink(boss.id, { player: player(241, 84), club: { id: 84, title: 'Йота', city: null, presidentID: 241 } }, NOW)
    const club = (await repo.clubByGomafiaId(84))!

    assert.equal(await repo.setClubTitanLink(club.id, titan('conn-a'), boss.id), null)
    assert.equal((await repo.setClubTitanLink(club.id, titan('conn-b'), boss.id))?.connectionId, 'conn-a')
    assert.equal((await repo.clubByGomafiaId(84))?.titanLinkedBy, boss.id)
    assert.equal(await repo.setClubTitanLink('not-a-uuid', titan('conn-x'), boss.id), null)
    assert.equal(await repo.setClubTitanLink('00000000-0000-4000-8000-00000000dead', titan('conn-x'), boss.id), null)

    assert.deepEqual((await repo.clubsLinkedBy(boss.id)).map((linked) => linked.id), [club.id])
    assert.deepEqual(await repo.clubsLinkedBy(former.id), [])
    assert.deepEqual(await repo.clubsLinkedBy('not-a-uuid'), [])
    assert.equal((await repo.clubByTitanConnection('conn-b'))?.id, club.id)
    assert.equal(await repo.clubByTitanConnection('conn-a'), null)

    // Копии подключения в личных записях стираются по номеру, чужие — остаются.
    await repo.setTitanLink(boss.id, titan('conn-b'))
    await repo.setTitanLink(former.id, titan('conn-b'))
    const bystander = await newUser()
    await repo.setTitanLink(bystander.id, titan('conn-other'))
    await repo.clearTitanMirrors('conn-b')
    assert.equal((await repo.userById(boss.id))?.titan, null)
    assert.equal((await repo.userById(former.id))?.titan, null)
    assert.equal((await repo.userById(bystander.id))?.titan?.connectionId, 'conn-other')
    assert.equal((await repo.clubByGomafiaId(84))?.titan?.connectionId, 'conn-b')

    assert.equal((await repo.setClubTitanLink(club.id, null, null))?.connectionId, 'conn-b')
    assert.equal((await repo.clubByGomafiaId(84))?.titanLinkedBy, null)
    assert.deepEqual(await repo.clubsLinkedBy(boss.id), [])
  })

  it('игра клуба получает ссылку на клуб, повторная загрузка её сохраняет, личная игра — без ссылки', async () => {
    const host = await newUser()
    await repo.setGomafiaLink(host.id, { player: player(251, 85), club: { id: 85, title: 'Каппа', city: null, presidentID: 251 } }, NOW)
    const club = (await repo.clubByGomafiaId(85))!
    const game = {
      id: '00000000-0000-4000-8000-000000000851', hostUserId: host.id, clubId: 85, format: 'rating', variant: 'sport',
      startedAt: NOW, finishedAt: SOON, schemaVersion: 1, record: { setup: { host: { userID: host.id } } },
    }
    assert.equal(await repo.insertGame(game), 'inserted')
    assert.equal(await repo.insertGame(game), 'exists')
    assert.deepEqual((await repo.gamesByClub(85, null, 10)).map((stored) => stored.clubRef), [club.id])

    // Ведущий переиграл конец игры уже не от клуба: ссылка уходит вместе с клубом.
    assert.equal(await repo.insertGame({ ...game, clubId: null }), 'exists')
    assert.equal(await clubRef(game.id), null)
    assert.equal(await repo.insertGame({ ...game, id: '00000000-0000-4000-8000-000000000852', clubId: null }), 'inserted')
    assert.equal(await clubRef('00000000-0000-4000-8000-000000000852'), null)
  })

  // ─── Клубы без GoMafia, члены и приглашения (миграция 013) ─────────────────

  it('клуб по Titan: владелец — член клуба; второй клуб на тот же HUB не создаётся', async () => {
    const boss = await newUser()
    const link = { ...titan('conn-club-91'), apiBase: 'https://club91.titanpos.test/api/connect/v1' }
    const club = await repo.createTitanClub({ name: 'Клуб 91', titan: link, ownerUserId: boss.id, at: NOW })
    assert.notEqual(club, 'exists')
    if (club === 'exists') return
    assert.equal(club.ownerUserId, boss.id)
    assert.equal(club.gomafiaClubId, null)
    assert.deepEqual((await repo.membershipsOf(boss.id)).map((m) => [m.clubId, m.role]), [[club.id, 'owner']])
    assert.equal((await repo.clubById(club.id))?.titan?.connectionId, 'conn-club-91')

    const other = await newUser()
    assert.equal(await repo.createTitanClub({ name: 'Дубль', titan: { ...link, connectionId: 'conn-club-91b' }, ownerUserId: other.id, at: NOW }), 'exists')
    assert.deepEqual(await repo.membershipsOf(other.id), [])
  })

  it('члены клуба: добавление без повтора, удаление, уходят вместе с аккаунтом', async () => {
    const boss = await newUser()
    const club = await repo.createTitanClub({ name: 'Клуб 92', titan: { ...titan('conn-92'), apiBase: 'https://club92.titanpos.test/api/connect/v1' }, ownerUserId: boss.id, at: NOW })
    if (club === 'exists') throw new Error('клуб не создан')
    const judge = await newUser()
    await repo.addClubMember({ clubId: club.id, userId: judge.id, role: 'judge', addedBy: boss.id, addedAt: SOON })
    await repo.addClubMember({ clubId: club.id, userId: judge.id, role: 'owner', addedBy: null, addedAt: SOON })
    assert.deepEqual((await repo.clubMembers(club.id)).map((m) => m.role), ['owner', 'judge'])
    assert.equal(await repo.removeClubMember(club.id, judge.id), true)
    assert.equal(await repo.removeClubMember(club.id, judge.id), false)
    await repo.addClubMember({ clubId: club.id, userId: judge.id, role: 'judge', addedBy: boss.id, addedAt: SOON })
    assert.equal(await repo.deleteUser(judge.id), true)
    assert.deepEqual((await repo.clubMembers(club.id)).map((m) => m.userId), [boss.id])
  })

  it('приглашения: поиск по хэшу, отзыв, истёкшие не в списке', async () => {
    const boss = await newUser()
    const club = await repo.createTitanClub({ name: 'Клуб 93', titan: { ...titan('conn-93'), apiBase: 'https://club93.titanpos.test/api/connect/v1' }, ownerUserId: boss.id, at: NOW })
    if (club === 'exists') throw new Error('клуб не создан')
    const live = { id: '00000000-0000-4000-8000-0000000093a1', clubId: club.id, tokenHash: 'h'.repeat(64), createdBy: boss.id, createdAt: NOW, expiresAt: new Date(NOW.getTime() + 86_400_000), revokedAt: null }
    const old = { ...live, id: '00000000-0000-4000-8000-0000000093a2', tokenHash: 'o'.repeat(64), expiresAt: SOON }
    await repo.createClubInvite(live)
    await repo.createClubInvite(old)
    assert.deepEqual((await repo.clubInvites(club.id, new Date(SOON.getTime() + 1000))).map((i) => i.id), [live.id])
    assert.equal((await repo.clubInviteByTokenHash('h'.repeat(64)))?.id, live.id)
    assert.equal(await repo.revokeClubInvite(club.id, live.id, NOW), true)
    assert.equal(await repo.revokeClubInvite(club.id, live.id, NOW), false)
    assert.ok((await repo.clubInviteByTokenHash('h'.repeat(64)))?.revokedAt)
    assert.deepEqual(await repo.clubInvites(club.id, new Date(SOON.getTime() + 1000)), [])
  })

  it('игра клуба без GoMafia: ссылка на клуб из записи и история по ней', async () => {
    const boss = await newUser()
    const club = await repo.createTitanClub({ name: 'Клуб 94', titan: { ...titan('conn-94'), apiBase: 'https://club94.titanpos.test/api/connect/v1' }, ownerUserId: boss.id, at: NOW })
    if (club === 'exists') throw new Error('клуб не создан')
    const game = {
      id: '00000000-0000-4000-8000-000000000941', hostUserId: boss.id, clubId: null, clubRef: club.id, format: 'rating', variant: 'sport',
      startedAt: NOW, finishedAt: SOON, schemaVersion: 1, record: { setup: { host: { userID: boss.id } } },
    }
    assert.equal(await repo.insertGame(game), 'inserted')
    assert.deepEqual((await repo.gamesByClubRef(club.id, null, 10)).map((g) => g.id), [game.id])
    assert.deepEqual(await repo.gamesByClubRef(club.id, SOON, 10), [])
  })

  it('заявка на клуб: одна на рассмотрении; одобрение одной операцией создаёт клуб и владельца; повтор — null', async () => {
    const applicant = await newUser()
    const application = {
      id: '00000000-0000-4000-8000-000000000a51', userId: applicant.id, name: 'Клуб 95', city: 'Сочи',
      status: 'pending' as const, createdAt: NOW, decidedAt: null, clubId: null,
    }
    assert.equal((await repo.createClubApplication(application)) !== 'pending_exists', true)
    assert.equal(await repo.createClubApplication({ ...application, id: '00000000-0000-4000-8000-000000000a52' }), 'pending_exists')

    const [first, second] = await Promise.all([repo.approveClubApplication(application.id, SOON), repo.approveClubApplication(application.id, SOON)])
    const approved = first ?? second
    assert.ok(approved)
    assert.equal(first === null || second === null, true)
    assert.deepEqual(
      { name: approved.club.name, city: approved.club.city, owner: approved.club.ownerUserId, gomafia: approved.club.gomafiaClubId, titan: approved.club.titan },
      { name: 'Клуб 95', city: 'Сочи', owner: applicant.id, gomafia: null, titan: null },
    )
    assert.equal(approved.application.status, 'approved')
    assert.equal(approved.application.clubId, approved.club.id)
    assert.deepEqual((await repo.membershipsOf(applicant.id)).map((m) => [m.clubId, m.role]), [[approved.club.id, 'owner']])
    assert.equal(await repo.rejectClubApplication(application.id, SOON), null)
    assert.equal((await repo.latestClubApplication(applicant.id))?.status, 'approved')

    const next = { ...application, id: '00000000-0000-4000-8000-000000000a53', createdAt: SOON }
    assert.notEqual(await repo.createClubApplication(next), 'pending_exists')
    assert.equal((await repo.rejectClubApplication(next.id, SOON))?.status, 'rejected')
  })

  it('свои игроки, фото и ссылка игрока: ник без учёта регистра, архив, одноразовая привязка Telegram', async () => {
    const boss = await newUser()
    const club = await repo.createTitanClub({ name: 'Клуб 96', titan: { ...titan('conn-96'), apiBase: 'https://club96.titanpos.test/api/connect/v1' }, ownerUserId: boss.id, at: NOW })
    if (club === 'exists') throw new Error('клуб не создан')
    const tiger = { clubId: club.id, playerId: '6d616662-6370-8000-8000-000000000961', nickname: 'Тигр', createdBy: boss.id, createdAt: NOW, archivedAt: null }
    const raven = { ...tiger, playerId: '6d616662-6370-8000-8000-000000000962', nickname: 'Ворон' }
    assert.equal((await repo.addClubPlayer(tiger)) !== 'nickname_taken', true)
    assert.equal(await repo.addClubPlayer({ ...raven, nickname: 'ТИГР' }), 'nickname_taken')
    assert.notEqual(await repo.addClubPlayer(raven), 'nickname_taken')
    assert.equal(await repo.renameClubPlayer(club.id, raven.playerId, 'тигр'), 'nickname_taken')
    assert.equal((await repo.renameClubPlayer(club.id, raven.playerId, 'Ворона')) !== null, true)
    assert.equal(await repo.archiveClubPlayer(club.id, tiger.playerId, SOON), true)
    assert.equal(await repo.archiveClubPlayer(club.id, tiger.playerId, SOON), false)
    assert.deepEqual((await repo.clubPlayers(club.id, false)).map((p) => p.nickname), ['Ворона'])
    assert.deepEqual((await repo.clubPlayers(club.id, true)).map((p) => p.nickname), ['Ворона', 'Тигр'])
    // Ник убранного игрока снова свободен.
    assert.notEqual(await repo.addClubPlayer({ ...tiger, playerId: '6d616662-6370-8000-8000-000000000963' }), 'nickname_taken')

    await repo.setPlayerPhoto({ clubId: club.id, playerId: raven.playerId, url: 'https://media.test/1.jpg', setByUser: boss.id, setByTg: null, setAt: NOW })
    await repo.setPlayerPhoto({ clubId: club.id, playerId: raven.playerId, url: 'https://media.test/2.jpg', setByUser: null, setByTg: 96001, setAt: SOON })
    assert.deepEqual((await repo.playerPhotos(club.id)).map((p) => [p.url, p.setByTg, p.setByUser]), [['https://media.test/2.jpg', 96001, null]])
    assert.equal(await repo.clearPlayerPhoto(club.id, raven.playerId), true)
    assert.deepEqual(await repo.playerPhotos(club.id), [])

    const token = { tokenHash: 'p'.repeat(64), clubId: club.id, playerId: raven.playerId, createdBy: boss.id, createdAt: NOW, expiresAt: SOON, usedAt: null }
    await repo.createPlayerLinkToken(token)
    await repo.createPlayerLinkToken({ ...token, tokenHash: 'q'.repeat(64), playerId: tiger.playerId })
    assert.equal(await repo.usePlayerLinkToken('z'.repeat(64), 96001, NOW), null)
    assert.deepEqual(await repo.usePlayerLinkToken('p'.repeat(64), 96001, NOW), { clubId: club.id, playerId: raven.playerId, tgId: 96001, linkedAt: NOW })
    assert.equal(await repo.usePlayerLinkToken('p'.repeat(64), 96002, NOW), 'expired')
    // Тот же Telegram по другой ссылке того же клуба — прежняя привязка снимается.
    assert.equal((await repo.usePlayerLinkToken('q'.repeat(64), 96001, NOW)) !== null, true)
    assert.deepEqual((await repo.playerLinksByTg(96001)).map((l) => l.playerId), [tiger.playerId])
  })
})
