'use client'
/**
 * «Заявки с сайта» вверху «Предстоящих». Подтвердить → сервер создаёт мероприятие,
 * и сразу открывается его форма (дозаполнить ответственного и т.д.). Отклонить —
 * только после подтверждения в диалоге.
 */
import React, { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useToast } from '@/components/Toast'
import { Button, ConfirmDialog } from '@/components/manage/DesignSystem'
import { Card } from '@/components/manage/goods/parts'
import { telLink } from '@/lib/contact'
import { MUTED, type BookingRequest } from './lib'

const fmtStart = (iso: string) => {
  try {
    return new Date(iso).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', weekday: 'short', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
  } catch { return iso }
}

function requestMeta(b: BookingRequest): string {
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
      {b.comment && <p style={{ margin: 0, fontSize: 13, lineHeight: 1.45 }}>{b.comment}</p>}
      <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
        <Button size="sm" fullWidth onClick={onConfirm} loading={busy}>Подтвердить</Button>
        <Button size="sm" variant="secondary" fullWidth onClick={onReject} disabled={busy}>Отклонить</Button>
      </div>
    </div>
  )
}

export function BookingRequests({ bookings, onConfirmed }: { bookings: BookingRequest[]; onConfirmed: (eventId: string | null) => void }) {
  const qc = useQueryClient()
  const { show } = useToast()
  const [rejectId, setRejectId] = useState<string | null>(null)

  const confirm = useMutation({
    mutationFn: (id: string) => api.patch<{ eventId: string | null }>(`/bookings/${id}`, { status: 'confirmed' }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['bookings-pending'] })
      qc.invalidateQueries({ queryKey: ['events'] })
      show('Заявка подтверждена — мероприятие создано', 'success')
      onConfirmed(r?.eventId ?? null)
    },
    onError: (e: Error) => show(e?.message || 'Не удалось подтвердить заявку', 'error'),
  })
  const reject = useMutation({
    mutationFn: (id: string) => api.patch(`/bookings/${id}`, { status: 'cancelled' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['bookings-pending'] }); setRejectId(null); show('Заявка отклонена', 'success') },
    onError: (e: Error) => show(e?.message || 'Не удалось отклонить заявку', 'error'),
  })

  if (!bookings.length) return null
  return (
    <>
      <Card title={`Заявки с сайта · ${bookings.length}`}>
        {bookings.map(b => (
          <RequestItem key={b.id} b={b}
            busy={confirm.isPending && confirm.variables === b.id}
            onConfirm={() => confirm.mutate(b.id)}
            onReject={() => setRejectId(b.id)} />
        ))}
      </Card>
      <ConfirmDialog
        open={!!rejectId}
        onClose={() => setRejectId(null)}
        onConfirm={() => { if (rejectId) reject.mutate(rejectId) }}
        title="Отклонить заявку?"
        message="Бронь будет отменена. Мероприятие не создаётся."
        confirmLabel="Отклонить"
        danger
        loading={reject.isPending}
      />
    </>
  )
}
