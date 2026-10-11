'use client'
/**
 * Просмотр события (шторка): шапка (название, когда, статус) → ОДНО главное
 * действие по статусу → состав миникапа → сведения → заказчик. Всё второстепенное
 * (правка, «нужно уточнить», отмена, удаление навсегда) — только в меню «⋯».
 */
import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useToast } from '@/components/Toast'
import { Button, ConfirmDialog, Sheet } from '@/components/manage/DesignSystem'
import {
  KIND_LOOK, MUTED, dayLabel, eventDurationMin, eventKind, eventTitle, fmtDuration, isValidTime, toMin,
  type EventItem, type EventRate, type EventStatus, type SpaceInfo, type StaffInfo,
} from './lib'
import { EventDetails } from './EventDetails'
import { MinicapLineup, useParticipants } from './MinicapLineup'
import { MoreMenu, type MoreMenuItem } from './MoreMenu'
import { StatusLine } from './ui'

interface EventViewProps {
  event: EventItem | null
  onClose: () => void
  onEdit: (ev: EventItem) => void
  spaces: SpaceInfo[]
  staff: StaffInfo[]
  rates: EventRate[]
  isOwner: boolean
}

/** «Сегодня · 18:00–22:00 · 4 ч» (+ «след. день», если конец за полночью). */
function whenText(ev: EventItem): string {
  const dur = eventDurationMin(ev)
  const end = isValidTime(ev.endTime) ? ev.endTime : null
  const nextDay = !!end && toMin(end) <= toMin(ev.startTime)
  const time = end ? `${ev.startTime}–${end}${nextDay ? ' (след. день)' : ''}` : ev.startTime
  return [dayLabel(ev.date), time, dur ? fmtDuration(dur) : null].filter(Boolean).join(' · ')
}

type ConfirmKind = 'cancel' | 'purge' | null

function EventViewBody({ ev, onClose, onEdit, spaces, staff, rates, isOwner }: Omit<EventViewProps, 'event'> & { ev: EventItem }) {
  const qc = useQueryClient()
  const router = useRouter()
  const { show } = useToast()
  const [confirm, setConfirm] = useState<ConfirmKind>(null)
  const kind = eventKind(ev)
  const isMinicap = kind === 'minicap'
  const lineup = useParticipants(ev.id, isMinicap)

  const setStatus = useMutation({
    mutationFn: (status: EventStatus) => api.patch(`/events/${ev.id}`, { status }),
    onSuccess: (_r, status) => {
      qc.invalidateQueries({ queryKey: ['events'] })
      if (status === 'cancelled') { setConfirm(null); show('Мероприятие отменено', 'success'); onClose() }
      else if (status === 'active') show(isMinicap ? 'Миникап начат — счета участников открыты в кассе' : 'Мероприятие начато — чек открыт', 'success')
    },
    onError: (e: Error) => show(e?.message || 'Не удалось изменить статус', 'error'),
  })
  // Удаление навсегда (только владелец, только отменённые): событие + связанная бронь.
  const purge = useMutation({
    mutationFn: () => api.delete(`/events/${ev.id}?purge=true`),
    onSuccess: () => {
      for (const key of ['events', 'bookings-pending', 'bookings-archive']) qc.invalidateQueries({ queryKey: [key] })
      setConfirm(null); show('Удалено навсегда', 'success'); onClose()
    },
    onError: (e: Error) => show(e?.message || 'Не удалось удалить', 'error'),
  })

  const busy = setStatus.isPending
  const noPlayers = isMinicap && !lineup.isLoading && lineup.players.length === 0
  const primary: { label: string; icon: string; onClick: () => void; disabled?: boolean } | null =
    ev.status === 'planned' ? { label: 'Начать', icon: 'play_arrow', onClick: () => setStatus.mutate('active'), disabled: isMinicap && (lineup.isLoading || noPlayers) }
    : ev.status === 'needs_clarification' ? { label: 'Всё уточнено', icon: 'check_circle', onClick: () => setStatus.mutate('planned') }
    : ev.status === 'active' && isMinicap ? { label: 'Перейти в кассу', icon: 'point_of_sale', onClick: () => router.push('/pos') }
    : ev.status === 'active' ? { label: 'Открыть чек', icon: 'receipt_long', onClick: () => router.push(ev.checkId ? `/pos/${ev.checkId}` : '/pos') }
    : null

  // «Всё уточнено» — главное действие, поэтому «Вернуть в план» в меню только у отменённых.
  const menu: MoreMenuItem[] = []
  if (ev.status === 'cancelled') {
    menu.push({ key: 'restore', label: 'Вернуть в план', icon: 'undo', onSelect: () => setStatus.mutate('planned') })
    if (isOwner) menu.push({ key: 'purge', label: 'Удалить навсегда', icon: 'delete_forever', danger: true, onSelect: () => setConfirm('purge') })
  } else {
    menu.push({ key: 'edit', label: 'Редактировать', icon: 'edit', onSelect: () => onEdit(ev) })
    if (ev.status === 'planned') menu.push({ key: 'clarify', label: 'Нужно уточнить', icon: 'help', onSelect: () => setStatus.mutate('needs_clarification') })
    menu.push({ key: 'cancel', label: 'Отменить мероприятие', icon: 'cancel', danger: true, onSelect: () => setConfirm('cancel') })
  }

  const cancelMessage = ev.status === 'active'
    ? (isMinicap ? 'Открытые счета участников будут отменены, списанное вернётся на склад.' : 'Открытый чек мероприятия будет отменён, списанное вернётся на склад.')
    : ev.status === 'completed'
    ? 'Закрытые чеки не меняются; расходы мероприятия уйдут из аналитики.'
    : 'Мероприятие останется в «Прошедших» как отменённое.'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h3 style={{ margin: 0, fontSize: 21, fontWeight: 700, lineHeight: 1.25, color: 'var(--on-surface)', overflowWrap: 'anywhere' }}>{eventTitle(ev)}</h3>
          <p style={{ margin: 0, fontSize: 14, color: MUTED, fontVariantNumeric: 'tabular-nums' }}>{whenText(ev)}</p>
          <StatusLine status={ev.status} />
        </div>
        <MoreMenu items={menu} />
      </div>

      {primary && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Button size="lg" fullWidth icon={primary.icon} onClick={primary.onClick} loading={busy} disabled={primary.disabled}>{primary.label}</Button>
          {ev.status === 'planned' && noPlayers && <p style={{ margin: 0, fontSize: 12.5, color: MUTED, textAlign: 'center' }}>Добавьте игроков в состав — при старте каждому откроется счёт</p>}
        </div>
      )}

      {isMinicap && (
        <MinicapLineup eventId={ev.id} players={lineup.players} judge={lineup.judge}
          editable={ev.status !== 'completed' && ev.status !== 'cancelled'} />
      )}

      <EventDetails ev={ev} spaces={spaces} staff={staff} rates={rates} />

      <ConfirmDialog
        open={confirm === 'cancel'}
        onClose={() => setConfirm(null)}
        onConfirm={() => setStatus.mutate('cancelled')}
        title="Отменить мероприятие?"
        message={cancelMessage}
        confirmLabel="Отменить мероприятие"
        cancelLabel="Не отменять"
        danger
        loading={busy}
      />
      <ConfirmDialog
        open={confirm === 'purge'}
        onClose={() => setConfirm(null)}
        onConfirm={() => purge.mutate()}
        title="Удалить навсегда?"
        message="Мероприятие и связанная бронь будут стёрты безвозвратно."
        confirmLabel="Удалить"
        danger
        loading={purge.isPending}
      />
    </div>
  )
}

export function EventView({ event, ...rest }: EventViewProps) {
  // Держим последнее событие, пока шторка доигрывает анимацию закрытия.
  const [last, setLast] = useState<EventItem | null>(event)
  if (event && event !== last) setLast(event)
  const ev = event ?? last
  return (
    <Sheet open={!!event} onClose={rest.onClose} title={ev ? KIND_LOOK[eventKind(ev)].label : ''} initialHeight="80dvh" maxHeight="92dvh">
      {ev && <EventViewBody key={ev.id} ev={ev} {...rest} />}
    </Sheet>
  )
}
