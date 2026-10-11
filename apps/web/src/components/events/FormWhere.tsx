'use client'
/**
 * «Где»: в клубе — зоны с занятостью на выбранное время (GET /events/availability;
 * занятую можно выбрать, но с предупреждением), выезд — адрес, миникап — TITAN.
 */
import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { AddressAutocomplete } from '@/components/AddressAutocomplete'
import { INP } from '@/components/manage/DesignSystem'
import { MINICAP_LOCATION, MUTED, conflictText, isValidTime, type EventConflict, type SpaceInfo } from './lib'
import { resolvedEnd, type EventFormState } from './formModel'
import { ChoiceTile, FormSection } from './ui'

interface AvailSpace extends SpaceInfo { free: boolean; conflict: EventConflict | null }

const AVAILABILITY_STALE_MS = 15_000

function useAvailability(form: EventFormState, excludeEventId: string | null, enabled: boolean) {
  const end = resolvedEnd(form)
  const ready = enabled && !!form.date && isValidTime(form.startTime)
  return useQuery({
    queryKey: ['events', 'availability', form.date, form.startTime, end, excludeEventId],
    queryFn: () => {
      const p = new URLSearchParams({ date: form.date, startTime: form.startTime })
      if (end) p.set('endTime', end)
      if (excludeEventId) p.set('excludeEventId', excludeEventId)
      return api.get<{ spaces: AvailSpace[] }>(`/events/availability?${p.toString()}`)
    },
    enabled: ready,
    retry: false,
    staleTime: AVAILABILITY_STALE_MS,
  })
}

interface Props {
  form: EventFormState
  set: (patch: Partial<EventFormState>) => void
  spaces: SpaceInfo[]
  editId: string | null
}

function ZonePicker({ form, set, spaces, editId }: Props) {
  const avail = useAvailability(form, editId, true)
  // Нет ответа занятости (ошибка/загрузка) — показываем просто зоны, без подписей.
  const list: (SpaceInfo & Partial<AvailSpace>)[] = avail.data?.spaces ?? spaces
  const selected = list.find(s => s.id === form.spaceId)
  const busySelected = selected && selected.free === false && selected.conflict

  if (!list.length) return <p style={{ margin: 0, fontSize: 13, color: MUTED }}>Зоны клуба не настроены</p>
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(132px, 1fr))', gap: 8 }}>
        {list.map(s => {
          const active = form.spaceId === s.id
          const caption = s.free === true ? 'свободна'
            : s.free === false ? (s.conflict ? `занята ${s.conflict.startTime}${s.conflict.endTime ? `–${s.conflict.endTime}` : ''}` : 'занята')
            : undefined
          return (
            <ChoiceTile key={s.id} active={active} title={s.name} caption={caption}
              captionColor={s.free === false ? 'var(--warning)' : undefined}
              onClick={() => set({ spaceId: active ? '' : s.id })} />
          )
        })}
      </div>
      {busySelected && (
        <p role="alert" style={{ margin: 0, fontSize: 12.5, lineHeight: 1.45, color: 'var(--warning)' }}>
          В это время зона занята: {conflictText(busySelected)}. Сохранение не пройдёт — сдвиньте время или выберите другую зону.
        </p>
      )}
    </>
  )
}

export function FormWhere(props: Props) {
  const { form, set } = props
  if (form.kind === 'minicap') {
    return (
      <FormSection title="Где">
        <input value={MINICAP_LOCATION} disabled aria-label="Локация" style={{ ...INP, opacity: 0.7 }} />
      </FormSection>
    )
  }
  if (form.kind === 'exit') {
    return (
      <FormSection title="Где · адрес выезда *">
        <AddressAutocomplete value={form.location} onChange={v => set({ location: v })} placeholder="Адрес или место выезда" style={INP} />
      </FormSection>
    )
  }
  return (
    <FormSection title="Где · зона">
      <ZonePicker {...props} />
    </FormSection>
  )
}
