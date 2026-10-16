import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { signScopedJwt, verifyToken } from '@titan/auth'
import { databaseName, JWT_AUDIENCE, JWT_ISSUER, readMafboardConfig } from '../../src/modules/mafboard/config.js'
import { validateGameUpload } from '../../src/modules/mafboard/games.js'
import { RosterCache, searchForHost } from '../../src/modules/mafboard/gomafia.js'
import { maskPhone, normalizePhone, toPlayerJSON, toSessionsJSON, toTicketStatusJSON } from '../../src/modules/mafboard/serialize.js'
import { ipKey, sanitizeDeviceName } from '../../src/modules/mafboard/router.js'
import { decoyCodes, issueAccessToken, verifyAccessToken, webhookSecret, webhookSecretValid } from '../../src/modules/mafboard/tokens.js'
import type { DeviceSession, MafboardUser } from '../../src/modules/mafboard/types.js'
import { config, FakeGoMafia, gmPlayer, NOW } from './helpers.js'

describe('телефон', () => {
  it('приводит номер из Telegram к E.164 и маскирует его', () => {
    assert.equal(normalizePhone('79161234567'), '+79161234567')
    assert.equal(normalizePhone('8 (916) 123-45-67'), '+79161234567')
    assert.equal(normalizePhone('+44 7911 123456'), '+447911123456')
    assert.equal(normalizePhone('123'), null)
    assert.equal(maskPhone('+79161234567'), '+7 *** ***-45-67')
    assert.equal(maskPhone(null), null)
  })
})

describe('игрок GoMafia', () => {
  it('переводится в формат приложения: числовые id, абсолютный аватар, обязательный isInHostClub', () => {
    const player = toPlayerJSON(gmPlayer(5001, 'Шерлок'), true)
    assert.deepEqual(player, {
      id: 5001, nickname: 'Шерлок', fullName: null, avatarURL: 'https://gomafia.pro/avatars/5001.jpg',
      elo: 1500, clubID: 77, clubTitle: 'TITAN', city: 'Москва', tournamentsPlayed: 12, isInHostClub: true,
    })
    assert.equal(toPlayerJSON({ ...gmPlayer(1, 'x'), gomafiaId: 'abc' }, false), null)
    assert.equal(toPlayerJSON({ ...gmPlayer(1, 'x'), avatar: 'javascript:alert(1)' }, false)?.avatarURL, null)
  })

  it('поиск: сначала свой клуб, без повторов; состав клуба кэшируется', async () => {
    const gomafia = new FakeGoMafia()
    let now = 0
    const roster = new RosterCache(gomafia, () => now)
    const found = await searchForHost(gomafia, roster, 'шер', 77)
    assert.deepEqual(found.map((p) => [p.id, p.isInHostClub]), [[5001, true], [5002, false]])

    await searchForHost(gomafia, roster, 'шер', 77)
    assert.equal(gomafia.clubCalls, 1)
    now = 6 * 60_000
    await searchForHost(gomafia, roster, 'шер', 77)
    assert.equal(gomafia.clubCalls, 2)
  })
})

describe('токены', () => {
  it('токен MafBoard проверяется своим ключом и не проходит проверку Titan HUB', async () => {
    const { token, expiresAt } = await issueAccessToken({ userId: 'user-1', sessionId: 'session-1' }, config, NOW)
    assert.deepEqual(await verifyAccessToken(token, config), { userId: 'user-1', sessionId: 'session-1' })
    assert.equal(expiresAt.toISOString(), '2026-10-16T19:00:00.000Z')
    await assert.rejects(verifyToken(token))

    const otherKey = { jwtSecret: new TextEncoder().encode('another-secret-0123456789abcdefghij') }
    assert.equal(await verifyAccessToken(token, otherKey), null)
    assert.equal(await verifyAccessToken('garbage', config), null)
  })

  it('токен без сессии (выдан до появления сессий) не принимается', async () => {
    const legacy = await signScopedJwt({ sub: 'user-1', scope: 'mafboard' }, '1h', {
      secret: config.jwtSecret, issuer: JWT_ISSUER, audience: JWT_AUDIENCE,
    })
    assert.equal(await verifyAccessToken(legacy, config), null)
  })
})

describe('сессии', () => {
  it('текущая — первой, остальные по свежести; даты в ISO', () => {
    const session = (id: string, lastUsedAt: string): DeviceSession => ({
      id, userId: 'u', deviceName: 'iPhone', platform: 'ios', createdAt: NOW, lastUsedAt: new Date(lastUsedAt),
      expiresAt: new Date('2027-01-01T00:00:00.000Z'), revokedAt: null,
    })
    const json = toSessionsJSON(
      [session('old', '2026-10-10T00:00:00.000Z'), session('current', '2026-10-01T00:00:00.000Z'), session('fresh', '2026-10-16T15:00:00.000Z')],
      'current',
    )
    assert.deepEqual(json.map((s) => [s.id, s.isCurrent]), [['current', true], ['fresh', false], ['old', false]])
    assert.deepEqual(json[1], {
      id: 'fresh', deviceName: 'iPhone', platform: 'ios',
      createdAt: '2026-10-16T18:00:00.000Z', lastUsedAt: '2026-10-16T15:00:00.000Z', isCurrent: false,
    })
  })
})

describe('защита входа', () => {
  it('секрет вебхука выводится из ключа MafBoard и токена бота, а не из JWT_SECRET', () => {
    const secret = webhookSecret(config)
    assert.match(secret, /^[0-9a-f]{64}$/)
    assert.ok(webhookSecretValid(secret, config))
    assert.equal(webhookSecretValid(secret, { ...config, botToken: 'other-bot' }), false)
    assert.equal(webhookSecretValid(undefined, config), false)
    assert.equal(webhookSecretValid(secret, { ...config, botToken: null }), false)
  })

  it('ложные коды не совпадают с настоящим и между собой', () => {
    for (let i = 0; i < 200; i++) {
      const decoys = decoyCodes('42')
      assert.equal(decoys.length, 2)
      assert.ok(!decoys.includes('42'))
      assert.notEqual(decoys[0], decoys[1])
      assert.ok(decoys.every((c) => /^\d{2}$/.test(c)))
    }
  })

  it('имя устройства без ссылок, лимит по IPv6 — на подсеть /64', () => {
    assert.equal(sanitizeDeviceName('iPhone (Кай)'), 'iPhone (Кай)')
    assert.equal(sanitizeDeviceName('t.me/evil   bot'), 'tmeevil bot')
    assert.equal(sanitizeDeviceName('\u0000‮'), 'Устройство')
    assert.equal(ipKey('10.0.0.1'), '10.0.0.1')
    assert.equal(ipKey('2a02:6b8:a::1234:5678'), ipKey('2a02:6b8:a:0:ffff::1'))
  })
})

describe('конфигурация', () => {
  it('без БД и стойкого секрета модуль выключен', () => {
    assert.equal(readMafboardConfig({}).ok, false)
    assert.equal(readMafboardConfig({ MAFBOARD_DATABASE_URL: 'postgres://x/mafboard', MAFBOARD_JWT_SECRET: 'short' }).ok, false)
    const shared = 'shared-secret-0123456789abcdefghijklmnop'
    const sameAsTitan = readMafboardConfig({
      MAFBOARD_DATABASE_URL: 'postgres://x/mafboard', MAFBOARD_JWT_SECRET: shared, JWT_SECRET: shared,
      MAFBOARD_APP_LINK_BASE: 'https://mafboard.app',
    })
    assert.equal(sameAsTitan.ok, false)
    const ok = readMafboardConfig({
      MAFBOARD_DATABASE_URL: 'postgres://x/mafboard',
      MAFBOARD_JWT_SECRET: 'x'.repeat(40),
      MAFBOARD_APP_LINK_BASE: 'https://mafboard.app/',
      MAFBOARD_BOT_USERNAME: '@mafboard_bot',
    })
    assert.ok(ok.ok)
    assert.equal(ok.config.appLinkBase, 'https://mafboard.app')
    assert.equal(ok.config.botUsername, 'mafboard_bot')
    assert.equal(ok.config.termsUrl, 'https://mafboard.app/terms')
  })

  it('имя БД для CREATE DATABASE — только безопасные символы', () => {
    assert.equal(databaseName('postgresql://u:p@postgres:5432/mafboard'), 'mafboard')
    assert.throws(() => databaseName('postgresql://u:p@postgres:5432/maf";DROP'))
  })
})

describe('статус билета', () => {
  it('отдаёт состояние так, как его ждёт приложение', () => {
    const base = {
      id: 't', deepCode: 'c', confirmCode: '42', deviceSecretHash: 'h', deviceName: 'iPhone', platform: 'ios', step: 'created' as const,
      tgId: null, tgUsername: null, tgFirstName: null, tgLastName: null, phone: null, termsVersion: null,
      userId: null, openedAt: null, note: null, createdAt: NOW, expiresAt: new Date(NOW.getTime() + 60_000),
    }
    assert.deepEqual(toTicketStatusJSON({ ...base, status: 'pending' }, NOW), { status: 'pending', opened: false })
    assert.deepEqual(toTicketStatusJSON({ ...base, status: 'pending', openedAt: NOW }, NOW), { status: 'pending', opened: true })
    assert.deepEqual(toTicketStatusJSON({ ...base, status: 'confirmed' }, NOW), { status: 'confirmed' })
    assert.deepEqual(toTicketStatusJSON({ ...base, status: 'rejected', note: 'Это не я' }, NOW), { status: 'rejected', note: 'Это не я' })
    assert.deepEqual(toTicketStatusJSON({ ...base, status: 'claimed' }, NOW), { status: 'expired' })
    assert.deepEqual(toTicketStatusJSON({ ...base, status: 'pending' }, new Date(NOW.getTime() + 120_000)), { status: 'expired' })
  })
})

describe('приём игры', () => {
  const host: MafboardUser = {
    id: '00000000-0000-4000-8000-000000000001', tgId: 1, tgUsername: null, tgFirstName: 'Кай', tgLastName: null,
    phone: '+79161234567', termsVersion: '1',
    gomafia: {
      player: { id: 4242, nickname: 'Ведущий', fullName: null, avatarURL: null, elo: null, clubID: 77, clubTitle: 'TITAN', city: null, tournamentsPlayed: null, isInHostClub: false },
      club: { id: 77, title: 'TITAN', city: null },
      linkedAt: NOW,
      syncedAt: NOW,
    },
  }
  const guest = { ...host, gomafia: null }
  const goMafiaSeat = (n: number) => `6D616662-676D-8000-8000-${String(1000 + n).padStart(12, '0')}`

  function record(format: string, overrides: { clubID?: number | null; userID?: string; seats?: string[] } = {}) {
    return {
      schemaVersion: 1,
      setup: {
        gameID: 'A1B2C3D4-0000-4000-8000-000000000123',
        format,
        ruleset: { variant: 'sport' },
        host: { userID: overrides.userID ?? host.id.toUpperCase(), goMafiaPlayerID: 4242, clubID: overrides.clubID === undefined ? 77 : overrides.clubID },
        seats: (overrides.seats ?? Array.from({ length: 10 }, (_, i) => goMafiaSeat(i + 1))).map((playerID, i) => ({ seat: i + 1, playerID, role: 'civilian' })),
        createdAt: '2026-10-16T17:00:00.000Z',
      },
      finishedAt: '2026-10-16T17:55:00.000Z',
      outcome: { winner: 'red', reason: { allBlackEliminated: {} } },
      log: [],
      events: [],
    }
  }

  it('рейтинговая игра ведущего клуба попадает в историю клуба', () => {
    const result = validateGameUpload(record('rating'), host, NOW)
    assert.ok(result.ok)
    assert.equal(result.game.clubId, 77)
    assert.equal(result.game.id, 'a1b2c3d4-0000-4000-8000-000000000123')
  })

  it('фанка без GoMafia — личная история, с гостями можно', () => {
    const result = validateGameUpload(record('funky', { clubID: null, userID: guest.id, seats: Array.from({ length: 10 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`) }), guest, NOW)
    assert.ok(result.ok)
    assert.equal(result.game.clubId, null)
  })

  it('отклоняет чужую игру, рейтинг без клуба, чужой клуб и гостей в рейтинге', () => {
    const codes = [
      validateGameUpload(record('rating', { userID: '00000000-0000-4000-8000-000000000999' }), host, NOW),
      validateGameUpload(record('rating', { userID: guest.id }), guest, NOW),
      validateGameUpload(record('rating', { clubID: 12 }), host, NOW),
      validateGameUpload(record('rating', { seats: [goMafiaSeat(1), '00000000-0000-4000-8000-000000000002'] }), host, NOW),
      validateGameUpload({ ...record('rating'), schemaVersion: 2 }, host, NOW),
      validateGameUpload({ nonsense: true }, host, NOW),
    ].map((r) => (r.ok ? 'ok' : r.code))
    assert.deepEqual(codes, ['host_mismatch', 'club_required', 'club_mismatch', 'guest_players', 'unsupported_schema', 'invalid_record'])
  })
})
