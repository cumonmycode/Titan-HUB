'use client'
/**
 * «Когда»: дата + начало и ОДИН контрол длительности — чипсы «1 ч…6 ч» или
 * «Другое» (время конца). Под ним — «до 22:00» («след. день» через полночь).
 * Миникап — только дата и начало.
 */
import React from 'react'
import { Chip, INP, LBL } from '@/components/manage/DesignSystem'
import { TimeInput24 } from '@/components/TimeInput24'
import { endAfter, fmtDuration } from './lib'
import { DURATION_CHIPS, resolvedDurationMin, type EventFormState } from './formModel'
import { FormSection } from './ui'

interface Props {
  form: EventFormState
  set: (patch: Partial<EventFormState>) => void
}

function endHint(form: EventFormState): string | null {
  const dur = resolvedDurationMin(form)
  if (!dur) return null
  const end = endAfter(form.startTime, dur)
  return `до ${end.time}${end.nextDay ? ' (след. день)' : ''} · ${fmtDuration(dur)}`
}

export function FormWhen({ form, set }: Props) {
  const isMinicap = form.kind === 'minicap'
  const hint = isMinicap ? null : endHint(form)
  return (
    <FormSection title="Когда" hint={hint}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 160px', minWidth: 0 }}>
          <label style={LBL} htmlFor="ev-date">Дата</label>
          <input id="ev-date" type="date" value={form.date} onChange={e => set({ date: e.target.value })} style={INP} />
        </div>
        <div style={{ flex: '1 1 160px', minWidth: 0 }}>
          <label style={LBL}>Начало</label>
          <TimeInput24 value={form.startTime} onChange={v => set({ startTime: v })} />
        </div>
      </div>
      {!isMinicap && (
        <div>
          <label style={LBL}>Длительность</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {DURATION_CHIPS.map(h => {
              const active = !form.customEnd && form.durationH === h
              return <Chip key={h} active={active} onClick={() => set({ durationH: active ? null : h, customEnd: false })}>{h} ч</Chip>
            })}
            <Chip active={form.customEnd} onClick={() => set({ customEnd: !form.customEnd, durationH: null })}>Другое</Chip>
          </div>
          {form.customEnd && (
            <div style={{ marginTop: 10 }}>
              <label style={LBL}>Конец</label>
              <TimeInput24 value={form.endTime} onChange={v => set({ endTime: v })} />
            </div>
          )}
        </div>
      )}
    </FormSection>
  )
}
