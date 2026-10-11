'use client'
/**
 * Мелкие элементы раздела «Мероприятия»: подпись секции формы, точка статуса,
 * плитка выбора (зона с занятостью), строка сведений, плашка ошибки, «⋯».
 * Стиль — «тихая роскошь»: один violet-акцент, цвет только смысловой.
 */
import React from 'react'
import { Icon } from '@/components/Icon'
import { LBL } from '@/components/manage/DesignSystem'
import { MUTED, STATUS_LOOK, type EventStatus } from './lib'

export function FormSection({ title, hint, children }: { title: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <p style={{ ...LBL, margin: 0 }}>{title}</p>
      {children}
      {hint && <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.45, color: MUTED }}>{hint}</p>}
    </section>
  )
}

export function StatusDot({ status, size = 8 }: { status: EventStatus; size?: number }) {
  const look = STATUS_LOOK[status] ?? STATUS_LOOK.planned
  return <span aria-label={look.label} title={look.label} style={{ width: size, height: size, borderRadius: '50%', background: look.color, flexShrink: 0, display: 'inline-block' }} />
}

/** Точка + подпись статуса (для просмотра события). */
export function StatusLine({ status }: { status: EventStatus }) {
  const look = STATUS_LOOK[status] ?? STATUS_LOOK.planned
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 600, color: look.color }}>
      <StatusDot status={status} />{look.label}
    </span>
  )
}

/** Плитка выбора с подписью (зона: «свободна» / «занята 18:00–21:00»). */
export function ChoiceTile({ active, onClick, title, caption, captionColor }: {
  active: boolean
  onClick: () => void
  title: string
  caption?: string
  captionColor?: string
}) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      style={{
        minHeight: 56, padding: '10px 12px', borderRadius: 14, cursor: 'pointer', textAlign: 'left',
        display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 3, minWidth: 0,
        border: active ? '1.5px solid var(--primary-violet)' : '1px solid rgba(255,255,255,0.1)',
        background: active ? 'rgba(139,92,246,0.14)' : 'rgba(255,255,255,0.04)',
        color: 'var(--on-surface)', WebkitTapHighlightColor: 'transparent', touchAction: 'manipulation',
        transition: 'background 0.15s, border-color 0.15s',
      }}>
      <span style={{ fontSize: 14, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
      {caption && <span style={{ fontSize: 11.5, color: captionColor ?? MUTED, fontVariantNumeric: 'tabular-nums', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{caption}</span>}
    </button>
  )
}

/** Строка сведений «Подпись — значение» внутри карточки. */
export function InfoRow({ icon, label, children }: { icon: string; label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 16px' }}>
      <Icon name={icon} size={18} color={MUTED} style={{ marginTop: 1 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: 12, color: MUTED }}>{label}</p>
        <div style={{ marginTop: 2, fontSize: 14.5, fontWeight: 600, color: 'var(--on-surface)', lineHeight: 1.4, overflowWrap: 'anywhere' }}>{children}</div>
      </div>
    </div>
  )
}

export function FormError({ text }: { text: string | null }) {
  if (!text) return null
  return (
    <div role="alert" style={{ padding: '11px 14px', borderRadius: 12, background: 'rgba(251,113,133,0.1)', border: '1px solid rgba(251,113,133,0.3)', color: 'var(--danger)', fontSize: 13, lineHeight: 1.4, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
      <Icon name="error" size={16} style={{ marginTop: 1 }} />{text}
    </div>
  )
}

/** Иконка «⋯» (в общем наборе иконок её нет). */
export function DotsIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ flexShrink: 0 }}>
      <circle cx="5" cy="12" r="1.8" fill="currentColor" />
      <circle cx="12" cy="12" r="1.8" fill="currentColor" />
      <circle cx="19" cy="12" r="1.8" fill="currentColor" />
    </svg>
  )
}
