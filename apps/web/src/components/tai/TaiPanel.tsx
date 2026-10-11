'use client'
/**
 * Панель Tai поверх текущего экрана (касса, чек, аналитика): справа на широком экране,
 * во весь экран на телефоне. Tai знает, откуда открыт, — в чеке «добавь колу» уходит в
 * этот чек. Портал в body: экраны с transform не сдвигают fixed-слой.
 */
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTaiStore } from '@/store/tai.store'
import type { TaiContext } from '@/lib/tai'
import { Icon } from '@/components/Icon'
import { TaiChat } from './TaiChat'

export function TaiPanel() {
  const open = useTaiStore((s) => s.panelOpen)
  const close = useTaiStore((s) => s.closePanel)
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close])
  if (!mounted || !open) return null
  return createPortal(
    <div className="tai-panel-root" onClick={(e) => { if (e.target === e.currentTarget) close() }}>
      <aside className="tai-panel glass-l1" role="dialog" aria-label="Tai">
        <TaiChat onClose={close} />
      </aside>
      <style>{`
        .tai-panel-root { position: fixed; inset: 0; z-index: 120; background: rgba(10,8,14,0.45); display: flex; justify-content: flex-end; }
        .tai-panel { width: 100%; height: 100%; display: flex; flex-direction: column; background: rgba(21,18,27,0.98); animation: tai-panel-in 240ms cubic-bezier(0.22,1,0.36,1) both; }
        @media (min-width: 768px) { .tai-panel { width: 440px; border-left: 1px solid rgba(255,255,255,0.08); box-shadow: -12px 0 40px rgba(0,0,0,0.4); } }
        @keyframes tai-panel-in { from { transform: translateX(24px); opacity: 0 } to { transform: none; opacity: 1 } }
        @media (prefers-reduced-motion: reduce) { .tai-panel { animation: none } }
      `}</style>
    </div>,
    document.body,
  )
}

/** Кнопка ✦ Tai для шапок экранов: открывает панель с контекстом экрана. */
export function TaiButton({ context, label = 'Спросить Tai' }: { context: TaiContext; label?: string }) {
  const openPanel = useTaiStore((s) => s.openPanel)
  return (
    <button onClick={() => openPanel(context)} title={label} aria-label={label}
      style={{ width: 38, height: 38, borderRadius: 12, border: '1px solid rgba(139,92,246,0.35)', background: 'rgba(139,92,246,0.12)', color: 'var(--primary-violet)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}>
      <Icon name="auto_awesome" size={18} />
    </button>
  )
}
