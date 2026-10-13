/**
 * Движок зарплаты: формула (схема) + выручка смены → сумма к выдаче с расшифровкой.
 *
 * Схема (salary_schemes.rules) складывается из частей, любую можно обнулить:
 *   ставка за смену + процент от выручки + ступени («+100 ₽ за каждую начатую 1 000 ₽
 *   сверх 7 000 ₽») + оплата часов смены; затем минимум и потолок.
 * База выручки: вся смена, доля смены (поровну на работавших) или только свои чеки.
 * Зарплату получают только сотрудники на смене (shift_staff, роль staff).
 *
 * Зеркало формулы — apps/mobile/src/lib/salary-api.ts (computeSalary), держать синхронно.
 */
import { sql, shifts, shiftStaff, profiles, salarySchemes, salaryPayments, eq, and, inArray, type Database } from '@titan/database'

export type RevenueBase = 'shift' | 'split' | 'own'

export interface SalaryRules {
  /** Ставка за смену, ₽. */
  base: number
  /** Процент от выручки. */
  percent: number
  /** Ступени: с какой выручки начинаются. */
  stepFrom: number
  /** За каждые начатые N ₽ сверх порога… */
  stepEvery: number
  /** …прибавка M ₽. */
  stepAdd: number
  /** ₽ за час смены. */
  hourly: number
  /** Не меньше, ₽ (0 — без минимума). */
  min: number
  /** Не больше, ₽ (0 — без потолка). */
  max: number
  revenue: RevenueBase
  /** Считать выручку мероприятий (базовую сумму события в чеке). */
  events: boolean
}

export const DEFAULT_RULES: SalaryRules = {
  base: 700, percent: 0, stepFrom: 7000, stepEvery: 1000, stepAdd: 100, hourly: 0, min: 0, max: 0, revenue: 'shift', events: false,
}

const MONEY_MAX = 10_000_000
const clampMoney = (v: unknown) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(Math.max(Math.round(n * 100) / 100, 0), MONEY_MAX) : 0
}

/** Правила из БД или запроса → валидные числа (мусор и минусы → 0). */
export function normalizeRules(raw: unknown): SalaryRules {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const revenue = r['revenue'] === 'split' || r['revenue'] === 'own' ? r['revenue'] : 'shift'
  return {
    base: clampMoney(r['base']),
    percent: Math.min(clampMoney(r['percent']), 100),
    stepFrom: clampMoney(r['stepFrom']),
    stepEvery: clampMoney(r['stepEvery']),
    stepAdd: clampMoney(r['stepAdd']),
    hourly: clampMoney(r['hourly']),
    min: clampMoney(r['min']),
    max: clampMoney(r['max']),
    revenue,
    events: r['events'] === true,
  }
}

export interface SalaryLine { label: string; amount: number }
export interface SalaryResult { amount: number; lines: SalaryLine[] }

const rub = (n: number) => `${Math.round(n).toLocaleString('ru-RU')} ₽`
const round2 = (n: number) => Math.round(n * 100) / 100

/** Сумма по формуле и из чего она сложилась. */
export function computeSalary(rules: SalaryRules, input: { revenue: number; hours: number }): SalaryResult {
  const revenue = Math.max(0, input.revenue)
  const lines: SalaryLine[] = []
  if (rules.base > 0) lines.push({ label: 'Ставка за смену', amount: rules.base })
  if (rules.percent > 0) lines.push({ label: `${rules.percent}% от ${rub(revenue)}`, amount: round2((revenue * rules.percent) / 100) })
  if (rules.stepAdd > 0 && rules.stepEvery > 0 && revenue > rules.stepFrom) {
    const steps = Math.ceil((revenue - rules.stepFrom) / rules.stepEvery)
    lines.push({ label: `${steps} × ${rub(rules.stepAdd)} сверх ${rub(rules.stepFrom)}`, amount: steps * rules.stepAdd })
  }
  if (rules.hourly > 0 && input.hours > 0) {
    const hours = Math.round(input.hours * 4) / 4
    lines.push({ label: `${hours.toLocaleString('ru-RU')} ч × ${rub(rules.hourly)}`, amount: round2(hours * rules.hourly) })
  }
  let amount = round2(lines.reduce((s, l) => s + l.amount, 0))
  if (rules.min > 0 && amount < rules.min) {
    lines.push({ label: `До минимума ${rub(rules.min)}`, amount: round2(rules.min - amount) })
    amount = rules.min
  }
  if (rules.max > 0 && amount > rules.max) {
    lines.push({ label: `Потолок ${rub(rules.max)}`, amount: round2(rules.max - amount) })
    amount = rules.max
  }
  return { amount, lines }
}

/** Формула словами: «700 ₽ за смену + 100 ₽ за каждые начатые 1 000 ₽ сверх 7 000 ₽». */
export function describeRules(rules: SalaryRules): string {
  const parts: string[] = []
  if (rules.base > 0) parts.push(`${rub(rules.base)} за смену`)
  if (rules.percent > 0) parts.push(`${rules.percent}% выручки`)
  if (rules.stepAdd > 0 && rules.stepEvery > 0) {
    parts.push(`${rub(rules.stepAdd)} за каждые начатые ${rub(rules.stepEvery)}${rules.stepFrom > 0 ? ` сверх ${rub(rules.stepFrom)}` : ''}`)
  }
  if (rules.hourly > 0) parts.push(`${rub(rules.hourly)} в час`)
  const text = parts.length ? parts.join(' + ') : 'Без начислений'
  const limits = [rules.min > 0 ? `не меньше ${rub(rules.min)}` : '', rules.max > 0 ? `не больше ${rub(rules.max)}` : ''].filter(Boolean)
  return limits.length ? `${text}; ${limits.join(', ')}` : text
}

export const REVENUE_LABEL: Record<RevenueBase, string> = {
  shift: 'выручка всей смены',
  split: 'доля выручки смены (поровну)',
  own: 'выручка по своим чекам',
}

// ─── Данные ─────────────────────────────────────────────────────────────────

function rows<T>(res: unknown): T[] {
  return ((res as { rows?: unknown[] }).rows ?? (res as unknown[])) as T[]
}

export interface SchemeRow { id: string; name: string; rules: SalaryRules; isDefault: boolean }

export async function loadSchemes(db: Database): Promise<SchemeRow[]> {
  const list = await db.select().from(salarySchemes).orderBy(sql`${salarySchemes.isDefault} desc, ${salarySchemes.createdAt}`)
  return list.map((s) => ({ id: s.id, name: s.name, rules: normalizeRules(s.rules), isDefault: s.isDefault }))
}

/** Схема сотрудника: своя, иначе клубная по умолчанию, иначе прежняя формула. */
export function schemeOf(schemes: SchemeRow[], schemeId: string | null): SchemeRow {
  return schemes.find((s) => s.id === schemeId)
    ?? schemes.find((s) => s.isDefault)
    ?? { id: 'default', name: 'Основная', rules: DEFAULT_RULES, isDefault: true }
}

/**
 * Выручка смены по закрытым чекам за вычетом возвратов: вся и по кассирам. Базовая
 * сумма мероприятия — отдельно (схема решает, учитывать ли её).
 */
async function shiftRevenue(db: Database, shiftId: string): Promise<{ total: number; events: number; byStaff: Map<string, { total: number; events: number }> }> {
  const res = await db.execute(sql`
    SELECT c.staff_id,
           coalesce(sum(c.total_amount::numeric - coalesce((SELECT sum(r.total_amount) FROM refunds r WHERE r.check_id = c.id), 0)), 0)::float8 AS total,
           coalesce(sum(coalesce(c.event_base_amount, 0)::numeric), 0)::float8 AS events
    FROM checks c
    WHERE c.shift_id = ${shiftId} AND c.status = 'closed'
    GROUP BY c.staff_id
  `)
  const byStaff = new Map<string, { total: number; events: number }>()
  let total = 0
  let events = 0
  for (const r of rows<{ staff_id: string | null; total: number; events: number }>(res)) {
    total += Number(r.total) || 0
    events += Number(r.events) || 0
    if (r.staff_id) byStaff.set(r.staff_id, { total: Number(r.total) || 0, events: Number(r.events) || 0 })
  }
  return { total, events, byStaff }
}

export interface WorkerSalary {
  profileId: string
  nickname: string
  photoUrl: string | null
  scheme: { id: string; name: string; text: string }
  revenueLabel: string
  revenue: number
  calculated: number
  lines: SalaryLine[]
  paid: { id: string; amount: number; method: string; at: string; calculated: number | null } | null
}

export interface ShiftSalary {
  shift: { id: string; status: string; openedAt: string; closedAt: string | null; hours: number; revenue: number }
  workers: WorkerSalary[]
}

/** Зарплата каждого, кто работал на смене: по его схеме, с отметкой о выплате. */
export async function shiftSalaries(db: Database, shiftId: string): Promise<ShiftSalary | null> {
  const [shift] = await db.select().from(shifts).where(eq(shifts.id, shiftId)).limit(1)
  if (!shift) return null
  const workers = await db.select({
    id: profiles.id,
    nickname: profiles.nickname,
    role: profiles.role,
    schemeId: profiles.salarySchemeId,
    photoUrl: sql<string | null>`coalesce(${profiles.photoUrl}, ${profiles.tgPhotoUrl}, ${profiles.gomafiaPhotoUrl})`,
  }).from(shiftStaff).innerJoin(profiles, eq(profiles.id, shiftStaff.profileId))
    .where(eq(shiftStaff.shiftId, shiftId)).orderBy(shiftStaff.createdAt)
  const paidRows = workers.length
    ? await db.select().from(salaryPayments).where(and(eq(salaryPayments.shiftId, shiftId), inArray(salaryPayments.profileId, workers.map((w) => w.id))))
    : []
  const [schemes, revenue] = await Promise.all([loadSchemes(db), shiftRevenue(db, shiftId)])
  const end = shift.closedAt ?? new Date()
  const hours = Math.max(0, (end.getTime() - shift.openedAt.getTime()) / 3_600_000)
  // Зарплату получают только сотрудники: владелец в списке смены остаётся, но без начислений.
  const payable = workers.filter((w) => w.role === 'staff')

  const list: WorkerSalary[] = payable.map((w) => {
    const scheme = schemeOf(schemes, w.schemeId)
    const r = scheme.rules
    const own = revenue.byStaff.get(w.id) ?? { total: 0, events: 0 }
    const shiftBase = revenue.total - (r.events ? 0 : revenue.events)
    const base = r.revenue === 'own'
      ? own.total - (r.events ? 0 : own.events)
      : r.revenue === 'split' ? shiftBase / Math.max(1, payable.length) : shiftBase
    const result = computeSalary(r, { revenue: Math.max(0, base), hours })
    const paid = paidRows.find((p) => p.profileId === w.id) ?? null
    return {
      profileId: w.id,
      nickname: w.nickname,
      photoUrl: w.photoUrl,
      scheme: { id: scheme.id, name: scheme.name, text: describeRules(r) },
      revenueLabel: REVENUE_LABEL[r.revenue],
      revenue: round2(Math.max(0, base)),
      calculated: result.amount,
      lines: result.lines,
      paid: paid ? {
        id: paid.id, amount: Number(paid.amount), method: paid.paymentMethod, at: paid.createdAt.toISOString(),
        calculated: paid.calculated === null ? null : Number(paid.calculated),
      } : null,
    }
  })
  return {
    shift: {
      id: shift.id, status: shift.status, openedAt: shift.openedAt.toISOString(), closedAt: shift.closedAt?.toISOString() ?? null,
      hours: round2(hours), revenue: round2(revenue.total),
    },
    workers: list,
  }
}

/** Сотрудники смены (для шапки смены и экранов открытия/закрытия). */
export async function shiftWorkers(db: Database, shiftId: string): Promise<{ id: string; nickname: string; photoUrl: string | null }[]> {
  return db.select({
    id: profiles.id,
    nickname: profiles.nickname,
    photoUrl: sql<string | null>`coalesce(${profiles.photoUrl}, ${profiles.tgPhotoUrl}, ${profiles.gomafiaPhotoUrl})`,
  }).from(shiftStaff).innerJoin(profiles, eq(profiles.id, shiftStaff.profileId))
    .where(eq(shiftStaff.shiftId, shiftId)).orderBy(shiftStaff.createdAt)
}

/** Только действующие сотрудники (роль staff) из списка id; чужие и уволенные отбрасываются. */
export async function validWorkerIds(db: Database, ids: string[]): Promise<string[]> {
  if (!ids.length) return []
  const found = await db.select({ id: profiles.id }).from(profiles)
    .where(and(inArray(profiles.id, ids), eq(profiles.role, 'staff'), sql`${profiles.deletedAt} is null`))
  const ok = new Set(found.map((f) => f.id))
  return [...new Set(ids)].filter((id) => ok.has(id))
}
