'use strict'
/**
 * Окно показа: страница экрана клуба в iframe с поворотом, заставка «нет связи» и
 * сообщение поверх показа (команда из HUB). Страница не загрузилась — повтор через
 * 5 → 60 с; приложение ещё следит, отмечается ли страница (сторож в main.js).
 */
const frame = document.getElementById('show')
const offline = document.getElementById('offline')
const offlineText = document.getElementById('offline-text')
const message = document.getElementById('message')
const messageText = document.getElementById('message-text')

const RETRY_MIN_MS = 5000
const RETRY_MAX_MS = 60000

let current = null
let retryDelay = RETRY_MIN_MS
let retryTimer = null
let messageTimer = null
let failed = false

function setRotation(rotation) {
  document.body.classList.toggle('r90', rotation === 90)
  document.body.classList.toggle('r270', rotation === 270)
}

function load(url) {
  clearTimeout(retryTimer)
  offline.hidden = false
  offlineText.textContent = 'Подключаемся к клубу…'
  failed = false
  frame.src = url
}

frame.addEventListener('load', () => {
  // about:blank или страница ошибки сети — iframe тоже присылает load.
  if (!current || !frame.src || failed) return
  offline.hidden = true
  retryDelay = RETRY_MIN_MS
})

function scheduleRetry(text) {
  offline.hidden = false
  offlineText.textContent = text
  clearTimeout(retryTimer)
  retryTimer = setTimeout(() => current && load(current.url), retryDelay)
  retryDelay = Math.min(RETRY_MAX_MS, retryDelay * 2)
}

window.addEventListener('offline', () => scheduleRetry('Нет сети — показ продолжится, как только она появится'))
window.addEventListener('online', () => { retryDelay = RETRY_MIN_MS; if (current) load(current.url) })

function apply(config) {
  if (!config) {
    current = null
    frame.removeAttribute('src')
    offline.hidden = false
    offlineText.textContent = 'Компьютер не подключён к экрану HUB'
    return
  }
  setRotation(config.rotation)
  const urlChanged = !current || current.url !== config.url
  current = config
  if (urlChanged) load(config.url)
}

window.tvHost.onConfig(apply)
window.tvHost.onFailed(() => {
  failed = true
  scheduleRetry('Нет связи с сервером клуба — повторим через несколько секунд')
})
window.tvHost.onReload(() => { if (current) load(current.url) })
window.tvHost.onMessage(({ text, seconds }) => {
  if (!text) return
  messageText.textContent = text
  message.hidden = false
  clearTimeout(messageTimer)
  messageTimer = setTimeout(() => { message.hidden = true }, Math.max(5, seconds) * 1000)
})

// Без сети страница не грузится, а load может так и не прийти — проверяем сами.

window.tvHost.getConfig().then(apply)
