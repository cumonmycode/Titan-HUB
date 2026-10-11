/**
 * Контракт ответа Tai для клиентов (приложение HUB и веб).
 *
 * Tai отвечает потоком событий (SSE): текст модели приходит кусками, а рядом —
 * интерактивные блоки интерфейса. Цифры в блоках сервер берёт из тех же API, что и
 * экраны кассы/аналитики, а не из текста модели. Клиент сам решает, как нарисовать
 * блок и куда ведёт переход (`TaiRoute`) — сервер описывает только смысл.
 */

/** Куда ведёт нажатие. Клиент сопоставляет экран со своей навигацией. */
export type TaiRoute =
  | { screen: 'pos' }
  | { screen: 'check'; checkId: string }
  | { screen: 'pay'; checkId: string }
  | { screen: 'shift' }
  | { screen: 'analytics'; from: string; to: string }
  | { screen: 'analytics-checks'; from: string; to: string; hour?: number; method?: string }
  | { screen: 'analytics-check'; checkId: string }
  | { screen: 'analytics-products'; from: string; to: string }
  | { screen: 'analytics-players'; from: string; to: string }
  | { screen: 'player'; playerId: string }
  | { screen: 'inventory' }
  | { screen: 'events' }

export interface TaiLink {
  label: string
  to: TaiRoute
}

export interface TaiMetric {
  label: string
  value: string
  /** Изменение к прошлому периоду, %. */
  delta?: number
  /** true — рост это плохо (расходы, себестоимость). */
  invert?: boolean
  hint?: string
}

export interface TaiRow {
  id: string
  title: string
  subtitle?: string
  value?: string
  avatar?: { name: string; url?: string | null }
  to?: TaiRoute
}

export interface TaiPoint {
  key: string
  label: string
  value: number
  /** Подпись значения при выборе: «48 200 ₽ · 31 чек». */
  detail?: string
  to?: TaiRoute
  toLabel?: string
}

export interface TaiPart {
  key: string
  label: string
  value: number
  share: number
  color?: string
  to?: TaiRoute
}

export type TaiActionKind = 'open_check' | 'add_items' | 'change_item' | 'discount' | 'cancel_check'

export interface TaiActionCard {
  id: string
  kind: TaiActionKind
  title: string
  rows: { label: string; value: string }[]
  total?: string
  confirmLabel: string
  destructive?: boolean
  /** pending — ждёт нажатия; done/failed/cancelled — после ответа сервера. */
  status: 'pending' | 'done' | 'failed' | 'cancelled'
  result?: string
  /** Куда перейти после выполнения (чек). */
  to?: TaiRoute
}

export type TaiBlock =
  | { type: 'metrics'; title?: string; items: TaiMetric[]; link?: TaiLink }
  | { type: 'chart'; title: string; unit: 'money' | 'count'; points: TaiPoint[]; caption?: string }
  | { type: 'breakdown'; title: string; parts: TaiPart[]; total: string }
  | { type: 'list'; title: string; rows: TaiRow[]; more?: TaiLink; empty?: string }
  | { type: 'action'; action: TaiActionCard }
  | { type: 'choice'; question: string; options: { label: string; subtitle?: string; reply: string }[] }
  | { type: 'links'; links: TaiLink[] }

export type TaiEvent =
  | { type: 'status'; text: string }
  | { type: 'delta'; text: string }
  | { type: 'block'; block: TaiBlock }
  | { type: 'suggestions'; items: string[] }
  /** Голосовой режим: озвученная фраза ответа, по порядку seq (base64). */
  | { type: 'audio'; seq: number; format: 'mp3' | 'wav'; data: string; upTo: number }
  | { type: 'done'; memo: string }
  | { type: 'error'; message: string }

/** Где пользователь открыл Tai — от этого зависят подсказки и «этот чек». */
export interface TaiScreenContext {
  screen?: 'pos' | 'check' | 'analytics' | 'other'
  checkId?: string
  period?: { from: string; to: string }
}
