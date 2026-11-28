'use strict'
/**
 * Мониторы компьютера: как их видит HUB и на какой выводить показ. Без Electron —
 * на вход массив display из screen.getAllDisplays(), чтобы проверять тестами.
 *
 * Выбор (displayId с сервера):
 *   задан и подключён — он; не нашёлся по id, но есть монитор с тем же названием — он
 *   (Windows иногда меняет номер после переподключения HDMI);
 *   не задан («Сам выберет») — первый не основной и не встроенный, иначе первый не
 *   основной; монитор один — показ не выводится, чтобы не закрыть окно управления
 *   (вывести на единственный можно, выбрав его явно).
 *   Выбранный монитор отключён — показ ждёт его, на другой сам не переходит.
 */

/** Монитор для HUB: id строкой, название, разрешение в пикселях, основной ли. */
function describe(display, index) {
  const scale = display.scaleFactor || 1
  return {
    id: String(display.id),
    label: (display.label || '').trim() || `Монитор ${index + 1}`,
    width: Math.round(display.size.width * scale),
    height: Math.round(display.size.height * scale),
    primary: !!display.primary,
  }
}

/** Мониторы слева направо, сверху вниз — так же нумерует их Windows в «Параметрах». */
function ordered(displays, primaryId) {
  return displays
    .map((d) => ({ ...d, primary: d.id === primaryId }))
    .sort((a, b) => a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y)
}

function pickTarget(displays, displayId) {
  if (displayId) {
    const byId = displays.find((d) => String(d.id) === String(displayId))
    // Выбранный ТВ выключен — не переносим показ на другой монитор сами.
    return byId ? { display: byId, reason: 'chosen' } : { display: null, reason: 'missing' }
  }
  const auto = displays.find((d) => !d.primary && d.internal === false) || displays.find((d) => !d.primary)
  return auto ? { display: auto, reason: 'auto' } : { display: null, reason: 'single' }
}

/** Монитор, выбранный по id, пропал — ищем такой же по названию (номер мог смениться). */
function resolveChosen(displays, displayId, rememberedLabel) {
  const direct = pickTarget(displays, displayId)
  if (direct.display || !displayId || !rememberedLabel) return direct
  const same = displays.filter((d) => (d.label || '').trim() === rememberedLabel)
  return same.length === 1 ? { display: same[0], reason: 'chosen' } : direct
}

module.exports = { describe, ordered, pickTarget, resolveChosen }
