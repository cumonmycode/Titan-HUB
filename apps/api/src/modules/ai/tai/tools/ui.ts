/**
 * Инструменты интерфейса: вопрос с вариантами и кнопки перехода. Ничего не читают —
 * только рисуют блок. Переходы проверяются: модель не может собрать произвольный путь.
 */
import { answerFromDb } from '../../sql.js'
import type { TaiLink, TaiRoute } from '../blocks.js'
import { isDateKey } from '../format.js'
import type { ToolDef } from './types.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SCREENS = ['pos', 'check', 'pay', 'shift', 'analytics', 'analytics-checks', 'player', 'inventory', 'events'] as const

/** Переход из аргументов модели — только известные экраны с корректными id и датами. */
function route(raw: Record<string, unknown>, today: string): TaiRoute | null {
  const screen = raw['screen']
  const id = (key: string) => (typeof raw[key] === 'string' && UUID.test(raw[key] as string) ? (raw[key] as string) : null)
  const from = isDateKey(raw['from']) ? raw['from'] : today
  const to = isDateKey(raw['to']) ? raw['to'] : from
  switch (screen) {
    case 'pos':
    case 'shift':
    case 'inventory':
    case 'events':
      return { screen }
    case 'check':
    case 'pay': {
      const checkId = id('checkId')
      return checkId ? { screen, checkId } : null
    }
    case 'player': {
      const playerId = id('playerId')
      return playerId ? { screen, playerId } : null
    }
    case 'analytics':
      return { screen, from, to }
    case 'analytics-checks':
      return { screen, from, to, ...(typeof raw['method'] === 'string' ? { method: raw['method'] } : {}) }
    default:
      return null
  }
}

const askUserChoice: ToolDef = {
  name: 'ask_user_choice',
  description:
    'Спросить пользователя и дать варианты кнопками (2–6). label — что видно на кнопке, reply — что уйдёт от имени пользователя при нажатии: ' +
    'делай его однозначным и с id, например «Саид Мурат (playerId …)». После этого остановись и жди ответа.',
  parameters: {
    type: 'object',
    properties: {
      question: { type: 'string' },
      options: {
        type: 'array',
        items: { type: 'object', properties: { label: { type: 'string' }, subtitle: { type: 'string' }, reply: { type: 'string' } }, required: ['label'] },
      },
    },
    required: ['question', 'options'],
  },
  status: () => 'Уточняю…',
  run: async (args) => {
    const raw = Array.isArray(args['options']) ? (args['options'] as Record<string, unknown>[]) : []
    const options = raw
      .map((o) => ({ label: String(o['label'] ?? '').slice(0, 60), subtitle: typeof o['subtitle'] === 'string' ? o['subtitle'].slice(0, 80) : undefined, reply: String(o['reply'] ?? o['label'] ?? '').slice(0, 200) }))
      .filter((o) => o.label)
      .slice(0, 6)
    if (options.length < 2) return { data: { error: 'Нужно минимум два варианта' } }
    const question = String(args['question'] ?? 'Уточните').slice(0, 200)
    return { blocks: [{ type: 'choice', question, options }], memo: `спросил: ${question}`, data: { shown: true }, terminal: true }
  },
}

const showLinks: ToolDef = {
  name: 'show_links',
  description:
    'Показать кнопки перехода в приложении. screen: pos (касса), check (чек, checkId), pay (оплата чека, checkId), shift (смена), analytics (from, to), ' +
    'analytics-checks (чеки за from..to, можно method), player (playerId), inventory (склад), events (мероприятия).',
  parameters: {
    type: 'object',
    properties: {
      links: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            label: { type: 'string' },
            screen: { type: 'string', enum: [...SCREENS] },
            checkId: { type: 'string' },
            playerId: { type: 'string' },
            from: { type: 'string' },
            to: { type: 'string' },
            method: { type: 'string' },
          },
          required: ['label', 'screen'],
        },
      },
    },
    required: ['links'],
  },
  status: () => 'Готовлю переход…',
  run: async (args, ctx) => {
    const raw = Array.isArray(args['links']) ? (args['links'] as Record<string, unknown>[]) : []
    const links: TaiLink[] = raw
      .map((l) => ({ label: String(l['label'] ?? '').slice(0, 60), to: route(l, ctx.dates.today) }))
      .filter((l): l is TaiLink => !!l.label && !!l.to)
      .slice(0, 4)
    if (!links.length) return { data: { error: 'Нет корректных переходов (проверь screen и id)' } }
    return { blocks: [{ type: 'links', links }], data: { shown: links.map((l) => l.label) } }
  },
}

const askDatabase: ToolDef = {
  name: 'ask_database',
  description: 'Только если других инструментов не хватает: ответ на нестандартный вопрос по всей базе клуба (зарплаты, расходы, история). Медленно — несколько секунд.',
  parameters: { type: 'object', properties: { question: { type: 'string' } }, required: ['question'] },
  status: () => 'Ищу ответ в базе…',
  ownerOnly: true,
  run: async (args, ctx) => {
    const block = await answerFromDb(ctx.db, String(args['question'] ?? '').slice(0, 500))
    return { data: block ? { result: block.slice(0, 6000) } : { error: 'Не удалось получить данные' }, memo: 'запрос к базе' }
  },
}

export const UI_TOOLS: ToolDef[] = [askUserChoice, showLinks, askDatabase]
