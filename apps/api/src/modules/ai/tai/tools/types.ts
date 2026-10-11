import type { Database } from '@titan/database'
import type { TaiBlock } from '../blocks.js'
import type { TaiDates } from '../context.js'
import type { ApiCaller } from '../internal.js'

/** Всё, что нужно инструменту: API от имени сотрудника, роль, даты, экран. */
export interface ToolContext {
  api: ApiCaller
  db: Database
  isOwner: boolean
  permissions: Record<string, boolean> | undefined
  dates: TaiDates
  /** Пространство ключей Redis клуба. */
  clubKey: string
  userSub: string
  screenCheckId: string | null
  /** Кэш на один запрос (меню, тарифы, зоны) — инструменты вызываются параллельно. */
  memo: Map<string, Promise<unknown>>
}

export interface ToolResult {
  /** Ответ модели — компактный JSON, без лишних полей. */
  data: unknown
  /** Блоки интерфейса — показываются пользователю сразу. */
  blocks?: TaiBlock[]
  /** Строка для памяти диалога («что уже показано»). */
  memo?: string
  /** true — после этого инструмента модели больше нечего делать (карточка, выбор). */
  terminal?: boolean
}

export interface ToolDef {
  name: string
  description: string
  parameters: Record<string, unknown>
  /** Текст, пока инструмент работает: «Считаю выручку…». */
  status: (args: Record<string, unknown>) => string
  ownerOnly?: boolean
  run: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>
}

export const PERIOD_PARAMS = {
  from: { type: 'string', description: 'Начало периода, YYYY-MM-DD (бизнес-день)' },
  to: { type: 'string', description: 'Конец периода включительно, YYYY-MM-DD' },
}

/** Значение из кэша запроса: одинаковые справочники грузятся один раз. */
export function cached<T>(ctx: ToolContext, key: string, load: () => Promise<T>): Promise<T> {
  const existing = ctx.memo.get(key)
  if (existing) return existing as Promise<T>
  const promise = load()
  ctx.memo.set(key, promise)
  return promise
}
