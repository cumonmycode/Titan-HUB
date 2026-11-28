'use strict'
/**
 * HTTP в локальной сети на порту 8788 — как у приставки Titan Menu, чтобы телефон с
 * Titan HUB нашёл компьютер перебором своей Wi‑Fi подсети («Подключить ТВ»):
 *   GET  /info — кто я: код на экране, модель, версия, подключён ли;
 *   POST /pair — {host, secret, code}: код совпал с кодом на экране — компьютер сам
 *                меняет секрет на токен у сервера клуба и отвечает телефону.
 * Тело — не больше 4 КБ.
 */
const http = require('node:http')

const PORT = 8788
const MAX_BODY = 4096
const HOST_RE = /^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/

function send(res, status, json) {
  const body = json ? JSON.stringify(json) : ''
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    Connection: 'close',
  })
  res.end(body)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY) {
        reject(new Error('too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/**
 * listener.info() → объект для /info; listener.pair({host, secret, code}) →
 * Promise<[status, json]>. onError — порт занят и т. п. (привязка с телефона недоступна).
 */
function startLocalServer(listener, onError) {
  const server = http.createServer(async (req, res) => {
    const path = (req.url || '').split('?')[0]
    try {
      if (req.method === 'OPTIONS') return send(res, 204, null)
      if (req.method === 'GET' && path === '/info') return send(res, 200, listener.info())
      if (req.method === 'POST' && path === '/pair') {
        let json
        try {
          json = JSON.parse(await readBody(req))
        } catch {
          return send(res, 400, { ok: false, error: 'Нужен JSON' })
        }
        const host = String(json?.host || '').trim().replace(/\/+$/, '')
        const secret = String(json?.secret || '').trim()
        const code = String(json?.code || '').trim()
        if (!HOST_RE.test(host)) return send(res, 400, { ok: false, error: 'Нужен адрес клуба (https://…)' })
        if (secret.length < 16) return send(res, 400, { ok: false, error: 'Нет секрета привязки' })
        const [status, body] = await listener.pair({ host, secret, code })
        return send(res, status, body)
      }
      return send(res, 404, { ok: false, error: 'Не найдено' })
    } catch {
      return send(res, 500, { ok: false, error: 'Ошибка компьютера' })
    }
  })
  server.requestTimeout = 30_000
  server.on('error', onError)
  server.listen(PORT, '0.0.0.0')
  return server
}

module.exports = { startLocalServer, PORT }
