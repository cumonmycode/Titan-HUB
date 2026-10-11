'use client'
/**
 * «Расходы» — отдельный раздел рядом с «Зарплатой» (раньше вкладка «Склада», вынесены
 * 2026-10-08): аренда, коммуналка, маркетинг, расходники. К товарам не относятся.
 */
import React, { useState } from 'react'
import { PageHeader } from '@/components/manage/DesignSystem'
import { ExpensesTab } from '@/app/dashboard/ExpensesTab'

// Дата по МСК (YYYY-MM-DD) со сдвигом на N дней назад.
function mskDate(daysAgo: number): string {
  return new Date(Date.now() + 3 * 3600 * 1000 - daysAgo * 86400000).toISOString().slice(0, 10)
}
function monthStart(): string {
  const d = new Date(Date.now() + 3 * 3600 * 1000)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`
}
type Preset = 'today' | 'week' | 'month' | 'd30'
const PRESETS: { key: Preset; label: string }[] = [
  { key: 'today', label: 'Сегодня' }, { key: 'week', label: 'Неделя' },
  { key: 'month', label: 'Месяц' }, { key: 'd30', label: '30 дней' },
]
function rangeOf(p: Preset): { from: string; to: string } {
  const to = mskDate(0)
  if (p === 'today') return { from: to, to }
  if (p === 'week') return { from: mskDate(6), to }
  if (p === 'month') return { from: monthStart(), to }
  return { from: mskDate(29), to }
}

export default function ExpensesPage() {
  const [preset, setPreset] = useState<Preset>('d30')
  const { from, to } = rangeOf(preset)
  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <PageHeader title="Расходы" subtitle="Аренда, коммуналка, маркетинг, расходники" />
      <div style={{ padding: '16px 16px var(--bottom-nav-clear, 24px)', flex: 1, maxWidth: 'var(--content-narrow)', margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2, marginBottom: 14 }}>
          {PRESETS.map(p => (
            <button key={p.key} onClick={() => setPreset(p.key)} aria-pressed={preset === p.key}
              style={{ flexShrink: 0, fontSize: 12, fontWeight: 700, padding: '6px 12px', borderRadius: 999, cursor: 'pointer', border: '1px solid ' + (preset === p.key ? 'rgba(139,92,246,0.5)' : 'rgba(255,255,255,0.1)'), background: preset === p.key ? 'rgba(139,92,246,0.18)' : 'rgba(255,255,255,0.04)', color: preset === p.key ? '#a78bfa' : 'var(--on-surface-variant)' }}>
              {p.label}
            </button>
          ))}
        </div>
        <ExpensesTab from={from} to={to} />
      </div>
    </div>
  )
}
