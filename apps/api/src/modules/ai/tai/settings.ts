/**
 * Настройки Tai клуба: голос, скорость речи, можно ли материться. Хранятся в
 * app_settings одной строкой JSON (`tai_settings`); меняет владелец в «Управлении».
 */
import { appSettings, type Database } from '@titan/database'
import { getStringSetting } from '../../../lib/appSettings.js'

export interface TaiVoice {
  id: string
  label: string
  hint: string
  model: string
  voice: string
  /** Понимает ли модель скорость и указание подачи (OpenAI — да, Microsoft — нет). */
  tunable: boolean
}

const OPENAI = 'openai/gpt-4o-mini-tts'
const MICROSOFT = 'microsoft/mai-voice-2-flash'

export const TAI_VOICES: TaiVoice[] = [
  { id: 'ash', label: 'Эш', hint: 'мужской, живой', model: OPENAI, voice: 'ash', tunable: true },
  { id: 'onyx', label: 'Оникс', hint: 'мужской, низкий', model: OPENAI, voice: 'onyx', tunable: true },
  { id: 'verse', label: 'Верс', hint: 'мужской, выразительный', model: OPENAI, voice: 'verse', tunable: true },
  { id: 'echo', label: 'Эхо', hint: 'мужской, ровный', model: OPENAI, voice: 'echo', tunable: true },
  { id: 'ballad', label: 'Баллад', hint: 'мужской, мягкий', model: OPENAI, voice: 'ballad', tunable: true },
  { id: 'coral', label: 'Корал', hint: 'женский, тёплый', model: OPENAI, voice: 'coral', tunable: true },
  { id: 'nova', label: 'Нова', hint: 'женский, бодрый', model: OPENAI, voice: 'nova', tunable: true },
  { id: 'sage', label: 'Сейдж', hint: 'женский, спокойный', model: OPENAI, voice: 'sage', tunable: true },
  { id: 'shimmer', label: 'Шиммер', hint: 'женский, светлый', model: OPENAI, voice: 'shimmer', tunable: true },
  { id: 'ms-lev', label: 'Лев', hint: 'мужской, русский диктор', model: MICROSOFT, voice: 'ru-RU-Lev:MAI-Voice-2-Flash', tunable: false },
  { id: 'ms-masha', label: 'Маша', hint: 'женский, русский диктор', model: MICROSOFT, voice: 'ru-RU-Masha:MAI-Voice-2-Flash', tunable: false },
]

export const TAI_SPEEDS: { value: number; label: string }[] = [
  { value: 0.9, label: 'Спокойно' },
  { value: 1, label: 'Обычно' },
  { value: 1.15, label: 'Бодро' },
  { value: 1.3, label: 'Быстро' },
]

export interface TaiSettings {
  voice: string
  speed: number
  profanity: boolean
}

const KEY = 'tai_settings'
export const DEFAULT_TAI_SETTINGS: TaiSettings = { voice: 'ash', speed: 1, profanity: true }

/** Только допустимые значения: неизвестный голос или скорость — по умолчанию. */
export function normalizeTaiSettings(raw: Partial<TaiSettings> | null | undefined): TaiSettings {
  const voice = TAI_VOICES.some((v) => v.id === raw?.voice) ? raw!.voice! : DEFAULT_TAI_SETTINGS.voice
  const speed = TAI_SPEEDS.some((s) => s.value === raw?.speed) ? raw!.speed! : DEFAULT_TAI_SETTINGS.speed
  const profanity = typeof raw?.profanity === 'boolean' ? raw.profanity : DEFAULT_TAI_SETTINGS.profanity
  return { voice, speed, profanity }
}

export async function getTaiSettings(db: Database): Promise<TaiSettings> {
  try {
    return normalizeTaiSettings(JSON.parse(await getStringSetting(KEY, '{}', db)) as Partial<TaiSettings>)
  } catch {
    return DEFAULT_TAI_SETTINGS
  }
}

export async function saveTaiSettings(db: Database, patch: Partial<TaiSettings>): Promise<TaiSettings> {
  const next = normalizeTaiSettings({ ...(await getTaiSettings(db)), ...patch })
  const value = JSON.stringify(next)
  await db.insert(appSettings).values({ key: KEY, value }).onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } })
  return next
}

export const voiceById = (id: string): TaiVoice => TAI_VOICES.find((v) => v.id === id) ?? TAI_VOICES[0]!
