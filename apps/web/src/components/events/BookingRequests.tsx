'use client'
/**
 * «Заявки с сайта» вверху «Предстоящих»: брони виджета /book и заявки сайта клуба.
 * Мероприятие: подтвердить → сервер создаёт мероприятие, и сразу открывается его
 * форма. Запись на игру и обращение подтверждаются как «приняты» — без мероприятия.
 * Отклонить — только после подтверждения в диалоге.
 */
import React, { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useToast } from '@/components/Toast'
import { Button, ConfirmDialog } from '@/components/manage/DesignSystem'
import { Card } from '@/components/manage/goods/parts'
import { telLink } from '@/lib/contact'
import { MUTED, type BookingRequest } from './lib'

type Kind = NonNullable<BookingRequest['kind']>

// Что значат решения для каждого вида заявки — подписи кнопок, тосты и диалог отказа.
const KIND_LOOK: Record<Kind, { confirm: string; reject: string; confirmed: string; rejectTitle: string; rejectText: string }> = {
  event: {
    confirm: 'Подтвердить', reject: 'Отклонить', confirmed: 'Заявка подтверждена — мероприятие создано',
    rejectTitle: 'Отклонить заявку?', rejectText: 'Бронь будет отменена. Мероприятие не создаётся.',
  },
  game: {
    confirm: 'Ждём', reject: 'Отклонить', confirmed: 'Запись подтверждена — гостя ждут',
    rejectTitle: 'Отклонить запись?', rejectText: 'Запись на игру будет отменена.',
  },
  message: {
    confirm: 'Обработано', reject: 'Скрыть', confirmed: 'Сообщение отмечено как обработанное',
    rejectTitle: 'Скрыть сообщение?', rejectText: 'Сообщение уйдёт из списка заявок.',
  },
}
const kindOf = (b: BookingRequest): Kind => b.kind ?? 'event'

const fmtStart = (iso: string) => {
  try {
    return new Date(iso).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', weekday: 'short', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
  } catch { return iso }
}

function requestMeta(b: BookingRequest): string {
  if (kindOf(b) === 'message') return `Получено ${fmtStart(b.starts_at)}`
  const isExit = b.location === 'exit'
  const place = isExit ? 'Выезд' : (b.zone_name ? `В клубе · ${b.zone_name}` : 'В клубе')
  const parts = [place, fmtStart(b.starts_at)]
  if (b.tariff_hours) parts.push(`${b.tariff_hours} ч`)
  if (b.guests != null) parts.push(`гостей ${b.guests}`)
  return parts.join(' · ')
}

function RequestItem({ b, busy, onConfirm, onReject }: { b: BookingRequest; busy: boolean; onConfirm: () => void; onReject: () => void }) {
  const title = b.title || b.name || 'Заявка'
  // Имя отдельной строкой — только если заголовком стало название заявки (без дубля).
  const contactName = b.title ? b.name : null
  const look = KIND_LOOK[kindOf(b)]
  return (
    <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 15, fontWeight: 700 }}>{title}</span>
      <span style={{ fontSize: 12.5, color: MUTED, lineHeight: 1.45 }}>{requestMeta(b)}</span>
      {b.location === 'exit' && b.address && <span style={{ fontSize: 13, lineHeight: 1.45 }}>{b.address}</span>}
      {(contactName || b.phone) && (
        <span style={{ fontSize: 13, color: MUTED }}>
          {contactName}{contactName && b.phone ? ' · ' : ''}
          {b.phone && <a href={telLink(b.phone)} style={{ color: 'var(--accent-light)', textDecoration: 'none', fontVariantNumeric: 'tabular-nums' }}>{b.phone}</a>}
        </span>
      )}
      {b.comment && <p style={{ margin: 0, fontSize: 13, lineHeight: 1.45, whiteSpace: 'pre-line' }}>{b.comment}</p>}
      <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
        <Button size="sm" fullWidth onClick={onConfirm} loading={busy}>{look.confirm}</Button>
        <Button size="sm" variant="secondary" fullWidth onClick={onReject} disabled={busy}>{look.reject}</Button>
      </div>
    </div>
  )
}

export function BookingRequests({ bookings, onConfirmed }: { bookings: BookingRequest[]; onConfirmed: (eventId: string | null) => void }) {
  const qc = useQueryClient()
  const { show } = useToast()
  const [rejecting, setRejecting] = useState<BookingRequest | null>(null)

  const confirm = useMutation({
    mutationFn: (b: BookingRequest) => api.patch<{ eventId: string | null }>(`/bookings/${b.id}`, { status: 'confirmed' }),
    onSuccess: (r, b) => {
      qc.invalidateQueries({ queryKey: ['bookings-pending'] })
      qc.invalidateQueries({ queryKey: ['events'] })
      show(KIND_LOOK[kindOf(b)].confirmed, 'success')
      onConfirmed(r?.eventId ?? null)
    },
    onError: (e: Error) => show(e?.message || 'Не удалось подтвердить заявку', 'error'),
  })
  const reject = useMutation({
    mutationFn: (b: BookingRequest) => api.patch(`/bookings/${b.id}`, { status: 'cancelled' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['bookings-pending'] }); setRejecting(null); show('Готово', 'success') },
    onError: (e: Error) => show(e?.message || 'Не удалось отклонить заявку', 'error'),
  })

  if (!bookings.length) return null
  const rejectLook = rejecting ? KIND_LOOK[kindOf(rejecting)] : KIND_LOOK.event
  return (
    <>
      <Card title={`Заявки с сайта · ${bookings.length}`}>
        {bookings.map(b => (
          <RequestItem key={b.id} b={b}
            busy={confirm.isPending && confirm.variables?.id === b.id}
            onConfirm={() => confirm.mutate(b)}
            onReject={() => setRejecting(b)} />
        ))}
      </Card>
      <ConfirmDialog
        open={!!rejecting}
        onClose={() => setRejecting(null)}
        onConfirm={() => { if (rejecting) reject.mutate(rejecting) }}
        title={rejectLook.rejectTitle}
        message={rejectLook.rejectText}
        confirmLabel={rejectLook.reject}
        danger
        loading={reject.isPending}
      />
    </>
  )
}
