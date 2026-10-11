'use client'
/**
 * Общее для документов склада (приход, списание, ревизия): каркас страницы, автосохранение
 * черновика и шторка выбора позиций. Черновик сохраняется сам — уйти со страницы можно в
 * любой момент, без диалога «Сохранить?».
 */
import React, { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Icon } from '@/components/Icon'
import { PageHeader, Sheet, Button } from '@/components/manage/DesignSystem'
import { LEVEL_LOOK, itemQty, isStockItem, isTariffCategory, matches, reorderQuantity, stockLevel, type Catalog, type GoodsItem } from '@/lib/goods'
import { SearchField } from './parts'

const DELAY_MS = 1200

/** Параметр адреса без useSearchParams (странице не нужен Suspense). */
export function queryParam(name: string): string | null {
  if (typeof window === 'undefined') return null
  return new URLSearchParams(window.location.search).get(name)
}

/**
 * Сохранить черновик через секунду после последней правки. `key` — отпечаток содержимого;
 * открытый черновик не пересохраняется, пока его не тронули. `flush` — дождаться начатого
 * сохранения перед проведением, чтобы не родился лишний черновик. Сохранения идут строго
 * по очереди (два запроса, не знающие id черновика, создали бы два черновика); правка,
 * не дождавшаяся таймера, сохраняется и при уходе со страницы.
 */
export function useAutosave(key: string, enabled: boolean, save: () => Promise<void>) {
  const saveRef = useRef(save)
  const initial = useRef(key)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inflight = useRef<Promise<void> | null>(null)
  // Есть правка, которая ждёт таймера и ещё не ушла на сервер.
  const pending = useRef(false)
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  useEffect(() => { saveRef.current = save })
  useEffect(() => {
    if (!enabled || key === initial.current) { pending.current = false; return }
    pending.current = true
    timer.current = setTimeout(() => {
      timer.current = null
      pending.current = false
      const latest = saveRef.current
      inflight.current = (inflight.current ?? Promise.resolve()).then(() => latest()).then(() => setSavedAt(new Date())).catch(() => { /* сохраним при следующей правке */ })
    }, DELAY_MS)
    return () => { if (timer.current) clearTimeout(timer.current); timer.current = null }
  }, [key, enabled])
  // Ушли со страницы раньше таймера — последняя правка всё равно уходит на сервер.
  useEffect(() => () => {
    if (!pending.current) return
    pending.current = false
    const latest = saveRef.current
    inflight.current = (inflight.current ?? Promise.resolve()).then(() => latest()).catch(() => { /* на сервере останется прежняя версия */ })
  }, [])
  const flush = async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    pending.current = false
    if (inflight.current) await inflight.current
  }
  return { savedAt, flush }
}

const timeFormat = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' })
export const savedNote = (savedAt: Date | null) => (savedAt ? `Черновик сохранён в ${timeFormat.format(savedAt)}.` : 'Черновик сохраняется сам.')

/** Каркас страницы документа: шапка с главным действием, колонка контента, итог внизу. */
export function DocShell({ title, subtitle, action, children }: { title: string; subtitle?: string; action?: { label: string; icon: string; onClick: () => void }; children: React.ReactNode }) {
  const router = useRouter()
  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <PageHeader title={title} subtitle={subtitle} action={action} onBack={() => router.push('/manage/goods?tab=warehouse')} />
      <div style={{ padding: '16px 16px var(--bottom-nav-clear, 24px)', maxWidth: 'var(--content-narrow)', margin: '0 auto', width: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 18 }}>
        {children}
      </div>
    </div>
  )
}

export function TotalRow({ label = 'Итого', value, note }: { label?: string; value: string; note?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="glass-l2" style={{ borderRadius: 18, padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 15, fontWeight: 700 }}>{label}</span>
        <span style={{ fontSize: 22, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
      </div>
      {note && <p style={{ margin: 0, padding: '0 4px', fontSize: 12, color: 'var(--on-surface-variant)' }}>{note}</p>}
    </div>
  )
}

/** Что можно добавить: приход и ревизия — то, что ведёт остаток; списать можно и порцию по составу. */
function candidates(mode: 'supply' | 'write_off', catalog: Catalog): GoodsItem[] {
  return catalog.items.filter(i => isStockItem(i) || (mode === 'write_off' && i.stockMode === 'recipe' && i.role !== 'tariff'))
}

/**
 * Выбор позиций в документ: отметьте нужное и «Добавить». В приходе — «Добавить
 * заканчивающиеся» (до целевого уровня) и затрата без карточки.
 */
export function PickSheet({ open, mode, catalog, present, onClose, onPick, onFree }: {
  open: boolean; mode: 'supply' | 'write_off'; catalog: Catalog; present: Set<string>
  onClose: () => void; onPick: (items: GoodsItem[]) => void; onFree?: (name: string) => void
}) {
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const q = query.trim().toLowerCase()
  const pool = candidates(mode, catalog)
  const low = pool.filter(i => isStockItem(i) && stockLevel(i) !== 'ok' && reorderQuantity(i) > 0 && !present.has(i.id))
  const categories = catalog.categories.filter(c => !isTariffCategory(c))
  const keyOf = (i: GoodsItem) => (i.kind === 'ingredient' ? 'raw' : i.category && categories.some(c => c.id === i.category) ? i.category : 'none')
  const groups = [{ id: 'raw', title: 'Ингредиенты' }, ...categories.map(c => ({ id: c.id, title: c.name })), { id: 'none', title: 'Без категории' }]
    .map(g => ({ ...g, items: pool.filter(i => keyOf(i) === g.id && matches(i, q)) })).filter(g => g.items.length > 0)
  const finish = (ids: string[]) => {
    onPick(ids.map(id => catalog.byId.get(id)).filter((i): i is GoodsItem => !!i))
    setPicked([]); setQuery(''); onClose()
  }
  const toggle = (id: string) => setPicked(p => (p.includes(id) ? p.filter(x => x !== id) : [...p, id]))

  return (
    <Sheet open={open} onClose={() => { setPicked([]); setQuery(''); onClose() }} title={mode === 'supply' ? 'Что пришло' : 'Что списать'} desktopSize="md" initialHeight="85dvh">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <SearchField value={query} onChange={setQuery} placeholder="Название или тег" />
        {mode === 'supply' && low.length > 0 && !q && (
          <Button variant="secondary" icon="add_shopping_cart" fullWidth onClick={() => finish(low.map(i => i.id))}>Добавить заканчивающиеся · {low.length}</Button>
        )}
        {groups.map(g => (
          <div key={g.id} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--on-surface-variant)', padding: '4px 4px 0' }}>{g.title}</span>
            {g.items.map(i => {
              const added = present.has(i.id)
              const checked = picked.includes(i.id)
              const level = stockLevel(i)
              return (
                <button key={i.id} disabled={added} onClick={() => toggle(i.id)} aria-pressed={checked}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 12, cursor: added ? 'default' : 'pointer', textAlign: 'left', border: `1px solid ${checked ? 'var(--primary-violet)' : 'rgba(255,255,255,0.07)'}`, background: checked ? 'rgba(139,92,246,0.12)' : 'rgba(255,255,255,0.03)', color: added ? 'var(--on-surface-variant)' : 'var(--on-surface)' }}>
                  <Icon name={added || checked ? 'check_circle' : 'radio_button_unchecked'} size={20} color={checked ? 'var(--primary-violet)' : 'var(--on-surface-variant)'} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 14.5, fontWeight: 600 }}>{i.name}</span>
                    <span style={{ fontSize: 12, color: added ? 'var(--on-surface-variant)' : level === 'ok' || i.stockMode === 'recipe' ? 'var(--on-surface-variant)' : LEVEL_LOOK[level].color }}>
                      {added ? 'уже в списке' : i.stockMode === 'recipe' ? 'по составу' : `на складе ${itemQty(i, i.stockQuantity)}`}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        ))}
        {groups.length === 0 && <p style={{ margin: 0, fontSize: 13, color: 'var(--on-surface-variant)' }}>{q ? 'Ничего не нашли.' : 'Нечего добавить: заведите ингредиент во вкладке «Ингредиенты» или включите учёт штуками у позиции меню.'}</p>}
        {q && mode === 'supply' && onFree && (
          <Button variant="ghost" icon="description" fullWidth onClick={() => { onFree(query.trim()); setQuery(''); onClose() }}>Затрата без карточки «{query.trim()}»</Button>
        )}
        <Button fullWidth size="lg" icon="add" disabled={picked.length === 0} onClick={() => finish(picked)}>{picked.length ? `Добавить ${picked.length}` : 'Добавить'}</Button>
      </div>
    </Sheet>
  )
}
