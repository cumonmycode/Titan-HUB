/**
 * Прогноз выручки смены (Tai) — «на сколько можно рассчитывать к закрытию».
 *
 * Идея: для каждого ОТКРЫТОГО чека смотрим, кто в нём, и проецируем его до
 * типичного итога этого гостя. Резидент с историей закрытых чеков → берём его
 * средний чек (с поправкой на день недели, если данных хватает) и проецируем
 * текущий чек минимум до этого среднего. Гость/без истории — оставляем как есть
 * (не раздуваем прогноз догадками). Прогноз = сумма спроецированных итогов.
 *
 * Объяснимо: в детализации видно по каждому чеку — текущая сумма, прогноз и
 * «обычно оставляет N по M чекам».
 */
import { checks, profiles, eq, and, inArray, gte, desc } from '@titan/database'
import { getBusinessDayStartHour } from './appSettings.js'

const RESIDENT_TIERS = ['resident', 'student', 'newbie']
const num = (v: unknown) => parseFloat(String(v ?? 0)) || 0
// День недели БИЗНЕС-ДНЯ по Москве: смена идёт за полночь, поэтому время до часа
// начала бизнес-дня (по умолч. 9) относим к предыдущим суткам — в 01:00 воскресенья
// субботняя смена берёт субботние средние, а не воскресные.
const bizWeekday = (d: Date, startHour: number) => new Date(d.getTime() + (3 - startHour) * 3600 * 1000).getUTCDay()

export interface PerCheckForecast {
  checkId: string
  name: string
  isResident: boolean
  current: number
  projected: number
  avgSpend: number | null
  samples: number
  weekdayBased: boolean
}
export interface ShiftForecast {
  amount: number
  currentTotal: number
  additional: number
  perCheck: PerCheckForecast[]
}

export async function computeShiftForecast(db: any, shiftId: string): Promise<ShiftForecast> {
  // Открытые чеки смены + кто плательщик.
  const open = await db.select({
    id: checks.id, playerId: checks.playerId, total: checks.totalAmount,
    eventBase: checks.eventBaseAmount, guestNames: checks.guestNames,
    nickname: profiles.nickname, tier: profiles.clientTier,
  }).from(checks).leftJoin(profiles, eq(profiles.id, checks.playerId))
    .where(and(eq(checks.shiftId, shiftId), eq(checks.status, 'open')))

  const playerIds = [...new Set((open as any[]).filter(o => o.playerId).map(o => String(o.playerId)))] as string[]

  // История закрытых чеков этих игроков за 120 дней (что обычно оставляют).
  const hist = playerIds.length
    ? await db.select({ playerId: checks.playerId, total: checks.totalAmount, createdAt: checks.createdAt })
        .from(checks)
        .where(and(inArray(checks.playerId, playerIds), eq(checks.status, 'closed'), gte(checks.createdAt, new Date(Date.now() - 120 * 86400000))))
        .orderBy(desc(checks.createdAt))
    : []

  const startHour = await getBusinessDayStartHour(db)
  const byPlayer = new Map<string, { total: number; wd: number }[]>()
  for (const h of hist as any[]) {
    const arr = byPlayer.get(h.playerId) ?? []
    if (arr.length < 40) arr.push({ total: num(h.total), wd: bizWeekday(new Date(h.createdAt), startHour) })
    byPlayer.set(h.playerId, arr)
  }
  const todayWd = bizWeekday(new Date(), startHour)

  const perCheck: PerCheckForecast[] = (open as any[]).map((o) => {
    const current = num(o.total) + num(o.eventBase)
    const isResident = !!o.playerId && RESIDENT_TIERS.includes(String(o.tier))
    const name = o.nickname || (Array.isArray(o.guestNames) && o.guestNames[0]) || 'Гость'
    let avg: number | null = null, samples = 0, weekdayBased = false
    if (o.playerId) {
      const arr = byPlayer.get(o.playerId) ?? []
      samples = arr.length
      if (samples >= 1) {
        const wd = arr.filter(x => x.wd === todayWd)
        const use = wd.length >= 3 ? wd : arr
        weekdayBased = wd.length >= 3
        avg = use.reduce((s, x) => s + x.total, 0) / use.length
      }
    }
    const projected = avg != null ? Math.max(current, avg) : current
    return { checkId: o.id, name, isResident, current, projected, avgSpend: avg, samples, weekdayBased }
  })

  const currentTotal = perCheck.reduce((s, p) => s + p.current, 0)
  const amount = perCheck.reduce((s, p) => s + p.projected, 0)
  return { amount, currentTotal, additional: amount - currentTotal, perCheck }
}
