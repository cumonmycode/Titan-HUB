'use client'
/**
 * Лента «Мероприятий»: компактная строка события, «Предстоящие» по дням
 * (Сегодня / Завтра / «Пт, 10 октября») и «Прошедшие» (этот месяц плоско,
 * прошлые месяцы — раскрываемыми папками).
 */
import React, { useState } from 'react'
import { Icon } from '@/components/Icon'
import { Card, IconPlate, Row } from '@/components/manage/goods/parts'
import {
  KIND_LOOK, MUTED, STATUS_LOOK, amountLabel, eventDurationMin, eventKind, eventTitle, fmtDateShort,
  fmtDuration, groupPast, groupUpcoming, isPastEvent, placeLabel, plural,
  type EventItem, type EventRate, type SpaceInfo,
} from './lib'
import { StatusDot } from './ui'

export interface ListContext {
  spaces: SpaceInfo[]
  rates: EventRate[]
  onOpen: (ev: EventItem) => void
}

/** Вторая строка: место · длительность · сумма (миникап: игроки · взнос). */
function metaLine(ev: EventItem, ctx: ListContext, withDuration: boolean): string {
  const dur = eventDurationMin(ev)
  const parts: (string | null)[] = [placeLabel(ev, ctx.spaces)]
  if (eventKind(ev) === 'minicap') {
    // Состав миникапа (до 10 игроков); attendeesCount пишется только при старте и считает судью.
    if (ev.playersCount !== undefined) parts.push(`${ev.playersCount}/10 игроков`)
    else if ((ev.attendeesCount ?? 0) > 0) parts.push(`${ev.attendeesCount} ${plural(ev.attendeesCount ?? 0, 'игрок', 'игрока', 'игроков')}`)
  } else if (withDuration && dur) {
    parts.push(fmtDuration(dur))
  }
  parts.push(amountLabel(ev, ctx.rates))
  return parts.filter(Boolean).join(' · ')
}

/** lead='time' — лента по дням (время начала, ниже конец/длительность);
 *  lead='date' — прошедшие (дата, ниже время начала). */
export function EventRow({ ev, lead, ctx }: { ev: EventItem; lead: 'time' | 'date'; ctx: ListContext }) {
  const kind = eventKind(ev)
  const dur = eventDurationMin(ev)
  const title = eventTitle(ev)
  const muted = ev.status === 'cancelled'
  const leadTop = lead === 'time' ? ev.startTime : fmtDateShort(ev.date)
  const leadBottom = lead === 'time' ? (ev.endTime || (dur ? fmtDuration(dur) : '')) : ev.startTime
  // Длительность во второй строке — только если слева показан конец (иначе дубль).
  const meta = metaLine(ev, ctx, lead === 'date' || !!ev.endTime)
  return (
    <Row onClick={() => ctx.onOpen(ev)} ariaLabel={`${title}, ${STATUS_LOOK[ev.status]?.label ?? ''}`} padding="10px 14px 10px 16px">
      <span style={{ width: 54, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 2, fontVariantNumeric: 'tabular-nums' }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--on-surface)', whiteSpace: 'nowrap' }}>{leadTop}</span>
        {leadBottom && <span style={{ fontSize: 12, color: MUTED, whiteSpace: 'nowrap' }}>{leadBottom}</span>}
      </span>
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
          <StatusDot status={ev.status} />
          {kind !== 'titan' && <Icon name={KIND_LOOK[kind].icon} size={15} color={MUTED} />}
          <span style={{ fontSize: 15, fontWeight: 600, color: muted ? MUTED : 'var(--on-surface)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
        </span>
        {meta && <span style={{ fontSize: 12.5, color: MUTED, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{meta}</span>}
      </span>
    </Row>
  )
}

export function UpcomingList({ events, ctx }: { events: EventItem[]; ctx: ListContext }) {
  const groups = groupUpcoming(events)
  return (
    <>
      {groups.map(g => (
        <Card key={g.date} title={g.label}>
          {g.items.map(ev => <EventRow key={ev.id} ev={ev} lead="time" ctx={ctx} />)}
        </Card>
      ))}
    </>
  )
}

function MonthFolder({ label, items, ctx }: { label: string; items: EventItem[]; ctx: ListContext }) {
  const [open, setOpen] = useState(false)
  return (
    <Card>
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className="ev-folder"
        style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', minHeight: 56, padding: '10px 14px 10px 16px', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', color: 'var(--on-surface)', font: 'inherit' }}>
        <IconPlate icon="folder_open" color="#94A3B8" />
        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>{label}</span>
          <span style={{ fontSize: 12.5, color: MUTED }}>{items.length} {plural(items.length, 'событие', 'события', 'событий')}</span>
        </span>
        <Icon name="expand_more" size={20} color={MUTED} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
        <style>{`.ev-folder:hover { background: rgba(255,255,255,0.03) !important; }`}</style>
      </button>
      {open && items.map(ev => <EventRow key={ev.id} ev={ev} lead="date" ctx={ctx} />)}
    </Card>
  )
}

export function PastList({ events, ctx }: { events: EventItem[]; ctx: ListContext }) {
  const { thisMonth, older } = groupPast(events)
  return (
    <>
      {thisMonth.length > 0 && (
        <Card>{thisMonth.map(ev => <EventRow key={ev.id} ev={ev} lead="date" ctx={ctx} />)}</Card>
      )}
      {older.map(g => <MonthFolder key={g.ym} label={g.label} items={g.items} ctx={ctx} />)}
    </>
  )
}

export const countUpcoming = (events: EventItem[]) => events.filter(e => !isPastEvent(e)).length
export const hasPast = (events: EventItem[]) => events.some(isPastEvent)
