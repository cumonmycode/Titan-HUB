/**
 * «Экраны» (Управление → Экраны): телевизоры клуба с приложением Titan Menu.
 * Типы ответов /api/screens*, подписи и загрузка картинок.
 *
 * У экрана — показ (по кругу меню и картинки на весь экран, у каждого своё время,
 * анимация и её скорость) и реклама в ленте меню (картинки и карточки с QR).
 */
import { uploadImage } from './upload'

export type Rotation = 0 | 90 | 270
export type Transition = 'fade' | 'slide' | 'zoom' | 'flip' | 'none'
export type Fit = 'contain' | 'cover'
export type Placement = 'show' | 'band'

/** Что в показе: есть ли меню и сколько картинок. */
export interface ShowSummary {
  menu: boolean
  images: number
}

export interface Screen {
  id: string
  name: string
  show: ShowSummary
  rotation: Rotation
  theme: string
  bandSec: number
  sortOrder: number
  paired: boolean
  online: boolean
  deviceModel: string | null
  appVersion: string | null
  deviceIp: string | null
  pairedAt: string | null
  lastSeenAt: string | null
}

/** Элемент экрана: в показе — меню или картинка, в ленте — картинка или карточка. */
export interface ScreenSlide {
  id: string
  screenId: string
  placement: Placement
  kind: 'image' | 'card' | 'menu'
  imageUrl: string | null
  title: string | null
  body: string | null
  linkUrl: string | null
  durationSec: number
  transition: Transition
  transitionMs: number
  fit: Fit
  isActive: boolean
  sortOrder: number
}

/** GET /screens/:id — экран, его показ и реклама ленты. */
export interface ScreenDetail {
  screen: Screen
  show: ScreenSlide[]
  slides: ScreenSlide[]
}

export const SCREENS_KEY = ['screens']
export const screenKey = (id: string) => ['screens', id]

function plural(n: number, forms: [string, string, string]): string {
  const m10 = n % 10, m100 = n % 100
  if (m10 === 1 && m100 !== 11) return forms[0]
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return forms[1]
  return forms[2]
}

/** «Меню», «Меню и 2 картинки», «5 картинок». */
export function showLabel(show: ShowSummary): string {
  const pics = show.images ? `${show.images} ${plural(show.images, ['картинка', 'картинки', 'картинок'])}` : ''
  if (show.menu) return pics ? `Меню и ${pics}` : 'Меню'
  return pics || 'Меню'
}

export const ROTATIONS: { key: Rotation; label: string; short: string }[] = [
  { key: 0, label: 'Горизонтально', short: 'Горизонтально' },
  { key: 90, label: 'Вертикально, поворот по часовой', short: 'Вертикально ↻' },
  { key: 270, label: 'Вертикально, поворот против часовой', short: 'Вертикально ↺' },
]

export const TRANSITIONS: { key: Transition; label: string }[] = [
  { key: 'fade', label: 'Растворение' },
  { key: 'slide', label: 'Сдвиг' },
  { key: 'zoom', label: 'Приближение' },
  { key: 'flip', label: 'Переворот' },
  { key: 'none', label: 'Без анимации' },
]

export const FITS: { key: Fit; label: string }[] = [
  { key: 'contain', label: 'Целиком' },
  { key: 'cover', label: 'Во весь экран' },
]

export const THEMES: { key: string; name: string; note: string }[] = [
  { key: 'night', name: 'Ночь', note: 'Фирменная: тёмная, фиолетовая лента' },
  { key: 'neon', name: 'Неон', note: 'Вывеска на кирпичной стене' },
  { key: 'deco', name: 'Ар-деко', note: 'Чикаго 20-х: чёрный и золото' },
  { key: 'synth', name: 'Синтвейв', note: 'Закат 80-х, бегущая сетка' },
  { key: 'avant', name: 'Конструктивизм', note: 'Плакат: бумага и гротеск' },
  { key: 'dossier', name: 'Досье', note: 'Дело мафии: машинка, штамп' },
  { key: 'halloween', name: 'Хеллоуин', note: 'Тыквы, летучие мыши, паутина' },
]

/** Скорость анимации входа элемента показа. */
export const SPEEDS: { ms: number; label: string }[] = [
  { ms: 500, label: 'Быстро' },
  { ms: 900, label: 'Обычно' },
  { ms: 1600, label: 'Медленно' },
]

export const SLIDE_DURATIONS = [5, 8, 10, 15, 20, 30, 45, 60]
export const MENU_DURATIONS = [15, 20, 30, 45, 60, 90, 120, 180, 300]
export const BAND_DURATIONS = [10, 15, 20, 30, 45, 60]

/** Список вариантов с текущим значением, даже если его нет среди стандартных. */
export function withCurrent(options: number[], current: number): number[] {
  return options.includes(current) ? options : [...options, current].sort((a, b) => a - b)
}

/** «45 с», «2 мин», «1,5 мин». */
export function durationLabel(sec: number): string {
  if (sec < 60) return `${sec} с`
  const min = sec / 60
  return `${Number.isInteger(min) ? min : min.toFixed(1).replace('.', ',')} мин`
}

/** «В сети» / «Был 5 мин назад» / «Не подключён». */
export function deviceStatus(s: Pick<Screen, 'paired' | 'online' | 'lastSeenAt'>): { label: string; color: string } {
  if (!s.paired) return { label: 'ТВ не подключён', color: 'var(--on-surface-variant)' }
  if (s.online) return { label: 'В сети', color: '#22C55E' }
  if (!s.lastSeenAt) return { label: 'Не в сети', color: '#F59E0B' }
  const min = Math.max(1, Math.round((Date.now() - new Date(s.lastSeenAt).getTime()) / 60_000))
  const ago = min < 60 ? `${min} мин` : min < 48 * 60 ? `${Math.round(min / 60)} ч` : `${Math.round(min / 1440)} дн`
  return { label: `Не в сети · был ${ago} назад`, color: '#F59E0B' }
}

/** Загрузка картинки показа — общий загрузчик (сжатие до 1920/1080 px, JPEG < 900 КБ). */
export const uploadScreenImage = uploadImage
