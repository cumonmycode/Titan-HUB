/**
 * Контракт раздела «СММ»: площадки, план месяца, публикации, медиа, замечания,
 * память Tai и отчёты. Одинаковые формы отдаёт API и рисует приложение HUB.
 */

export const PLATFORMS = ['telegram', 'instagram'] as const
export type SmmPlatform = (typeof PLATFORMS)[number]

export const ACCOUNT_PLATFORMS = ['telegram', 'instagram', 'vk', 'other'] as const
export type SmmAccountPlatform = (typeof ACCOUNT_PLATFORMS)[number]

export const FORMATS = ['post', 'carousel', 'story', 'reel'] as const
export type SmmFormat = (typeof FORMATS)[number]

/**
 * idea — тема в плане; draft — Tai пишет/написал, ещё не показал; review — ждёт
 * одобрения; approved — выйдет в срок (Telegram — сам, остальное — передаст человеку);
 * published — вышел (есть ссылка); skipped — решили не выпускать; failed — не вышел.
 */
export const STATUSES = ['idea', 'draft', 'review', 'approved', 'published', 'skipped', 'failed'] as const
export type SmmStatus = (typeof STATUSES)[number]

export const MEMORY_KINDS = ['voice', 'rule', 'avoid', 'insight', 'fact'] as const
export type SmmMemoryKind = (typeof MEMORY_KINDS)[number]

/** Что Tai сейчас делает с постом или планом — приложение показывает и ждёт. */
export type SmmBusy = 'text' | 'image' | 'video' | 'revise' | 'plan' | 'report'

/**
 * Шкала готовности: этап и куда он ведёт. Приложение плавно ведёт полосу от `pct` к
 * `next` за `eta` секунд с момента `at` — между опросами сервера шкала не стоит.
 */
export interface SmmProgress {
  label: string
  pct: number
  next: number
  eta: number
  at: string
}

/**
 * Прогноз просмотров публикации по похожим постам площадки (медиана и разброс).
 * В момент выхода замораживается (`frozen`) — с ним сравнивается факт.
 */
export interface SmmForecast {
  metric: 'views'
  expected: number
  low: number
  high: number
  /** На скольких постах площадки посчитан. */
  basis: number
  likes: number | null
  at: string
  frozen?: boolean
}

export interface SmmMedia {
  id: string
  kind: 'image' | 'video'
  /** archive — фото из фотоархива клуба (Google Диск), как есть. */
  source: 'ai' | 'upload' | 'archive'
  status: 'pending' | 'done' | 'failed'
  url: string | null
  aspect: string | null
  prompt: string | null
  model: string | null
  costRub: number
  error: string | null
  selected: boolean
  sort: number
  createdAt: string
}

/** Сценарий рилса или серии сторис: снимают сотрудники и гости, Tai придумывает и расписывает. */
export interface ReelScript {
  hook: string
  /** Формула зацепки (рилс) — из списка prompts.HOOK_FORMULAS. */
  formula?: string
  shots: { text: string; seconds?: number; overlay?: string; sticker?: string }[]
  audio?: string
  cast?: string
  tips?: string
}

export interface SmmPostStats {
  views?: number
  likes?: number
  comments?: number
  shares?: number
  saves?: number
  reach?: number
  reactions?: number
  interactions?: number
  source?: 'auto'
}

export interface SmmPost {
  id: string
  planId: string | null
  accountId: string | null
  platform: SmmPlatform
  format: SmmFormat
  status: SmmStatus
  publishAt: string | null
  topic: string
  pillar: string | null
  direction: string | null
  brief: string
  body: string
  visual: string
  script: ReelScript | null
  assigneeId: string | null
  assigneeName: string | null
  approvedBy: string | null
  approvedAt: string | null
  handoffAt: string | null
  publishedAt: string | null
  publishedUrl: string | null
  stats: SmmPostStats
  statsAt: string | null
  busy: SmmBusy | null
  progress: SmmProgress | null
  error: string | null
  media: SmmMedia[]
  /** Прогноз: замороженный при выходе или посчитанный сейчас (сервер добавляет при выдаче). */
  forecast: SmmForecast | null
  /** id в соцсети (Instagram media id). */
  extId: string | null
  createdAt: string
  updatedAt: string
  /** Выложит ли Tai сам (Telegram, Instagram по API) — считает сервер при выдаче. */
  autoPublish?: boolean
}

export interface SmmComment {
  id: number
  postId: string | null
  planId: string | null
  authorName: string | null
  role: 'staff' | 'tai'
  text: string
  createdAt: string
}

export interface SmmPillar {
  key: string
  title: string
  share: number
  about: string
}

export interface SmmPlan {
  id: string
  month: string
  status: 'draft' | 'active'
  summary: string
  goals: string[]
  pillars: SmmPillar[]
  busy: SmmBusy | null
  progress: SmmProgress | null
  error: string | null
  updatedAt: string
}

export interface SmmAccount {
  id: string
  platform: SmmAccountPlatform
  title: string
  url: string | null
  handle: string | null
  canPublish: boolean
  isActive: boolean
  followers: number | null
  stats: Record<string, unknown>
  statsAt: string | null
  statsError: string | null
}

export interface SmmMemory {
  id: string
  kind: SmmMemoryKind
  text: string
  source: 'staff' | 'remark' | 'analytics'
  createdAt: string
}

export interface SmmReport {
  id: string
  periodFrom: string
  periodTo: string
  title: string
  summary: string
  metrics: { label: string; value: string; delta?: number | null }[]
  recommendations: { title: string; detail: string }[]
  createdAt: string
}

/** Ошибка, текст которой можно показать человеку как есть. */
export class SmmError extends Error {
  constructor(message: string, readonly status: 400 | 402 | 404 | 409 | 502 = 400) {
    super(message)
  }
}

/** Площадка и формат, которые Tai выкладывает сам (остальное передаёт человеку). */
export const autoPublishes = (p: Pick<SmmPost, 'platform' | 'format'>): boolean =>
  p.platform === 'telegram' && (p.format === 'post' || p.format === 'carousel')

/** Этап шкалы готовности с отметкой времени. */
export const step = (label: string, pct: number, next: number, eta: number): SmmProgress => ({ label, pct, next, eta, at: new Date().toISOString() })

/** Соотношение сторон картинки: лента — 4:5 (Instagram и Telegram), сторис и рилс — 9:16. */
export const aspectFor = (format: SmmFormat): '4:5' | '9:16' => (format === 'story' || format === 'reel' ? '9:16' : '4:5')
