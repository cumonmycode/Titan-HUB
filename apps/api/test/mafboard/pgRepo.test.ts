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

describe('PgMafboardRepo: билеты QR', { skip: url ? false : 'нет MAFBOARD_TEST_DATABASE_URL' }, () => {
  let repo: MafboardRepo
  let userId: string
  let closeAll: () => Promise<void>
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
    closeAll = async () => {
      await database.closeClubDbs()
      await database.closeDb()
    }
    const user = await repo.upsertUserFromTelegram({
      tgId: 777, tgUsername: 'kai', tgFirstName: 'Кай', tgLastName: null, phone: '+79160000000', termsVersion: '1',
    })
    userId = user.id
  })

  after(async () => {
    await closeAll?.()
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
})
