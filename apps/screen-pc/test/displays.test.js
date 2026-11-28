'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { describe, ordered, pickTarget, resolveChosen } = require('../src/displays')

const mon = (id, x, { primary = false, internal, label = `M${id}`, w = 1920, h = 1080, scale = 1 } = {}) =>
  ({ id, label, internal, primary, scaleFactor: scale, size: { width: w / scale, height: h / scale }, bounds: { x, y: 0, width: w / scale, height: h / scale } })

test('одного монитора без выбора — показ не выводится', () => {
  assert.deepEqual(pickTarget([mon(1, 0, { primary: true })], null), { display: null, reason: 'single' })
})

test('«Сам выберет» берёт первый не основной монитор', () => {
  const list = [mon(1, 0, { primary: true, internal: true }), mon(2, 1920, { internal: false })]
  assert.equal(pickTarget(list, null).display.id, 2)
})

test('«Сам выберет» предпочитает внешний монитор встроенному', () => {
  const list = [mon(1, 0, { internal: true }), mon(2, 1920, { primary: true, internal: false }), mon(3, 3840, { internal: false })]
  assert.equal(pickTarget(list, null).display.id, 3)
})

test('выбранный монитор используется, даже если он основной', () => {
  const list = [mon(1, 0, { primary: true }), mon(2, 1920)]
  assert.deepEqual(pickTarget(list, '1'), { display: list[0], reason: 'chosen' })
})

test('выбранный монитор отключён — показ на другой сам не переходит', () => {
  assert.deepEqual(pickTarget([mon(1, 0, { primary: true }), mon(2, 1920)], '9'), { display: null, reason: 'missing' })
})

test('сменился номер монитора — находим его по названию', () => {
  const list = [mon(1, 0, { primary: true }), mon(7, 1920, { label: 'LG TV' })]
  assert.equal(resolveChosen(list, '5', 'LG TV').display.id, 7)
})

test('два монитора с одним названием — по названию не угадываем', () => {
  const list = [mon(1, 0, { primary: true, label: 'TV' }), mon(7, 1920, { label: 'TV' })]
  assert.equal(resolveChosen(list, '5', 'TV').reason, 'missing')
})

test('мониторы по порядку слева направо, основной отмечен', () => {
  const list = ordered([mon(2, 1920), mon(1, 0)], 1)
  assert.deepEqual(list.map((d) => [d.id, d.primary]), [[1, true], [2, false]])
})

test('для HUB — разрешение в пикселях с учётом масштаба Windows', () => {
  const d = describe(mon(3, 0, { w: 3840, h: 2160, scale: 1.5, label: '' }), 1)
  assert.deepEqual(d, { id: '3', label: 'Монитор 2', width: 3840, height: 2160, primary: false })
})
