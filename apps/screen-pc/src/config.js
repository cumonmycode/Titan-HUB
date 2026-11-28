'use strict'
/**
 * Настройки Titan Screen на диске (%APPDATA%/Titan Screen/config.json):
 *   deviceId — постоянный номер компьютера, pairCode — код на экране до привязки;
 *   host, token, screenId, screenName — к какому экрану HUB привязан;
 *   rotation, displayId — последние известные с сервера (чтобы показ шёл и без сети);
 *   displayLabel — название выбранного монитора (найти его, если Windows сменит номер).
 * Пишется атомарно: сначала во временный файл, потом переименование.
 */
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const PAIRED_FIELDS = ['host', 'token', 'screenId', 'screenName', 'rotation', 'displayId', 'displayLabel']

function newPairCode() {
  return String(crypto.randomInt(0, 10000)).padStart(4, '0')
}

function createConfig(dir) {
  const file = path.join(dir, 'config.json')
  let data = {}
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8')) || {}
  } catch {
    data = {}
  }
  if (!data.deviceId) data.deviceId = crypto.randomUUID()
  if (!data.pairCode) data.pairCode = newPairCode()

  const save = () => {
    fs.mkdirSync(dir, { recursive: true })
    const tmp = `${file}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2))
    fs.renameSync(tmp, file)
  }
  save()

  return {
    get: () => ({ ...data }),
    isPaired: () => !!(data.host && data.token && data.screenId),
    update(patch) {
      data = { ...data, ...patch }
      save()
      return { ...data }
    },
    /** Отвязка: забыть экран и выдать новый код — старый мог видеть кто угодно. */
    unpair() {
      const next = { ...data, pairCode: newPairCode() }
      for (const key of PAIRED_FIELDS) delete next[key]
      data = next
      save()
      return { ...data }
    },
  }
}

module.exports = { createConfig }
