import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { CommandSchema, DeviceStateSchema, adsVersion, commandSignal, qrBits, signalFor } from '../../src/modules/screens/launcher-protocol.js'

const SCREEN = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b'
const OTHER = '0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d'

describe('пульт ТВ в кабинке', () => {
  it('ТВ получает команды своему экрану и общие сигналы', () => {
    const own = JSON.stringify(commandSignal(SCREEN, { action: 'home' }))
    assert.equal(signalFor(SCREEN, own)?.type, 'command')
    assert.equal(signalFor(OTHER, own), null)
    assert.equal(signalFor(OTHER, JSON.stringify({ type: 'content', screenId: '*' }))?.type, 'content')
  })

  it('битое или чужое сообщение канала пропускается', () => {
    assert.equal(signalFor(SCREEN, 'not json'), null)
    assert.equal(signalFor(SCREEN, JSON.stringify({ type: 'zone', screenId: SCREEN })), null)
  })

  it('у каждой команды свой id', () => {
    const a = commandSignal(SCREEN, { action: 'screensaver' })
    const b = commandSignal(SCREEN, { action: 'screensaver' })
    assert.ok(a.type === 'command' && b.type === 'command' && a.command.id !== b.command.id)
  })

  it('сообщение без текста не уходит, время по умолчанию 20 с', () => {
    assert.equal(CommandSchema.safeParse({ action: 'message', text: '   ' }).success, false)
    const parsed = CommandSchema.parse({ action: 'message', text: 'Через 10 минут время кабинки закончится' })
    assert.equal(parsed.action === 'message' && parsed.seconds, 20)
    assert.equal(CommandSchema.safeParse({ action: 'volume', percent: 101 }).success, false)
    assert.equal(CommandSchema.safeParse({ action: 'reboot' }).success, false)
  })

  it('длинные строки состояния обрезаются, а не роняют пульс', () => {
    const state = DeviceStateSchema.parse({
      screen: 'app',
      app: 'Я'.repeat(100),
      airplay: { title: ' Трек ', artist: 'А', client: 'iPhone', playing: true },
      volume: { level: 7, max: 15, muted: false },
      ha: 'connected',
    })
    assert.equal(state.app?.length, 60)
    assert.equal(state.airplay?.title, 'Трек')
    assert.equal(DeviceStateSchema.safeParse({ screen: 'desktop' }).success, false)
  })
})

describe('реклама для ТВ в кабинке', () => {
  it('QR приходит матрицей size×size', async () => {
    const qr = await qrBits('https://titanpos.ru/residents')
    assert.ok(qr)
    assert.equal(qr.bits.length, qr.size * qr.size)
    assert.match(qr.bits, /^[01]+$/)
    // Угловой «глаз» QR — тёмный модуль в левом верхнем углу.
    assert.equal(qr.bits[0], '1')
  })

  it('отпечаток меняется вместе с рекламой', () => {
    const ad = { kind: 'card' as const, imageUrl: null, title: 'My Titan', body: null, qr: null, durationSec: 10, fit: 'contain' }
    assert.equal(adsVersion([ad]), adsVersion([{ ...ad }]))
    assert.notEqual(adsVersion([ad]), adsVersion([{ ...ad, title: 'Instagram' }]))
    assert.notEqual(adsVersion([ad]), adsVersion([]))
  })
})
