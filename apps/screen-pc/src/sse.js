'use strict'
/**
 * Разбор потока Server-Sent Events по кускам текста: отдаёт события { event, data },
 * как только пришла пустая строка. Комментарии (': …') и поля кроме event/data
 * пропускаются. Без сети — чтобы проверять тестом.
 */
function createSseParser(onEvent) {
  let buffer = ''
  let event = 'message'
  let data = []
  return (chunk) => {
    buffer += chunk
    let nl
    while ((nl = buffer.search(/\r?\n/)) >= 0) {
      const line = buffer.slice(0, nl)
      buffer = buffer.slice(nl + (buffer[nl] === '\r' ? 2 : 1))
      if (line === '') {
        if (data.length) onEvent({ event, data: data.join('\n') })
        event = 'message'
        data = []
        continue
      }
      if (line.startsWith(':')) continue
      const colon = line.indexOf(':')
      const field = colon < 0 ? line : line.slice(0, colon)
      const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '')
      if (field === 'event') event = value
      else if (field === 'data') data.push(value)
    }
  }
}

module.exports = { createSseParser }
