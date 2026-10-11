'use client'
/**
 * Вкладки раздела «Товары»: Меню (что продаём), Ингредиенты (из чего собираем блюда),
 * Склад (что меняет остатки и что заканчивается). Одно действие — одно место: приход,
 * списание и ревизию начинают только на «Складе».
 */
import React, { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Icon } from '@/components/Icon'
import { StateView } from '@/components/StateView'
import { useToast } from '@/components/Toast'
import { ConfirmDialog, formatMoney } from '@/components/manage/DesignSystem'
import { Card, ChipRow, DOC_LOOK, DocRow, MenuRow, SearchField, StockRow, docTitle } from './parts'
import {
  LEVEL_LOOK, isMenuItem, isStockItem, isTariffCategory, matches, plural, refreshGoods, stockLevel, useGoodsDocuments,
  type Catalog, type GoodsDocument, type GoodsItem,
} from '@/lib/goods'

const NONE = 'none'

function CatChip({ label, color, active, onClick }: { label: string; color?: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} aria-pressed={active}
      style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 7, minHeight: 36, padding: '0 14px', borderRadius: 999, cursor: 'pointer', fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap', border: active ? '1px solid transparent' : '1px solid rgba(255,255,255,0.1)', background: active ? 'var(--primary-violet)' : 'rgba(255,255,255,0.05)', color: active ? '#fff' : 'var(--on-surface-variant)' }}>
      {color && <span style={{ width: 8, height: 8, borderRadius: 4, background: active ? '#fff' : color }} />}
      {label}
    </button>
  )
}

export function MenuTab({ catalog, category, onCategory }: { catalog: Catalog; category: string | null; onCategory: (id: string | null) => void }) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const categories = useMemo(() => catalog.categories.filter(c => !isTariffCategory(c)), [catalog.categories])
  const items = useMemo(() => catalog.items.filter(isMenuItem), [catalog.items])
  const known = useMemo(() => new Set(categories.map(c => c.id)), [categories])
  const keyOf = (i: GoodsItem) => (i.category && known.has(i.category) ? i.category : NONE)
  const count = (id: string) => items.filter(i => keyOf(i) === id).length
  const groups = [...categories.map(c => ({ id: c.id, title: c.name })), { id: NONE, title: 'Без категории' }]
    .map(g => ({ ...g, items: items.filter(i => keyOf(i) === g.id && matches(i, q) && (!category || category === g.id)) }))
    .filter(g => g.items.length > 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <SearchField value={query} onChange={setQuery} placeholder="Название или тег" />
      {categories.length > 0 && (
        <ChipRow>
          <CatChip label={`Все · ${items.length}`} active={!category} onClick={() => onCategory(null)} />
          {categories.map(c => <CatChip key={c.id} label={`${c.name} · ${count(c.id)}`} color={c.color?.startsWith('#') ? c.color : undefined} active={category === c.id} onClick={() => onCategory(category === c.id ? null : c.id)} />)}
          {count(NONE) > 0 && <CatChip label={`Без категории · ${count(NONE)}`} active={category === NONE} onClick={() => onCategory(category === NONE ? null : NONE)} />}
        </ChipRow>
      )}
      {groups.length === 0
        ? <StateView state="empty" icon={q ? 'search_off' : 'restaurant_menu'} title={q || category ? 'Ничего не нашли' : 'Меню пустое'} description={q || category ? 'Измените запрос или категорию.' : 'Добавьте категорию и первую позицию кнопкой «Создать».'} />
        : groups.map(g => (
          <Card key={g.id} title={`${g.title} · ${g.items.length} ${plural(g.items.length, ['позиция', 'позиции', 'позиций'])}`}>
            {g.items.map(i => <MenuRow key={i.id} item={i} catalog={catalog} onClick={() => router.push(`/manage/goods/item/${i.id}`)} />)}
          </Card>
        ))}
      <p style={{ margin: 0, fontSize: 12, color: 'var(--on-surface-variant)', padding: '0 4px' }}>Цена, место в меню и учёт на складе — в карточке позиции. Тарифы гостей — в «Тарифах и аренде».</p>
    </div>
  )
}

export type StockFilter = 'all' | 'low' | 'out'

/** Сколько блюд собирается из каждого ингредиента — подпись «в 3 блюдах». */
function useUsage(catalog: Catalog) {
  return useMemo(() => {
    const m = new Map<string, number>()
    for (const i of catalog.items) for (const l of i.recipe) m.set(l.componentId, (m.get(l.componentId) ?? 0) + 1)
    return m
  }, [catalog.items])
}

/** Вкладка «Ингредиенты»: из чего собираются блюда — остаток, фасовка, в скольких блюдах. */
export function IngredientsTab({ catalog }: { catalog: Catalog }) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const usage = useUsage(catalog)
  const ingredients = useMemo(() => catalog.items.filter(i => i.kind === 'ingredient').sort((a, b) => a.name.localeCompare(b.name, 'ru')), [catalog.items])
  const visible = ingredients.filter(i => matches(i, q))

  if (ingredients.length === 0) {
    return <StateView state="empty" icon="inventory_2" title="Ингредиентов пока нет" description="Ингредиент — то, из чего собирается блюдо: наггетсы, соус, зёрна, молоко, табак. Добавьте первый кнопкой «Ингредиент», затем укажите его в составе блюда." />
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <SearchField value={query} onChange={setQuery} placeholder="Наггетсы, соус, молоко…" />
      {visible.length === 0
        ? <StateView state="empty" icon="search_off" title="Ничего не нашли" description="Измените запрос." />
        : (
          <Card title={`${visible.length} ${visible.length === ingredients.length ? 'всего' : 'найдено'}`} footer="Продажа блюда сама списывает его ингредиенты. Пополнить — «Приход» во вкладке «Склад».">
            {visible.map(i => <StockRow key={i.id} item={i} usedIn={usage.get(i.id) ?? 0} onClick={() => router.push(`/manage/goods/item/${i.id}`)} />)}
          </Card>
        )}
    </div>
  )
}

function Counter({ label, value, color, active, onClick }: { label: string; value: number; color: string; active: boolean; onClick: () => void }) {
  const disabled = value === 0 && !active
  return (
    <button onClick={onClick} aria-pressed={active} disabled={disabled}
      style={{ flex: 1, minHeight: 64, padding: '10px 14px', borderRadius: 14, border: 'none', cursor: disabled ? 'default' : 'pointer', textAlign: 'left', background: active ? color : 'rgba(255,255,255,0.05)', display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: 22, fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: active ? '#fff' : value > 0 ? color : 'var(--on-surface-variant)' }}>{value}</span>
      <span style={{ fontSize: 12, color: active ? '#fff' : 'var(--on-surface-variant)' }}>{label}</span>
    </button>
  )
}

/**
 * Вкладка «Склад»: стоимость остатков и счётчики «заканчивается / нет» (нажатие —
 * список этих позиций), ниже — приход, списание, ревизия, черновики и история.
 */
export function WarehouseTab({ catalog, filter, onFilter }: { catalog: Catalog; filter: StockFilter; onFilter: (f: StockFilter) => void }) {
  const router = useRouter()
  const usage = useUsage(catalog)
  const stock = useMemo(() => catalog.items.filter(isStockItem), [catalog.items])
  const summary = useMemo(() => stock.reduce((s, i) => {
    const level = stockLevel(i)
    return { value: s.value + Math.max(0, i.stockQuantity) * i.costPrice, low: s.low + (level === 'low' ? 1 : 0), out: s.out + (level === 'out' ? 1 : 0) }
  }, { value: 0, low: 0, out: 0 }), [stock])
  const shown = filter === 'all' ? [] : stock.filter(i => stockLevel(i) === filter).sort((a, b) => a.name.localeCompare(b.name, 'ru'))
  const toggle = (f: StockFilter) => onFilter(filter === f ? 'all' : f)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div className="glass-l2" style={{ borderRadius: 18, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--on-surface-variant)' }}>На складе по себестоимости</p>
          <p style={{ margin: '2px 0 0', fontSize: 26, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{formatMoney(summary.value)}</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Counter label="Заканчивается" value={summary.low} color={LEVEL_LOOK.low.color} active={filter === 'low'} onClick={() => toggle('low')} />
          <Counter label="Нет на складе" value={summary.out} color={LEVEL_LOOK.out.color} active={filter === 'out'} onClick={() => toggle('out')} />
        </div>
      </div>
      {shown.length > 0 && (
        <Card title={filter === 'low' ? 'Заканчивается' : 'Нет на складе'} footer="Сотрудникам приходит уведомление, когда остаток доходит до точки заказа. Дозаказать всё сразу — в приходе, кнопкой «Добавить заканчивающиеся».">
          {shown.map(i => <StockRow key={i.id} item={i} usedIn={usage.get(i.id)} onClick={() => router.push(`/manage/goods/item/${i.id}`)} />)}
        </Card>
      )}
      <Operations />
    </div>
  )
}

const dayKey = new Intl.DateTimeFormat('ru-RU', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Europe/Moscow' })
const dayTitle = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: 'Europe/Moscow' })
function dayLabel(date: Date): string {
  const key = dayKey.format(date)
  if (key === dayKey.format(new Date())) return 'Сегодня'
  if (key === dayKey.format(new Date(Date.now() - 86400000))) return 'Вчера'
  return dayTitle.format(date)
}

/** Куда ведёт документ: черновик — в редактор, проведённый — на просмотр. */
export function docHref(doc: Pick<GoodsDocument, 'type' | 'id' | 'status'>): string {
  const page = doc.type === 'write_off' ? 'write-off' : doc.type
  return doc.status === 'draft' ? `/manage/goods/${page}?draft=${doc.id}` : `/manage/goods/doc?type=${doc.type}&id=${doc.id}`
}

function Tile({ type, onClick }: { type: keyof typeof DOC_LOOK; onClick: () => void }) {
  const look = DOC_LOOK[type]
  return (
    <button onClick={onClick} className="glass-l2"
      style={{ flex: 1, minHeight: 92, borderRadius: 18, border: '1px solid rgba(255,255,255,0.08)', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, color: 'var(--on-surface)' }}>
      <span style={{ width: 40, height: 40, borderRadius: 20, background: look.color, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name={look.icon} size={20} color="#fff" /></span>
      <span style={{ fontSize: 13, fontWeight: 700 }}>{look.label}</span>
    </button>
  )
}

/** Операции склада: три действия (единственное место, где их начинают), черновики, история по дням. */
function Operations() {
  const router = useRouter()
  const qc = useQueryClient()
  const { show } = useToast()
  const documents = useGoodsDocuments()
  const [removing, setRemoving] = useState<GoodsDocument | null>(null)
  const [busy, setBusy] = useState(false)
  const list = useMemo(() => documents.data ?? [], [documents.data])
  const drafts = list.filter(d => d.status === 'draft')
  const history = useMemo(() => {
    const days: { title: string; docs: GoodsDocument[] }[] = []
    for (const d of list) {
      if (d.status === 'draft') continue
      const title = dayLabel(new Date(d.createdAt))
      const last = days[days.length - 1]
      if (last?.title === title) last.docs.push(d)
      else days.push({ title, docs: [d] })
    }
    return days
  }, [list])

  const removeDraft = async () => {
    if (!removing) return
    setBusy(true)
    try {
      const path = removing.type === 'supply' ? `/supplies/${removing.id}` : removing.type === 'write_off' ? `/goods/write-offs/${removing.id}` : `/inventory/revisions/${removing.id}`
      await api.delete(path)
      refreshGoods(qc)
      show('Черновик удалён', 'success')
      setRemoving(null)
    } catch (e) {
      show(e instanceof Error ? e.message : 'Не удалось удалить', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', gap: 10 }}>
        <Tile type="supply" onClick={() => router.push('/manage/goods/supply')} />
        <Tile type="write_off" onClick={() => router.push('/manage/goods/write-off')} />
        <Tile type="revision" onClick={() => router.push('/manage/goods/revision')} />
      </div>
      {drafts.length > 0 && (
        <Card title={`Не проведено · ${drafts.length}`} footer="Черновики сохраняются сами — можно уйти и вернуться позже.">
          {drafts.map(d => (
            <div key={`${d.type}-${d.id}`} style={{ display: 'flex', alignItems: 'center' }}>
              <div style={{ flex: 1, minWidth: 0 }}><DocRow doc={d} onClick={() => router.push(docHref(d))} /></div>
              <button onClick={() => setRemoving(d)} aria-label="Удалить черновик" style={{ width: 44, height: 44, marginRight: 8, borderRadius: 12, border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--danger)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="delete" size={18} /></button>
            </div>
          ))}
        </Card>
      )}
      {documents.isLoading ? <StateView state="loading" />
        : documents.isError && list.length === 0 ? <StateView state="error" title="Нет связи" description={documents.error.message} />
        : history.length === 0 ? <StateView state="empty" icon="history" title="Операций ещё не было" description="Проведите приход — остатки и себестоимость обновятся сами." />
        : history.map(day => (
          <Card key={day.title} title={day.title}>
            {day.docs.map(d => <DocRow key={`${d.type}-${d.id}`} doc={d} onClick={() => router.push(docHref(d))} />)}
          </Card>
        ))}
      <ConfirmDialog open={!!removing} onClose={() => setRemoving(null)} onConfirm={() => void removeDraft()} title="Удалить черновик?" message={removing ? `${docTitle(removing)} — остатки не изменятся.` : undefined} confirmLabel="Удалить" danger loading={busy} />
    </div>
  )
}
