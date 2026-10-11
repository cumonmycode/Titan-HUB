'use client'
/**
 * Категории меню (шторка): список с перетаскиванием (за ручку — мышью сразу, пальцем
 * после удержания, как раньше), правка названия, значка и видимости в Titan Home,
 * порядок позиций внутри категории. Категория «Тарифы» живёт в «Тарифах и аренде».
 */
import React, { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { DndContext, MouseSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { api } from '@/lib/api'
import { useAuthStore } from '@/store/auth.store'
import { useToast } from '@/components/Toast'
import { Icon } from '@/components/Icon'
import { CAT_PRESETS, CategoryIcon } from '@/components/CategoryIcon'
import { Sheet, Button, ConfirmDialog, ToggleRow, FormField, INP } from '@/components/manage/DesignSystem'
import { isMenuItem, isTariffCategory, plural, refreshGoods, type Catalog, type GoodsCategory } from '@/lib/goods'

type View = { kind: 'list' } | { kind: 'edit'; category: GoodsCategory | null }

function SortableRow({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1, display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 14, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
      <span {...attributes} {...listeners} aria-label="Перетащить" style={{ cursor: 'grab', display: 'flex', color: 'var(--on-surface-variant)', touchAction: 'none' }}><Icon name="drag_indicator" size={18} /></span>
      {children}
    </div>
  )
}

function useSensorsHold() {
  return useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
  )
}

export function CategoriesSheet({ open, catalog, onClose }: { open: boolean; catalog: Catalog; onClose: () => void }) {
  const [view, setView] = useState<View>({ kind: 'list' })
  const close = () => { setView({ kind: 'list' }); onClose() }
  return (
    <Sheet open={open} onClose={close} title={view.kind === 'list' ? 'Категории' : view.category ? view.category.name : 'Новая категория'} desktopSize="md" initialHeight="80dvh">
      {view.kind === 'list'
        ? <CategoryList catalog={catalog} onEdit={c => setView({ kind: 'edit', category: c })} />
        : <CategoryForm key={view.category?.id ?? 'new'} category={view.category} catalog={catalog} onBack={() => setView({ kind: 'list' })} />}
    </Sheet>
  )
}

function CategoryList({ catalog, onEdit }: { catalog: Catalog; onEdit: (c: GoodsCategory | null) => void }) {
  const qc = useQueryClient()
  const { show } = useToast()
  const sensors = useSensorsHold()
  const visible = catalog.categories.filter(c => !isTariffCategory(c))
  const [order, setOrder] = useState(visible.map(c => c.id))
  const ids = order.filter(id => visible.some(c => c.id === id)).concat(visible.filter(c => !order.includes(c.id)).map(c => c.id))
  const count = (id: string) => catalog.items.filter(i => isMenuItem(i) && i.category === id).length

  const onDragEnd = async (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return
    const next = arrayMove(ids, ids.indexOf(String(e.active.id)), ids.indexOf(String(e.over.id)))
    setOrder(next)
    // «Тарифы» скрыты — оставляем их в конце, как раньше.
    const tail = catalog.categories.filter(c => isTariffCategory(c)).map(c => c.id)
    try {
      await api.patch('/menu/categories/reorder', { items: [...next, ...tail].map((id, i) => ({ id, sortOrder: i })) })
      refreshGoods(qc)
    } catch (err) { show(err instanceof Error ? err.message : 'Порядок не сохранён', 'error') }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={e => void onDragEnd(e)}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          {ids.map(id => {
            const c = visible.find(x => x.id === id)!
            const n = count(id)
            return (
              <SortableRow key={id} id={id}>
                <CategoryIcon icon={c.icon} size={22} color={c.color?.startsWith('#') ? c.color : undefined} />
                <button onClick={() => onEdit(c)} style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', color: 'var(--on-surface)', cursor: 'pointer', textAlign: 'left', padding: 0 }}>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 15, fontWeight: 600 }}>{c.name}</span>
                    {c.isTabletVisible === false && <span style={{ fontSize: 12, color: 'var(--on-surface-variant)' }}>скрыта в Titan Home</span>}
                  </span>
                  <span style={{ fontSize: 13, color: 'var(--on-surface-variant)' }}>{n} {plural(n, ['позиция', 'позиции', 'позиций'])}</span>
                  <Icon name="chevron_right" size={16} color="var(--on-surface-variant)" />
                </button>
              </SortableRow>
            )
          })}
        </SortableContext>
      </DndContext>
      <Button variant="secondary" icon="add" fullWidth onClick={() => onEdit(null)}>Новая категория</Button>
      <p style={{ margin: 0, fontSize: 12, color: 'var(--on-surface-variant)' }}>Тяните за ручку слева — так же категории пойдут в кассе и у гостей.</p>
    </div>
  )
}

function CategoryForm({ category, catalog, onBack }: { category: GoodsCategory | null; catalog: Catalog; onBack: () => void }) {
  const qc = useQueryClient()
  const { show } = useToast()
  const sensors = useSensorsHold()
  const isOwner = useAuthStore(s => s.user?.role) === 'owner'
  const preset = CAT_PRESETS.find(p => p.id === category?.icon)
  const [name, setName] = useState(category?.name ?? '')
  const [icon, setIcon] = useState(category?.icon && preset ? category.icon : 'food')
  const [color, setColor] = useState(category?.color?.startsWith('#') ? category.color : (preset?.color ?? '#10B981'))
  const [tablet, setTablet] = useState(category?.isTabletVisible ?? true)
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const items = category ? catalog.items.filter(i => isMenuItem(i) && i.category === category.id) : []
  const [itemOrder, setItemOrder] = useState(items.map(i => i.id))

  const run = async (fn: () => Promise<unknown>, ok: string, back = true) => {
    setBusy(true)
    try { await fn(); refreshGoods(qc); show(ok, 'success'); if (back) onBack() }
    catch (e) { show(e instanceof Error ? e.message : 'Не сохранилось', 'error') }
    finally { setBusy(false) }
  }
  const save = () => {
    const body = { name: name.trim(), icon, color, isTabletVisible: tablet }
    void run(() => (category ? api.patch(`/menu/categories/${category.id}`, body) : api.post('/menu/categories', body)), category ? 'Категория сохранена' : 'Категория добавлена')
  }
  const onItemDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return
    const next = arrayMove(itemOrder, itemOrder.indexOf(String(e.active.id)), itemOrder.indexOf(String(e.over.id)))
    setItemOrder(next)
    // Переставляем только позиции категории; места остальных в общем порядке сохраняются.
    const all = [...catalog.items].sort((a, b) => a.sortOrder - b.sortOrder).map(i => i.id)
    const subset = new Set(next)
    const queue = [...next]
    const merged = all.map(id => (subset.has(id) ? queue.shift()! : id))
    void run(() => api.patch('/menu/items/reorder', { items: merged.map((id, i) => ({ id, sortOrder: i })) }), 'Порядок сохранён', false)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <button onClick={onBack} style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', color: 'var(--on-surface-variant)', cursor: 'pointer', fontSize: 13, padding: 0 }}><Icon name="chevron_left" size={16} />Все категории</button>
      <FormField label="Название"><input value={name} onChange={e => setName(e.target.value)} placeholder="Например, Горячие напитки" style={INP} autoFocus={!category} maxLength={60} /></FormField>
      <FormField label="Значок">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(64px, 1fr))', gap: 8 }}>
          {CAT_PRESETS.map(p => (
            <button key={p.id} onClick={() => { setIcon(p.id); setColor(p.color); if (!name.trim()) setName(p.defaultName) }} aria-pressed={icon === p.id} title={p.defaultName}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '10px 4px', borderRadius: 12, cursor: 'pointer', border: icon === p.id ? `1px solid ${p.color}` : '1px solid rgba(255,255,255,0.08)', background: icon === p.id ? `${p.color}22` : 'rgba(255,255,255,0.03)', color: 'var(--on-surface)' }}>
              {p.svg(p.color, 22)}
              <span style={{ fontSize: 10.5, color: 'var(--on-surface-variant)' }}>{p.gridLabel}</span>
            </button>
          ))}
        </div>
      </FormField>
      <ToggleRow label="Показывать в Titan Home" subtitle="Категория видна гостям в меню кабинки" value={tablet} onChange={setTablet} />
      <Button fullWidth size="lg" icon="save" loading={busy} disabled={!name.trim()} onClick={save}>{category ? 'Сохранить' : 'Добавить категорию'}</Button>

      {category && items.length > 1 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--on-surface-variant)' }}>Порядок позиций</span>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onItemDragEnd}>
            <SortableContext items={itemOrder} strategy={verticalListSortingStrategy}>
              {itemOrder.map(id => <SortableRow key={id} id={id}><span style={{ fontSize: 14 }}>{catalog.byId.get(id)?.name}</span></SortableRow>)}
            </SortableContext>
          </DndContext>
        </div>
      )}

      {category && isOwner && (
        <>
          <Button variant="danger" icon="delete" fullWidth onClick={() => setConfirm(true)}>Удалить категорию</Button>
          <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} danger loading={busy} confirmLabel="Удалить" title={`Удалить «${category.name}»?`}
            message={items.length ? `${items.length} ${plural(items.length, ['позиция останется', 'позиции останутся', 'позиций останутся'])} без категории.` : undefined}
            onConfirm={() => void run(() => api.delete(`/menu/categories/${category.id}`), 'Категория удалена')} />
        </>
      )}
    </div>
  )
}
