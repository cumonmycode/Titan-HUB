import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { normalizeLinks, type StreamLink } from '../../src/modules/tg/streamLinks.js'

describe('площадки стрима', () => {
  it('оставляет только https и убирает повторы', () => {
    const links: StreamLink[] = [
      { kind: 'watch', label: 'VK', url: 'https://vk.com/titan' },
      { kind: 'watch', label: 'VK ещё раз', url: 'https://vk.com/titan' },
      { kind: 'watch', label: 'Без шифрования', url: 'http://example.com/live' },
      { kind: 'donate', label: '', url: 'https://www.donationalerts.com/r/titan' },
    ]
    assert.deepEqual(normalizeLinks(links), [
      { kind: 'watch', label: 'VK', url: 'https://vk.com/titan' },
      { kind: 'donate', label: 'Донат', url: 'https://www.donationalerts.com/r/titan' },
    ])
  })

  it('отбрасывает неизвестный вид ссылки из старых или чужих данных', () => {
    const raw = [{ kind: 'chat', label: 'Чат', url: 'https://t.me/titan' }] as unknown as StreamLink[]
    assert.deepEqual(normalizeLinks(raw), [])
  })

  it('не больше шести ссылок', () => {
    const many = Array.from({ length: 9 }, (_, i): StreamLink => ({ kind: 'watch', label: `П${i}`, url: `https://example.com/${i}` }))
    assert.equal(normalizeLinks(many).length, 6)
  })
})
