/**
 * Ответ Tai → сообщения Telegram. Блоки интерфейса (цифры, списки, графики) —
 * компактным текстом; карточки действий и выбор — кнопками под сообщением;
 * переходы — ссылками на экраны HUB клуба.
 */
import type { TaiActionCard, TaiBlock, TaiRoute } from '../../ai/tai/blocks.js'
import { escapeHtml, type InlineButton, type ReplyMarkup } from '../../../lib/tgBot.js'

const LIST_ROWS = 12
const CHART_POINTS = 12

/** Markdown модели (**жирный**, списки, заголовки) → HTML Telegram. */
export function mdToHtml(src: string): string {
  let s = escapeHtml(src)
  s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>')
  s = s.replace(/^\s{0,3}#{1,6}\s+(.+)$/gm, '<b>$1</b>')
  s = s.replace(/\*\*([^*\n]+?)\*\*/g, '<b>$1</b>')
  s = s.replace(/__([^_\n]+?)__/g, '<b>$1</b>')
  s = s.replace(/^[ \t]*[*\-•][ \t]+/gm, '• ')
  s = s.replace(/(^|[^\w*])\*([^*\n]+?)\*(?=[^\w*]|$)/g, '$1<i>$2</i>')
  return s.replace(/\n{3,}/g, '\n\n').trim()
}

/** Экран HUB для перехода из Telegram (та же схема, что taiHref в вебе). */
export function hubUrl(host: string, to: TaiRoute): string {
  const range = (from: string, toDate: string) => `from=${from}&to=${toDate}`
  const path = (() => {
    switch (to.screen) {
      case 'pos':
      case 'shift':
        return '/pos'
      case 'check':
      case 'pay':
        return `/pos/${to.checkId}`
      case 'analytics':
        return `/dashboard?${range(to.from, to.to)}`
      case 'analytics-checks':
        return `/dashboard?tab=finance&${range(to.from, to.to)}`
      case 'analytics-check':
        return `/dashboard?check=${to.checkId}`
      case 'analytics-products':
        return `/dashboard?tab=bar&${range(to.from, to.to)}`
      case 'analytics-players':
        return `/dashboard?tab=players&${range(to.from, to.to)}`
      case 'player':
        return `/dashboard?player=${to.playerId}`
      case 'inventory':
        return '/manage/inventory'
      case 'events':
        return '/events'
    }
  })()
  return `https://${host}${path}`
}

function deltaText(delta: number | undefined, invert?: boolean): string {
  if (delta === undefined || !Number.isFinite(delta) || delta === 0) return ''
  const good = invert ? delta < 0 : delta > 0
  return ` ${good ? '▲' : '▼'}${Math.abs(Math.round(delta))}%`
}

/** Блок с данными → текст; null — блок рисуется кнопками (действие, выбор, ссылки). */
export function blockText(block: TaiBlock): string | null {
  switch (block.type) {
    case 'metrics': {
      const lines = block.items.map((m) => `${escapeHtml(m.label)}: <b>${escapeHtml(m.value)}</b>${deltaText(m.delta, m.invert)}`)
      return [block.title ? `<b>${escapeHtml(block.title)}</b>` : '', ...lines].filter(Boolean).join('\n')
    }
    case 'chart': {
      const points = block.points.slice(-CHART_POINTS)
      const lines = points.map((p) => `${escapeHtml(p.label)} — ${escapeHtml(p.detail ?? String(p.value))}`)
      return [`<b>${escapeHtml(block.title)}</b>`, ...lines, block.caption ? `<i>${escapeHtml(block.caption)}</i>` : ''].filter(Boolean).join('\n')
    }
    case 'breakdown': {
      const lines = block.parts.map((p) => `${escapeHtml(p.label)} — ${Math.round(p.share * 100)}%`)
      return [`<b>${escapeHtml(block.title)}</b> · ${escapeHtml(block.total)}`, ...lines].join('\n')
    }
    case 'list': {
      if (!block.rows.length) return `<b>${escapeHtml(block.title)}</b>\n${escapeHtml(block.empty ?? 'Пусто')}`
      const rows = block.rows.slice(0, LIST_ROWS).map((r) => {
        const sub = r.subtitle ? ` · ${escapeHtml(r.subtitle)}` : ''
        const value = r.value ? ` — <b>${escapeHtml(r.value)}</b>` : ''
        return `• ${escapeHtml(r.title)}${sub}${value}`
      })
      const more = block.rows.length > LIST_ROWS ? `\n…и ещё ${block.rows.length - LIST_ROWS}` : ''
      return `<b>${escapeHtml(block.title)}</b>\n${rows.join('\n')}${more}`
    }
    default:
      return null
  }
}

/** Карточка действия: текст сообщения. */
export function actionText(card: TaiActionCard): string {
  const rows = card.rows.map((r) => `${escapeHtml(r.label)}: ${escapeHtml(r.value)}`)
  const total = card.total ? `\nИтого: <b>${escapeHtml(card.total)}</b>` : ''
  const status = card.status === 'done'
    ? `\n\n✅ ${escapeHtml(card.result ?? 'Готово')}`
    : card.status === 'failed'
      ? `\n\n⚠️ ${escapeHtml(card.result ?? 'Не получилось')}`
      : card.status === 'cancelled'
        ? '\n\nОтменено'
        : ''
  return `<b>${escapeHtml(card.title)}</b>\n${rows.join('\n')}${total}${status}`
}

/** Кнопки карточки: «Подтвердить / Отмена», после выполнения — переход в HUB. */
export function actionMarkup(card: TaiActionCard, host: string): ReplyMarkup | undefined {
  if (card.status === 'pending') {
    return { inline_keyboard: [[{ text: card.confirmLabel, callback_data: `ta:${card.id}` }, { text: 'Отмена', callback_data: `td:${card.id}` }]] }
  }
  if (card.status === 'done' && card.to) return { inline_keyboard: [[{ text: 'Открыть в HUB', url: hubUrl(host, card.to) }]] }
  return undefined
}

/** Ссылки на экраны HUB → кнопки-ссылки (по две в ряд). */
export function linksMarkup(links: { label: string; to: TaiRoute }[], host: string): ReplyMarkup {
  const buttons: InlineButton[] = links.map((l) => ({ text: l.label, url: hubUrl(host, l.to) }))
  const rows: InlineButton[][] = []
  for (let i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2))
  return { inline_keyboard: rows }
}

/** Вопрос с вариантами → кнопки; ответы лежат в Redis под коротким ключом. */
export function choiceMarkup(key: string, options: { label: string }[]): ReplyMarkup {
  return { inline_keyboard: options.slice(0, 8).map((o, i) => [{ text: o.label.slice(0, 60), callback_data: `tc:${key}:${i}` }]) }
}
