'use client'
// Новые регистрации из приложения My Titan, ждущие подтверждения (раздел «Клиенты»).
// До подтверждения клиенту не начисляются бонусы и закрыта оплата в приложении.
// «Изменить» открывает карточку клиента на правку, «Отклонить» — профиль в архив.
import React, { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Button, ConfirmDialog } from '@/components/manage/DesignSystem'
import { useToast } from '@/components/Toast'
import { Icon } from '@/components/Icon'

interface Registration {
  id: string
  nickname: string
  fullName: string | null
  phone: string | null
  birthday: string | null
  photoUrl: string | null
  tgUsername: string | null
  createdAt: string
}

const ACCENT = '#8B5CF6'

function birthdayText(value: string | null): string | null {
  const m = value ? /^(\d{4})-(\d{2})-(\d{2})/.exec(value) : null
  return m ? `${m[3]}.${m[2]}.${m[1]}` : null
}

function whenText(iso: string): string {
  return new Date(iso).toLocaleString('ru', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
}

export function PendingRegistrations({ onEdit }: { onEdit: (clientId: string) => void }) {
  const qc = useQueryClient()
  const { show } = useToast()
  const [rejecting, setRejecting] = useState<Registration | null>(null)
  const { data } = useQuery({
    queryKey: ['clients', 'registrations'],
    queryFn: () => api.get<{ registrations: Registration[] }>('/clients/registrations'),
    refetchInterval: 60_000,
  })
  const decide = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'approve' | 'reject' }) =>
      api.post(`/clients/${id}/registration`, { action }),
    onSuccess: (_r, vars) => {
      qc.invalidateQueries({ queryKey: ['clients'] })
      setRejecting(null)
      show(vars.action === 'approve' ? 'Регистрация подтверждена' : 'Регистрация отклонена', 'success')
    },
    onError: () => show('Не удалось сохранить решение', 'error'),
  })

  const list = data?.registrations ?? []
  if (!list.length) return null

  return (
    <section style={{ marginBottom: 16 }}>
      <p style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#a78bfa', margin: '0 0 8px 4px' }}>
        <Icon name="person_add" size={16} /> Новые регистрации · {list.length}
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {list.map((r) => {
          const bd = birthdayText(r.birthday)
          const busy = decide.isPending && decide.variables?.id === r.id
          return (
            <div key={r.id} className="glass-l2" style={{ borderRadius: 14, padding: 14, border: `1px solid ${ACCENT}55`, background: `${ACCENT}12` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                {r.photoUrl
                  ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={r.photoUrl} alt={r.nickname} width={52} height={52} style={{ width: 52, height: 52, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, border: `2px solid ${ACCENT}66` }} />
                  : <div style={{ width: 52, height: 52, borderRadius: '50%', flexShrink: 0, background: `${ACCENT}22`, border: `2px solid ${ACCENT}66`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, color: ACCENT }}>{r.nickname.slice(0, 2).toUpperCase()}</div>}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>{r.nickname}</p>
                  <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--on-surface)' }}>{r.fullName ?? 'Имя не указано'}</p>
                  <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--on-surface-variant)' }}>
                    {[r.phone, bd ? `ДР ${bd}` : null, r.tgUsername ? `@${r.tgUsername}` : null].filter(Boolean).join(' · ')}
                  </p>
                  <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--on-surface-variant)' }}>Заявка {whenText(r.createdAt)} · без бонусов и оплаты до подтверждения</p>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                <Button size="sm" icon="check" loading={busy && decide.variables?.action === 'approve'} disabled={busy}
                  onClick={() => decide.mutate({ id: r.id, action: 'approve' })}>Подтвердить</Button>
                <Button size="sm" variant="secondary" icon="edit" disabled={busy} onClick={() => onEdit(r.id)}>Изменить</Button>
                <Button size="sm" variant="danger" icon="close" disabled={busy} onClick={() => setRejecting(r)}>Отклонить</Button>
              </div>
            </div>
          )
        })}
      </div>
      <ConfirmDialog
        open={!!rejecting}
        onClose={() => setRejecting(null)}
        onConfirm={() => rejecting && decide.mutate({ id: rejecting.id, action: 'reject' })}
        title="Отклонить регистрацию?"
        message={rejecting ? `${rejecting.nickname} уйдёт в архив, приложение выйдет на экран входа.` : undefined}
        confirmLabel="Отклонить"
        danger
        loading={decide.isPending}
      />
    </section>
  )
}
