/**
 * «Экраны» (Управление → Экраны): телевизоры клуба с приложением Titan Menu.
 * Типы ответов /api/screens*, подписи и загрузка картинок.
 *
 * У экрана — показ (по кругу меню и картинки на весь экран, у каждого своё время,
 * анимация и её скорость) и реклама в ленте меню (картинки и карточки с QR).
 */
import { useAuthStore } from '@/store/auth.store'

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

// Сжатие до 1920 px по длинной стороне и 1080 по короткой (JPEG < 900 КБ): общий
// лимит тела запроса API — 1 МБ, фото с телефона его превышают. Вертикальная
// картинка для вертикального ТВ остаётся 1080×1920, а не ужимается до 608 px.
async function compressImage(file: File): Promise<Blob> {
  const src = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image()
      i.onload = () => resolve(i)
      i.onerror = () => reject(new Error('Не удалось прочитать картинку'))
      i.src = src
    })
    const long = Math.max(img.naturalWidth, img.naturalHeight)
    const short = Math.min(img.naturalWidth, img.naturalHeight)
    const scale = Math.min(1, 1920 / long, 1080 / short)
    const w = Math.max(1, Math.round(img.naturalWidth * scale))
    const h = Math.max(1, Math.round(img.naturalHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Не удалось обработать картинку')
    ctx.fillStyle = '#0b0810' // прозрачный PNG — на фоне экрана, а не на чёрном
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(img, 0, 0, w, h)
    for (const q of [0.86, 0.76, 0.66]) {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', q))
      if (blob && blob.size < 900 * 1024) return blob
    }
    throw new Error('Картинка слишком тяжёлая даже после сжатия')
  } finally {
    URL.revokeObjectURL(src)
  }
}

export async function uploadScreenImage(file: File): Promise<string> {
  const blob = await compressImage(file)
  const fd = new FormData()
  fd.append('file', blob, 'slide.jpg')
  const base = process.env.NEXT_PUBLIC_API_URL ?? '/api'
  const token = useAuthStore.getState().token
  const res = await fetch(`${base}/upload/image`, { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: fd })
  if (!res.ok) {
    const e = await res.json().catch(() => null)
    throw new Error(e?.error || 'Не удалось загрузить картинку')
  }
  return (await res.json()).url as string
}
