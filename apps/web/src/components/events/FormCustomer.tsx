'use client'
/**
 * Заказчик: имя с автоподбором из справочника. Совпало с известным заказчиком —
 * телефон уже есть, поле не показываем; новый — просим телефон.
 */
import React, { useRef, useState } from 'react'
import { api } from '@/lib/api'
import { Icon } from '@/components/Icon'
import { INP, LBL } from '@/components/manage/DesignSystem'
import { MUTED } from './lib'
import type { EventFormState } from './formModel'

interface Customer { id: string; name: string | null; phone: string | null }

const sameName = (a: string | null | undefined, b: string) => (a ?? '').trim().toLowerCase() === b.trim().toLowerCase()

interface Props {
  form: EventFormState
  set: (patch: Partial<EventFormState>) => void
  required: boolean
}

export function FormCustomer({ form, set, required }: Props) {
  const [results, setResults] = useState<Customer[]>([])
  const [focused, setFocused] = useState(false)
  const latest = useRef('')

  async function search(q: string) {
    latest.current = q
    if (!q.trim()) { setResults([]); return }
    try {
      const res = await api.get<{ customers: Customer[] }>(`/customers?q=${encodeURIComponent(q)}`)
      if (latest.current !== q) return
      const list = res.customers ?? []
      setResults(list)
      const exact = list.find(c => sameName(c.name, q))
      if (exact) set({ customerKnown: true, customerPhone: exact.phone ?? '' })
    } catch { if (latest.current === q) setResults([]) }
  }

  function pick(c: Customer) {
    latest.current = c.name ?? ''
    set({ customerName: c.name ?? '', customerPhone: c.phone ?? '', customerKnown: true })
    setResults([]); setFocused(false)
  }

  const showPhone = form.customerName.trim() !== '' && !form.customerKnown
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ position: 'relative' }}>
        <label style={LBL} htmlFor="ev-customer">Имя заказчика{required ? ' *' : ''}</label>
        <input id="ev-customer" value={form.customerName} autoComplete="off"
          onChange={e => { set({ customerName: e.target.value, customerPhone: '', customerKnown: false }); search(e.target.value) }}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          placeholder="Имя контактного лица" style={INP} />
        {focused && results.length > 0 && (
          <div role="listbox" style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 40, marginTop: 4, borderRadius: 14, overflow: 'hidden', background: 'rgb(36, 30, 48)', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 12px 32px rgba(0,0,0,0.45)' }}>
            {results.map(c => (
              <button key={c.id} type="button" role="option" aria-selected={false} onMouseDown={e => e.preventDefault()} onClick={() => pick(c)}
                style={{ width: '100%', minHeight: 44, padding: '10px 14px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 10, color: 'var(--on-surface)', fontSize: 14.5 }}>
                <Icon name="person" size={16} color={MUTED} />
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name || 'Без имени'}</span>
                {c.phone && <span style={{ fontSize: 12.5, color: MUTED, fontVariantNumeric: 'tabular-nums' }}>{c.phone}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
      {form.customerKnown && form.customerPhone && (
        <p style={{ margin: 0, fontSize: 12.5, color: MUTED, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Icon name="check_circle" size={14} color="var(--success)" />Заказчик найден · {form.customerPhone}
        </p>
      )}
      {showPhone && (
        <div>
          <label style={LBL} htmlFor="ev-phone">Телефон</label>
          <input id="ev-phone" type="tel" inputMode="tel" value={form.customerPhone} onChange={e => set({ customerPhone: e.target.value })} placeholder="+7 900 000-00-00" style={INP} />
        </div>
      )}
    </div>
  )
}
