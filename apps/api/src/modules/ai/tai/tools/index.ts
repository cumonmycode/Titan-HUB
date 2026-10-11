/** Реестр инструментов Tai: данные, касса, интерфейс. Владельцу — плюс запросы к базе. */
import type { LlmTool } from '../llm.js'
import { DATA_TOOLS } from './data.js'
import { POS_TOOLS } from './pos.js'
import type { ToolDef } from './types.js'
import { UI_TOOLS } from './ui.js'

const ALL: ToolDef[] = [...DATA_TOOLS, ...POS_TOOLS, ...UI_TOOLS]

export function toolsFor(isOwner: boolean): Map<string, ToolDef> {
  return new Map(ALL.filter((tool) => isOwner || !tool.ownerOnly).map((tool) => [tool.name, tool]))
}

export function llmTools(tools: Map<string, ToolDef>): LlmTool[] {
  return [...tools.values()].map((tool) => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } }))
}

/** Что предложить следующим вопросом после инструмента — без лишнего запроса к модели. */
export const FOLLOW_UPS: Record<string, string[]> = {
  sales_overview: ['Выручка по дням', 'Часы пик', 'Что продаётся лучше всего?'],
  sales_by_day: ['Часы пик', 'Сравни с прошлой неделей', 'Какой день недели лучший?'],
  club_rhythm: ['Выручка по дням', 'Структура выручки'],
  revenue_structure: ['Топ товаров', 'Кто тратит больше всех?'],
  top_products: ['Что заканчивается на складе?', 'Структура выручки'],
  players_stats: ['Кто давно не приходил?', 'Должники'],
  checks_list: ['Только наличные', 'Самый крупный чек'],
  open_checks: ['Как идёт смена?', 'Открыть чек…'],
  shift_status: ['Открытые чеки', 'Выручка за сегодня'],
  stock_status: ['Топ товаров за неделю'],
  debtors: ['Выручка за сегодня'],
  upcoming_events: ['Выручка мероприятий за месяц'],
}

export const SCREEN_SUGGESTIONS: Record<string, string[]> = {
  pos: ['Как идёт смена?', 'Открытые чеки', 'Что заканчивается?'],
  check: ['Добавь колу', 'Скидка 10%', 'Что он обычно берёт?'],
  analytics: ['Сравни с прошлой неделей', 'Часы пик', 'Топ товаров'],
  other: ['Выручка за сегодня', 'Как идёт смена?', 'Что заканчивается?'],
}
