/** Настройки подарка ко дню рождения (раздел «Лояльность → Подарки»). Без БД — для тестов. */
export interface BirthdayGift {
  enabled: boolean
  kind: 'bonus' | 'certificate'
  amount: number
  tierAmounts: Record<string, number>
  daysBefore: number
  certificateDays: number
}

/** Настройки подарка: сумма по статусу, за сколько дней, бонусы или сертификат. */
export function parseBirthdayGift(s: Record<string, string | undefined>): BirthdayGift {
  const tierAmounts: Record<string, number> = {}
  try {
    const raw = JSON.parse(s['birthday_tier_amounts'] || '{}') as Record<string, unknown>
    for (const [k, v] of Object.entries(raw ?? {})) {
      const n = Math.floor(Number(v))
      if (Number.isFinite(n) && n >= 0) tierAmounts[k] = n
    }
  } catch { /* битый JSON — без сумм по статусам */ }
  const int = (v: string | undefined, d: number, max: number) => {
    const n = Math.floor(Number(v))
    return Number.isFinite(n) ? Math.min(Math.max(n, 0), max) : d
  }
  const isCertificate = s['birthday_gift_kind'] === 'certificate'
  return {
    // Бонусы требуют общей программы; сертификат — нет.
    enabled: s['birthday_bonus_enabled'] === 'true' && (isCertificate || s['bonus_enabled'] !== 'false'),
    kind: isCertificate ? 'certificate' : 'bonus',
    amount: int(s['birthday_bonus_amount'], 0, 1_000_000),
    tierAmounts,
    daysBefore: int(s['birthday_bonus_days_before'], 0, 30),
    certificateDays: int(s['birthday_certificate_days'], 14, 365) || 14,
  }
}

