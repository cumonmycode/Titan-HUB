'use client'
/**
 * Единая форма мероприятия: «В клубе | Выезд | Миникап» → заказчик → когда → где →
 * оплата → ответственный/гости/комментарий; липкая кнопка «Создать · 15 000 ₽».
 * При правке клуб↔выезд переключаются, миникап остаётся миникапом. Название клуба =
 * имя заказчика, выезда = адрес; своё название — только у миникапа.
 */
import React, { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useToast } from '@/components/Toast'
import { Button, Chip, INP, LBL, Sheet } from '@/components/manage/DesignSystem'
import { Segments } from '@/components/manage/goods/parts'
import { KIND_LOOK, apiErrorText, rub, type EventItem, type EventKind, type EventRate, type SpaceInfo, type StaffInfo } from './lib'
import { blankForm, buildPayload, formFromEvent, formTotal, validateForm, type EventFormState } from './formModel'
import { FormCustomer } from './FormCustomer'
import { FormWhen } from './FormWhen'
import { FormWhere } from './FormWhere'
import { FormPayment } from './FormPayment'
import { FormError, FormSection } from './ui'

/** Фон шторки — у липкой кнопки, чтобы контент не просвечивал под ней. */
const SHEET_BG = 'rgb(29, 24, 40)'

interface EventFormProps {
  open: boolean
  /** null — создание нового. */
  editEvent: EventItem | null
  onClose: () => void
  /** Создан миникап — открываем его состав. */
  onMinicapCreated: (ev: EventItem) => void
  spaces: SpaceInfo[]
  staff: StaffInfo[]
  rates: EventRate[]
}

const kindItems = (kinds: EventKind[]) => kinds.map(k => ({ key: k, label: KIND_LOOK[k].label, icon: KIND_LOOK[k].icon }))

function StaffPicker({ form, set, staff }: { form: EventFormState; set: (p: Partial<EventFormState>) => void; staff: StaffInfo[] }) {
  return (
    <FormSection title={`Ответственный${form.kind === 'exit' ? ' *' : ''}`}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {staff.map(s => {
          const active = form.responsibleStaffId === s.id
          return <Chip key={s.id} icon="person" active={active} onClick={() => set({ responsibleStaffId: active ? '' : s.id })}>{s.nickname}</Chip>
        })}
      </div>
    </FormSection>
  )
}

export function EventForm({ open, editEvent, onClose, onMinicapCreated, spaces, staff, rates }: EventFormProps) {
  const qc = useQueryClient()
  const { show } = useToast()
  const [form, setForm] = useState<EventFormState>(() => (editEvent ? formFromEvent(editEvent) : blankForm()))
  const [error, setError] = useState<string | null>(null)
  // Каждое открытие — свежее состояние (новое или из редактируемого события).
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) { setForm(editEvent ? formFromEvent(editEvent) : blankForm()); setError(null) }
  }
  const set = (patch: Partial<EventFormState>) => setForm(p => ({ ...p, ...patch }))

  const isEdit = !!editEvent
  const fail = (e: Error) => setError(apiErrorText(e, 'Не удалось сохранить'))
  const create = useMutation({
    mutationFn: (v: { body: Record<string, unknown>; kind: EventKind }) => api.post<{ event: EventItem }>('/events', v.body),
    onSuccess: (r, v) => {
      qc.invalidateQueries({ queryKey: ['events'] })
      onClose()
      if (v.kind === 'minicap' && r?.event) onMinicapCreated(r.event)
      else show('Мероприятие создано', 'success')
    },
    onError: fail,
  })
  const save = useMutation({
    mutationFn: (v: { id: string; body: Record<string, unknown> }) => api.patch(`/events/${v.id}`, v.body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['events'] }); onClose(); show('Изменения сохранены', 'success') },
    onError: fail,
  })
  const saving = create.isPending || save.isPending

  function submit() {
    const err = validateForm(form)
    if (err) { setError(err); return }
    setError(null)
    const body = buildPayload(form, isEdit)
    if (editEvent) save.mutate({ id: editEvent.id, body })
    else create.mutate({ body, kind: form.kind })
  }

  const total = formTotal(form, rates, spaces)
  const submitLabel = isEdit ? 'Сохранить' : total ? `Создать · ${total.approx ? '≈ ' : ''}${rub(total.amount)}` : 'Создать'
  const isMinicap = form.kind === 'minicap'
  const kinds: EventKind[] | null = !isEdit ? ['titan', 'exit', 'minicap'] : isMinicap ? null : ['titan', 'exit']
  const title = !isEdit ? 'Новое мероприятие' : isMinicap ? 'Редактировать миникап' : 'Редактировать мероприятие'

  return (
    <Sheet open={open} onClose={onClose} title={title} initialHeight="92dvh" maxHeight="92dvh">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
        {kinds && <Segments value={form.kind} onChange={(k: EventKind) => { set({ kind: k }); setError(null) }} items={kindItems(kinds)} />}

        {isMinicap ? (
          <div>
            <label style={LBL} htmlFor="ev-title">Название миникапа *</label>
            <input id="ev-title" value={form.title} onChange={e => set({ title: e.target.value })} placeholder="Напр. Миникап #12" style={INP} />
          </div>
        ) : (
          <FormSection title="Заказчик">
            <FormCustomer form={form} set={set} required={form.kind === 'titan'} />
          </FormSection>
        )}

        <FormWhen form={form} set={set} />
        <FormWhere form={form} set={set} spaces={spaces} editId={editEvent?.id ?? null} />
        <FormPayment form={form} set={set} rates={rates} spaces={spaces} />

        {!isMinicap && (
          <>
            <StaffPicker form={form} set={set} staff={staff} />
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 120px', minWidth: 0 }}>
                <label style={LBL} htmlFor="ev-guests">Гостей</label>
                <input id="ev-guests" type="number" inputMode="numeric" min={1} value={form.maxGuests} onChange={e => set({ maxGuests: e.target.value })} placeholder="—" style={INP} />
              </div>
              <div style={{ flex: '3 1 220px', minWidth: 0 }}>
                <label style={LBL} htmlFor="ev-comment">Комментарий</label>
                <textarea id="ev-comment" rows={1} value={form.comment} onChange={e => set({ comment: e.target.value })} placeholder="Необязательно" style={{ ...INP, resize: 'vertical', fontFamily: 'inherit' }} />
              </div>
            </div>
          </>
        )}

        {/* Липкая кнопка: у области прокрутки Sheet большой нижний отступ (под плавающую
            навигацию), и sticky с bottom:0 повисал на высоте этого отступа над низом шторки.
            Компенсируем отступ — кнопка прижата к низу шторки. */}
        <div style={{ position: 'sticky', bottom: 'calc(-24px - var(--bottom-nav-clear, 96px))', zIndex: 5, margin: '0 -22px', padding: '12px 22px calc(12px + env(safe-area-inset-bottom))', background: SHEET_BG, borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <FormError text={error} />
          <Button size="lg" fullWidth icon={isEdit ? 'save' : 'add'} loading={saving} onClick={submit}>{saving ? 'Сохраняем…' : submitLabel}</Button>
        </div>
      </div>
    </Sheet>
  )
}
