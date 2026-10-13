import { profiles, checks, tariffs, eq, and, isNull, isNotNull, inArray, sql, type Database } from '@titan/database'
import { getCurrentShift } from '../modules/shifts/shifts.service.js'
import { getBusinessDayStartHour } from './appSettings.js'
import { readAliases } from './tgAliases.js'
import { votersForToday } from './pollState.js'

// ─────────────────────────────────────────────────────────────────────────────
// ПРЕДЧЕКИ: виртуальные (не сохранённые) карточки в кассе для игроков, отметивших
// «Да»/«Опоздаю» в опросе сегодняшнего вечера и сопоставленных с клиентом. Долгое
// нажатие превращает предчек в обычный открытый чек по тарифу статуса игрока.
// Считаются на лету (без схемы/мусора): пропадают, когда игрок уже имеет открытый
// чек, отозвал голос или сменилась смена/день.
// ─────────────────────────────────────────────────────────────────────────────

export interface PrecheckCandidate {
  playerId: string
  nickname: string
  photoUrl: string | null
  clientTier: string
  vote: string // 'да' | 'опоздаю'
  tariffItemId: string | null
  tariffName: string | null
  tariffPrice: string | null
}

// Начало текущего БИЗНЕС-ДНЯ (МСК, граница h:00) в UTC-мс.
export function businessDayStartMs(hour: number): number {
  const MSK = 3 * 3600 * 1000
  const d = new Date(Date.now() + MSK)
  let y = d.getUTCFullYear(), m = d.getUTCMonth(), day = d.getUTCDate()
  if (d.getUTCHours() < hour) {
    const p = new Date(Date.UTC(y, m, day) - 86400000)
    y = p.getUTCFullYear(); m = p.getUTCMonth(); day = p.getUTCDate()
  }
  return Date.UTC(y, m, day, hour, 0, 0) - MSK
}

export async function getPrecheckCandidates(db: Database): Promise<PrecheckCandidate[]> {
  const shift = await getCurrentShift(db)
  if (!shift) return [] // предчеки — только при открытой смене

  const hour = await getBusinessDayStartHour(db)
  const since = businessDayStartMs(hour)
  const voters = await votersForToday(db, since, ['да', 'опоздаю']) // tgId → метка
  if (voters.size === 0) return []
  const tgIds = [...voters.keys()]

  // tgId → профиль (основной tg_id или алиас доп. аккаунта).
  const byPrimary = await db.select({ id: profiles.id, tgId: profiles.tgId })
    .from(profiles).where(and(inArray(profiles.tgId, tgIds), isNull(profiles.deletedAt)))
  const profileIdByTg = new Map<string, string>()
  for (const r of byPrimary) if (r.tgId) profileIdByTg.set(r.tgId, r.id)
  const aliasMap = await readAliases(db)
  for (const tg of tgIds) if (!profileIdByTg.has(tg) && aliasMap[tg]) profileIdByTg.set(tg, aliasMap[tg]!.profileId)
  if (profileIdByTg.size === 0) return []

  // Голос по профилю (дедуп; «да» приоритетнее «опоздаю»).
  const voteByProfile = new Map<string, string>()
  for (const [tg, pid] of profileIdByTg) {
    const v = voters.get(tg)!
    const prev = voteByProfile.get(pid)
    if (!prev || (v === 'да' && prev !== 'да')) voteByProfile.set(pid, v)
  }
  const profileIds = [...voteByProfile.keys()]

  // Исключаем тех, у кого в текущей смене уже есть открытый ('open') ИЛИ оплаченный
  // ('closed') чек. Удалённый чек = 'cancelled' → НЕ исключаем (предчек вернётся).
  const served = await db.select({ playerId: checks.playerId })
    .from(checks).where(and(eq(checks.shiftId, shift.id), inArray(checks.status, ['open', 'closed']), isNotNull(checks.playerId)))
  const openSet = new Set(served.map((o) => o.playerId).filter(Boolean) as string[])

  const profs = await db.select({
    id: profiles.id,
    nickname: profiles.nickname,
    role: profiles.role,
    clientTier: profiles.clientTier,
    photoUrl: sql<string | null>`coalesce(${profiles.photoUrl}, ${profiles.tgPhotoUrl}, ${profiles.gomafiaPhotoUrl})`,
  }).from(profiles).where(inArray(profiles.id, profileIds))

  // Тарифы по ключу статуса (тариф = статус).
  const trows = await db.select({ key: tariffs.key, itemId: tariffs.itemId, price: tariffs.price, name: tariffs.name })
    .from(tariffs).where(and(isNotNull(tariffs.key), eq(tariffs.isActive, true)))
  const tByKey = new Map(trows.map((t) => [t.key, t]))

  const out: PrecheckCandidate[] = []
  for (const p of profs) {
    if (openSet.has(p.id)) continue
    // Сотрудник на игре не платит игровой тариф — предчек без тарифа.
    const t = p.role === 'staff' || p.role === 'owner' ? undefined : tByKey.get(p.clientTier)
    out.push({
      playerId: p.id,
      nickname: p.nickname,
      photoUrl: p.photoUrl ?? null,
      clientTier: p.clientTier,
      vote: voteByProfile.get(p.id) ?? 'да',
      tariffItemId: t?.itemId ?? null,
      tariffName: t?.name ?? null,
      tariffPrice: t?.price ?? null,
    })
  }
  // «Да» сверху, затем «Опоздаю»; внутри — по нику.
  out.sort((a, b) => (a.vote === b.vote ? a.nickname.localeCompare(b.nickname) : a.vote === 'да' ? -1 : 1))
  return out
}
