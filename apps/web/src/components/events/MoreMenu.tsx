'use client'
/**
 * Меню «⋯»: единственное место второстепенных действий события (правка, статус,
 * отмена, удаление). Всплывает под кнопкой, закрывается тапом вне меню или Esc.
 */
import React, { useEffect, useRef, useState } from 'react'
import { Icon } from '@/components/Icon'
import { Button } from '@/components/manage/DesignSystem'
import { DotsIcon } from './ui'

export interface MoreMenuItem {
  key: string
  label: string
  icon: string
  danger?: boolean
  onSelect: () => void
}

export function MoreMenu({ items }: { items: MoreMenuItem[] }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  if (!items.length) return null
  return (
    <div ref={rootRef} style={{ position: 'relative', flexShrink: 0 }}>
      <Button variant="secondary" size="sm" ariaLabel="Ещё действия" onClick={() => setOpen(o => !o)} style={{ width: 40, padding: 0 }}>
        <DotsIcon />
      </Button>
      {open && (
        <div role="menu" style={{
          position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 30, minWidth: 232,
          padding: 6, borderRadius: 16, background: 'rgb(36, 30, 48)', border: '1px solid rgba(255,255,255,0.1)',
          boxShadow: '0 16px 40px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column',
        }}>
          {items.map(it => (
            <button key={it.key} role="menuitem" type="button" className="ev-menu-item"
              onClick={() => { setOpen(false); it.onSelect() }}
              style={{
                display: 'flex', alignItems: 'center', gap: 12, minHeight: 44, padding: '0 12px', borderRadius: 10,
                border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left', fontSize: 14.5, fontWeight: 600,
                color: it.danger ? 'var(--danger)' : 'var(--on-surface)', WebkitTapHighlightColor: 'transparent',
              }}>
              <Icon name={it.icon} size={18} />{it.label}
            </button>
          ))}
          <style>{`.ev-menu-item:hover, .ev-menu-item:active { background: rgba(255,255,255,0.06) !important; }`}</style>
        </div>
      )}
    </div>
  )
}
