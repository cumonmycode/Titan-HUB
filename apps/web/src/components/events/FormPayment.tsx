'use client'
/**
 * «Оплата». Клуб/выезд: Фикс (сумма) | Пакет (цена тарифа мероприятий на выбранную
 * длительность) | По ставке (только клуб: ставка зоны × время, по факту).
 * Миникап: взнос с игрока + расходы (призовой фонд / обед / иные).
 */
import React from 'react'
import { Chip, INP, LBL } from '@/components/manage/DesignSystem'
import { Segments } from '@/components/manage/goods/parts'
import { MUTED, fmtDuration, num, packagePrice, plannedHoursFor, rub, type BillingMode, type EventRate, type SpaceInfo } from './lib'
import { effectiveMode, resolvedDurationMin, type EventFormState } from './formModel'
import { FormSection } from './ui'

interface Props {
  form: EventFormState
  set: (patch: Partial<EventFormState>) => void
  rates: EventRate[]
  spaces: SpaceInfo[]
}

function MoneyInput({ label, value, onChange, placeholder = '0' }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <label style={LBL}>{label}</label>
      <input type="number" inputMode="decimal" min={0} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} style={INP} />
    </div>
  )
}

function packageHint(form: EventFormState, rates: EventRate[]): string {
  const dur = resolvedDurationMin(form)
  if (!dur) return 'Выберите длительность в «Когда» — цена пакета зависит от часов'
  const h = plannedHoursFor(dur)
  const price = packagePrice(rates, h)
  if (price == null) return `Пакет ${h} ч — тарифы мероприятий не настроены («Тарифы и аренда»)`
  return `Пакет ${h} ч — ${rub(price)} за весь период`
}

function rentalHint(form: EventFormState, spaces: SpaceInfo[]): string {
  const space = spaces.find(s => s.id === form.spaceId)
  if (!space) return 'Выберите зону — при старте откроется чек её аренды по ставке'
  const rate = num(space.hourlyRate ?? null) ?? 0
  const dur = resolvedDurationMin(form)
  const estimate = dur ? ` · за ${fmtDuration(dur)} ≈ ${rub(Math.round((rate * dur) / 60))}` : ''
  return `«${space.name}»: ${rub(rate)}/ч${estimate}. Время считается по факту — начатый час округляется до часа.`
}

type CostFlag = 'showPrize' | 'showLunch' | 'showOther'
type CostField = 'prize' | 'lunch' | 'other'
const COSTS: { flag: CostFlag; field: CostField; label: string }[] = [
  { flag: 'showPrize', field: 'prize', label: 'Призовой фонд' },
  { flag: 'showLunch', field: 'lunch', label: 'Обед' },
  { flag: 'showOther', field: 'other', label: 'Иные' },
]

function MinicapPayment({ form, set }: Pick<Props, 'form' | 'set'>) {
  const flagPatch = (flag: CostFlag, on: boolean): Partial<EventFormState> => ({ [flag]: on })
  const fieldPatch = (field: CostField, v: string): Partial<EventFormState> => ({ [field]: v })
  return (
    <FormSection title="Оплата">
      <MoneyInput label="Взнос с игрока, ₽" value={form.fee} onChange={v => set({ fee: v })} />
      <div>
        <label style={LBL}>Расходы миникапа</label>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {COSTS.map(c => <Chip key={c.flag} active={form[c.flag]} onClick={() => set(flagPatch(c.flag, !form[c.flag]))}>{c.label}</Chip>)}
        </div>
      </div>
      {COSTS.filter(c => form[c.flag]).map(c => (
        <MoneyInput key={c.flag} label={`${c.label}, ₽`} value={form[c.field]} onChange={v => set(fieldPatch(c.field, v))} />
      ))}
    </FormSection>
  )
}

export function FormPayment({ form, set, rates, spaces }: Props) {
  if (form.kind === 'minicap') return <MinicapPayment form={form} set={set} />
  const mode = effectiveMode(form)
  const items: { key: BillingMode; label: string }[] = [
    { key: 'amount', label: 'Фикс' },
    { key: 'hourly', label: 'Пакет' },
    ...(form.kind === 'titan' ? [{ key: 'rental' as const, label: 'По ставке' }] : []),
  ]
  return (
    <FormSection title="Оплата">
      <Segments value={mode} onChange={v => set({ billingMode: v })} items={items} />
      {mode === 'amount' && <MoneyInput label="Сумма, ₽" value={form.fixedAmount} onChange={v => set({ fixedAmount: v })} />}
      {mode === 'hourly' && <p style={{ margin: 0, fontSize: 13, lineHeight: 1.45, color: MUTED }}>{packageHint(form, rates)}</p>}
      {mode === 'rental' && <p style={{ margin: 0, fontSize: 13, lineHeight: 1.45, color: MUTED }}>{rentalHint(form, spaces)}</p>}
    </FormSection>
  )
}
