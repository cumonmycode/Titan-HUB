import { db, profiles, eq, and, sql, type Database } from '@titan/database'
import { getBusinessDayStartHour, getNumericSetting } from './appSettings.js'

// Пер-клубный db (Фаза 1): опциональный параметр, по умолч. синглтон (переходный
// режим — см. lib/appSettings.ts). Перед включением тенантности станет обязательным.
type DbLike = Database

// Новичок становится Резидентом после N посещений. Посещение = БИЗНЕС-день
// (09:00→06:00 МСК), в который у клиента есть хотя бы один закрытый чек (а не
// каждый чек по отдельности — иначе 10 чеков за один вечер дали бы статус).
// Плюс ручные («виртуальные») посещения profiles.manual_visits (±, без кассы).
// Порог по умолчанию; владелец меняет его в «Лояльность → Статусы» (resident_visit_threshold).
// 0 — автоповышение выключено.
export const RESIDENT_VISIT_THRESHOLD = 10
export const RESIDENT_THRESHOLD_KEY = 'resident_visit_threshold'

export async function residentThreshold(database: DbLike): Promise<number> {
  const n = Math.floor(await getNumericSetting(RESIDENT_THRESHOLD_KEY, RESIDENT_VISIT_THRESHOLD, database))
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 1000) : RESIDENT_VISIT_THRESHOLD
}
// Статус, который автоматически дорастает до «Резидента» по посещениям.
export const STARTER_TIER = 'newbie'

// Число посещений = различные бизнес-дни с закрытым чеком + ручные корректировки.
export async function countVisits(profileId: string, database: DbLike): Promise<number> {
  // Граница бизнес-дня — настраиваемая (по умолч. 9 → прежний interval '9 hours').
  const h = await getBusinessDayStartHour(database)
  const res: any = await database.execute(sql`
    SELECT count(distinct date_trunc('day', (created_at AT TIME ZONE 'Europe/Moscow') - interval '${sql.raw(String(h))} hours'))::int AS n
    FROM checks
    WHERE player_id = ${profileId} AND status = 'closed'
  `)
  const rows = res.rows ?? res ?? []
  const checkVisits = Number(rows[0]?.n ?? 0)
  const [p] = await database.select({ mv: profiles.manualVisits }).from(profiles).where(eq(profiles.id, profileId))
  return Math.max(0, checkVisits + (p?.mv ?? 0))
}

// Прогресс к Резиденту для UI (карточка клиента + Wallet).
export interface VisitProgress {
  tier: string
  visits: number
  threshold: number
  remaining: number
  isResident: boolean
}
export async function visitProgress(profileId: string, database: DbLike): Promise<VisitProgress> {
  const [p] = await database.select({ tier: profiles.clientTier }).from(profiles).where(eq(profiles.id, profileId))
  const tier = p?.tier ?? STARTER_TIER
  const visits = await countVisits(profileId, database)
  const threshold = await residentThreshold(database)
  const isStarter = tier === STARTER_TIER && threshold > 0
  return {
    tier,
    visits,
    threshold,
    remaining: isStarter ? Math.max(0, threshold - visits) : 0,
    isResident: tier === 'resident',
  }
}

// Авто-повышение Новичок→Резидент при достижении порога. Вызывать после оплаты
// чека и после ручной корректировки посещений. Возвращает { promoted } — true,
// если статус только что сменился (для уведомления).
export async function maybePromoteToResident(profileId: string, database: DbLike): Promise<{ promoted: boolean }> {
  const [p] = await database.select({ tier: profiles.clientTier }).from(profiles).where(eq(profiles.id, profileId))
  if (!p || p.tier !== STARTER_TIER) return { promoted: false }
  const threshold = await residentThreshold(database)
  if (threshold <= 0) return { promoted: false }
  const visits = await countVisits(profileId, database)
  if (visits < threshold) return { promoted: false }
  // Условие clientTier=STARTER_TIER в WHERE защищает от гонки (двойное повышение).
  const updated = await database
    .update(profiles)
    .set({ clientTier: 'resident' })
    .where(and(eq(profiles.id, profileId), eq(profiles.clientTier, STARTER_TIER)))
    .returning({ id: profiles.id })
  return { promoted: updated.length > 0 }
}
