'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { createSseParser } = require('../src/sse')

test('события собираются из кусков, ping и комментарии пропускаются', () => {
  const got = []
  const parse = createSseParser((e) => got.push(e))
  parse('data: {"type":"rea')
  parse('dy"}\n\nevent: ping\ndata: 1\n\n: comment\n')
  parse('data: {"type":"settings"}\r\n\r\n')
  assert.deepEqual(got, [
    { event: 'message', data: '{"type":"ready"}' },
    { event: 'ping', data: '1' },
    { event: 'message', data: '{"type":"settings"}' },
  ])
})
