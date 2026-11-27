/**
 * Расчёт бонусов за чек — чистые функции без БД (тестируются отдельно).
 * Применение к чеку и подарки первого чека — lib/bonusAccrual.ts.
 */
import type { BonusRule } from '@titan/database'
import { lineInScope, matchesConditions, type ConditionContext } from './discounts.js'
import { round2 } from './money.js'

export const BONUS_SETTING_KEYS = [
  'bonus_enabled', 'bonus_accrual_rate', 'bonus_min_purchase', 'bonus_accrual_on_debt',
  'bonus_tier_rates', 'bonus_excluded_categories',
  'welcome_bonus_enabled', 'welcome_bonus_amount',
  'referral_enabled', 'referral_bonus_inviter', 'referral_bonus_invitee', 'referral_min_check',
] as const

export interface BonusSettings {
  enabled: boolean
  baseRate: number
  tierRates: Record<string, number>
  minPurchase: number
  onDebt: boolean
  excludedCategories: Set<string>
  welcome: { enabled: boolean; amount: number }
  referral: { enabled: boolean; inviter: number; invitee: number; minCheck: number }
}

const num = (raw: string | undefined, fallback: number) => {
  const n = parseFloat(raw ?? '')
  return Number.isFinite(n) ? n : fallback
}
function jsonObject(raw: string | undefined): Record<string, unknown> {
  try { const v = JSON.parse(raw ?? '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {} } catch { return {} }
}
function jsonArray(raw: string | undefined): string[] {
  try { const v = JSON.parse(raw ?? '[]'); return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [] } catch { return [] }
}

export function parseBonusSettings(s: Record<string, string | undefined>): BonusSettings {
  const tierRates: Record<string, number> = {}
  for (const [k, v] of Object.entries(jsonObject(s['bonus_tier_rates']))) {
    const n = Number(v)
    if (Number.isFinite(n) && n >= 0) tierRates[k] = n
  }
  return {
    enabled: s['bonus_enabled'] !== 'false',
    baseRate: num(s['bonus_accrual_rate'], 5),
    tierRates,
    minPurchase: num(s['bonus_min_purchase'], 0),
    onDebt: s['bonus_accrual_on_debt'] === 'true',
    excludedCategories: new Set(jsonArray(s['bonus_excluded_categories'])),
    welcome: { enabled: s['welcome_bonus_enabled'] === 'true', amount: Math.max(0, Math.floor(num(s['welcome_bonus_amount'], 0))) },
    referral: {
      enabled: s['referral_enabled'] === 'true',
      inviter: Math.max(0, Math.floor(num(s['referral_bonus_inviter'], 0))),
      invitee: Math.max(0, Math.floor(num(s['referral_bonus_invitee'], 0))),
      minCheck: Math.max(0, num(s['referral_min_check'], 0)),
    },
  }
}


export interface AccrualLine {
  itemId: string
  categoryId: string | null
  /** Стоимость строки до скидок (цена × количество). */
  amount: number
  /** Свободная строка «Другое» (возврат денег за гостя) — бонусы на неё не начисляются. */
  noBonus?: boolean
}

export interface AccrualInput extends ConditionContext {
  lines: AccrualLine[]
  /** Сколько гость фактически заплатил деньгами за чек (без бонусов). */
  paid: number
  /** Часть чека, записанная в долг. */
  debt: number
}

export interface AccrualResult {
  amount: number
  /** Подпись для истории бонусов: «5% за чек · «Вторник ×2»». */
  reason: string
  /** Какие правила сработали — для превью в HUB. */
  applied: { ruleId: string; name: string }[]
}

const ruleValue = (r: BonusRule) => parseFloat(r.value) || 0

/** Самое сильное правило вида kind, подходящее строке. */
function strongest(rules: BonusRule[], kind: BonusRule['kind'], fits: (r: BonusRule) => boolean): BonusRule | null {
  let best: BonusRule | null = null
  for (const r of rules) {
    if (r.kind === kind && fits(r) && (!best || ruleValue(r) > ruleValue(best))) best = r
  }
  return best
}

/** Чистая функция: сколько бонусов дать за чек. */
export function computeAccrual(settings: BonusSettings, rules: BonusRule[], input: AccrualInput): AccrualResult {
  const none: AccrualResult = { amount: 0, reason: '', applied: [] }
  if (!settings.enabled || input.paid <= 0 || input.paid < settings.minPurchase) return none
  if (input.debt > 0 && !settings.onDebt) return none

  const tier = input.player?.clientTier
  const base = tier !== undefined && settings.tierRates[tier] !== undefined ? settings.tierRates[tier]! : settings.baseRate
  const active = rules.filter((r) => r.isActive && input.paid >= (parseFloat(r.minCheckSum) || 0) && matchesConditions(r, input))

  const gross = input.lines.reduce((s, l) => s + l.amount, 0)
  const lines = gross > 0 ? input.lines : [{ itemId: '', categoryId: null, amount: input.paid }]
  const ratio = gross > 0 ? input.paid / gross : 1
  const used = new Map<string, string>()

  let total = 0
  for (const line of lines) {
    if (line.noBonus) continue
    const excluded = !!line.categoryId && settings.excludedCategories.has(line.categoryId)
    // Исключённую категорию «включает» только правило, которое назвало её явно.
    const fits = (r: BonusRule) => lineInScope(r, line) && (!excluded || r.scope !== 'check')
    let rate = excluded ? 0 : base
    const own = strongest(active, 'percent', fits)
    if (own) { rate = ruleValue(own); used.set(own.id, own.name) }
    const mult = strongest(active, 'multiplier', fits)
    if (mult && rate > 0) { rate *= ruleValue(mult); used.set(mult.id, mult.name) }
    total += (line.amount * ratio * rate) / 100
  }
  for (const r of active) {
    if (r.kind !== 'fixed' || ruleValue(r) <= 0) continue
    if (r.scope !== 'check' && !input.lines.some((l) => lineInScope(r, l))) continue
    total += ruleValue(r)
    used.set(r.id, r.name)
  }

  const amount = Math.max(0, Math.floor(round2(total)))
  const parts = [base > 0 ? `${base}% за чек` : null, ...[...used.values()].map((n) => `«${n}»`)].filter(Boolean)
  return { amount, reason: parts.join(' · ') || 'Начисление за чек', applied: [...used].map(([ruleId, name]) => ({ ruleId, name })) }
}

