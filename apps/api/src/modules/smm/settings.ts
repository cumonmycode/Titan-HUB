/**
 * Настройки раздела «СММ» клуба — одна строка JSON в app_settings (`smm_settings`):
 * голос бренда, аудитория и цели, частота публикаций, кто выкладывает Instagram,
 * одобрение и бюджет на нейросети. Меняет владелец; неизвестное — по умолчанию.
 */
import { appSettings, type Database } from '@titan/database'
import { z } from 'zod'
import { getStringSetting } from '../../lib/appSettings.js'

const KEY = 'smm_settings'

export const SettingsSchema = z.object({
  /** Telegram без одобрения: Tai публикует сам, за несколько часов присылает превью. */
  autopilot: z.boolean(),
  voice: z.string().max(1500),
  audience: z.string().max(1500),
  goals: z.string().max(1500),
  /** Сколько в неделю: постов в Telegram, постов в Instagram, сторис, рилс. */
  cadence: z.object({
    telegram: z.number().int().min(0).max(21),
    instagram: z.number().int().min(0).max(21),
    stories: z.number().int().min(0).max(35),
    reels: z.number().int().min(0).max(14),
  }),
  /** Время выхода по умолчанию, МСК. */
  postTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  /** Кто выкладывает Instagram и сторис (сотрудник). null — владелец. */
  publisherId: z.string().uuid().nullable(),
  /** За сколько часов до выхода Tai готовит пост и присылает на одобрение. */
  reviewLeadHours: z.number().int().min(2).max(96),
  /** Бюджет месяца на нейросети, ₽ (0 — без ограничения). */
  monthlyBudget: z.number().int().min(0).max(100_000),
})

export type SmmSettings = z.infer<typeof SettingsSchema>

export const DEFAULT_SMM_SETTINGS: SmmSettings = {
  autopilot: false,
  voice: 'Дерзко и по-свойски, с азартом и юмором мафии; на «ты»; коротко, живыми словами, без канцелярита и пафоса; эмодзи — к месту, не больше 3–4 на пост.',
  audience: 'Молодые взрослые 18–40 лет из города: любители интеллектуальных игр, общения и вечеринок; компании, которые ищут, где отметить день рождения или провести корпоратив.',
  goals: 'Больше гостей на игровых вечерах и турнирах, заявки на дни рождения и корпоративы, узнаваемость клуба и живое сообщество вокруг него.',
  // Скилл ig-plan: 4–5 публикаций в неделю в Instagram, из них ≥3 рилс — они дотягиваются до неподписанных.
  cadence: { telegram: 4, instagram: 2, stories: 5, reels: 3 },
  postTime: '12:00',
  publisherId: null,
  reviewLeadHours: 24,
  monthlyBudget: 3000,
}

export function normalizeSmmSettings(raw: unknown): SmmSettings {
  const base = { ...DEFAULT_SMM_SETTINGS, ...(raw && typeof raw === 'object' ? (raw as Partial<SmmSettings>) : {}) }
  const cadence = { ...DEFAULT_SMM_SETTINGS.cadence, ...(base.cadence ?? {}) }
  const parsed = SettingsSchema.safeParse({ ...base, cadence })
  if (parsed.success) return parsed.data
  // Битое поле не должно ломать остальные — собираем по одному.
  const out = { ...DEFAULT_SMM_SETTINGS }
  for (const key of Object.keys(DEFAULT_SMM_SETTINGS) as (keyof SmmSettings)[]) {
    const one = SettingsSchema.shape[key].safeParse(key === 'cadence' ? cadence : base[key])
    if (one.success) (out as Record<string, unknown>)[key] = one.data
  }
  return out
}

export async function getSmmSettings(db: Database): Promise<SmmSettings> {
  try {
    return normalizeSmmSettings(JSON.parse(await getStringSetting(KEY, '{}', db)))
  } catch {
    return DEFAULT_SMM_SETTINGS
  }
}

export async function saveSmmSettings(db: Database, patch: Partial<SmmSettings>): Promise<SmmSettings> {
  const current = await getSmmSettings(db)
  const next = normalizeSmmSettings({ ...current, ...patch, cadence: { ...current.cadence, ...(patch.cadence ?? {}) } })
  const value = JSON.stringify(next)
  await db.insert(appSettings).values({ key: KEY, value }).onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } })
  return next
}
