'use strict'
/**
 * Связь Titan Screen с сервером клуба — те же запросы, что у приставки Titan Menu:
 *   claim     — секрет от телефона или код из HUB → свой токен устройства;
 *   heartbeat — раз в 20 с: «в сети», мониторы компьютера; в ответ — поворот и монитор;
 *   settings  — монитор и поворот, выбранные в самом приложении;
 *   stream    — поток команд из HUB (номера на мониторах, сообщение на ТВ) и сигнал
 *               «настройки поменялись», чтобы перенести показ сразу;
 *   unpair    — отвязаться самому.
 * Ответ 401 — экран удалили или отвязали в HUB: вызывающий забывает привязку.
 */
const { createSseParser } = require('./sse')

const REQUEST_TIMEOUT_MS = 15_000

class HubError extends Error {
  constructor(message, status) {
    super(message)
    this.status = status
  }
}

async function request(host, path, { method = 'GET', token, body, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let res
  try {
    res = await fetch(`${host}/api/screens${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    })
  } catch (error) {
    throw new HubError(error.name === 'AbortError' ? 'Сервер клуба не ответил' : 'Нет связи с сервером клуба', 0)
  } finally {
    clearTimeout(timer)
  }
  const json = await res.json().catch(() => null)
  if (!res.ok) throw new HubError(json?.error || `Сервер ответил ${res.status}`, res.status)
  return json
}

/** «kbr.titanpos.ru», «https://kbr.titanpos.ru/» → «https://kbr.titanpos.ru». */
function normalizeHost(input) {
  const raw = String(input || '').trim().replace(/\/+$/, '')
  if (!raw) return null
  const withProto = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
  try {
    const url = new URL(withProto)
    if (url.pathname !== '/' && url.pathname !== '') return null
    return `${url.protocol}//${url.host}`
  } catch {
    return null
  }
}

const claim = (host, { secret, deviceId, model, appVersion }) =>
  request(host, '/device/claim', { method: 'POST', body: { secret, deviceId, model, appVersion, app: 'desktop' } })

const heartbeat = (host, token, { appVersion, state }) =>
  request(host, '/device/heartbeat', { method: 'POST', token, body: { appVersion, app: 'desktop', state } })

const saveSettings = (host, token, patch) =>
  request(host, '/device/settings', { method: 'PATCH', token, body: patch })

const unpair = (host, token) =>
  request(host, '/device/unpair', { method: 'POST', token, timeoutMs: 5000 }).catch(() => null)

/**
 * Поток команд. Держится, пока не вызвать stop(); оборвался — переподключение через
 * 2 → 30 с. onUnauthorized — экран отвязали, переподключаться незачем.
 */
function openStream(host, token, { onSignal, onUnauthorized, onState }) {
  let stopped = false
  let controller = null
  let delay = 2000

  const run = async () => {
    while (!stopped) {
      controller = new AbortController()
      try {
        const res = await fetch(`${host}/api/screens/device/stream`, {
          headers: { Accept: 'text/event-stream', Authorization: `Bearer ${token}` },
          signal: controller.signal,
        })
        if (res.status === 401) {
          onUnauthorized()
          return
        }
        if (!res.ok || !res.body) throw new Error(`stream ${res.status}`)
        onState(true)
        delay = 2000
        const parse = createSseParser(({ event, data }) => {
          if (event !== 'message') return
          try {
            onSignal(JSON.parse(data))
          } catch {
            /* битое сообщение — пропускаем */
          }
        })
        const decoder = new TextDecoder()
        for await (const chunk of res.body) parse(decoder.decode(chunk, { stream: true }))
      } catch {
        /* обрыв — ниже переподключение */
      }
      onState(false)
      if (stopped) return
      await new Promise((r) => setTimeout(r, delay))
      delay = Math.min(30_000, delay * 2)
    }
  }
  void run()
  return {
    stop() {
      stopped = true
      controller?.abort()
    },
  }
}

module.exports = { HubError, normalizeHost, claim, heartbeat, saveSettings, unpair, openStream }
