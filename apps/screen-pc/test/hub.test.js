'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { normalizeHost } = require('../src/hub')

test('адрес клуба: без протокола — https, без хвостового слэша', () => {
  assert.equal(normalizeHost('kbr.titanpos.ru'), 'https://kbr.titanpos.ru')
  assert.equal(normalizeHost(' https://kbr.titanpos.ru/ '), 'https://kbr.titanpos.ru')
  assert.equal(normalizeHost('http://192.168.1.5:3000'), 'http://192.168.1.5:3000')
})

test('адрес клуба: путь и пустая строка не принимаются', () => {
  assert.equal(normalizeHost('kbr.titanpos.ru/manage'), null)
  assert.equal(normalizeHost(''), null)
})
