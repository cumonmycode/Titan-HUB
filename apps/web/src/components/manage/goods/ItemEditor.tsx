'use client'
/**
 * Редактор позиции меню или ингредиента (шторка). Позиция: главное сверху (название,
 * цена, категория), ниже «Состав» — есть строки, значит учёт по составу; остальное (где
 * продаётся, учёт штуками, теги, зона) свёрнуто в «Дополнительно». Ингредиент: в чём
 * считать, фасовка при закупке, точка заказа. Остаток здесь не меняется — только документами.
 */
import React, { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useAuthStore } from '@/store/auth.store'
import { useToast } from '@/components/Toast'
import { Icon } from '@/components/Icon'
import { Sheet, Button, ConfirmDialog, ToggleRow, FormField, INP, SEL } from '@/components/manage/DesignSystem'
import { QtyField, Segments, money } from './parts'
import {
  BIG_UNIT, PIECE_CHOICES, PIECE_NAMES, QUICK_UNITS, UNIT_CHOICES, bigWord, createItem, deleteItem, isStockItem, isTariffCategory, itemQty,
  margin, matches, numberText, packText, parseDecimal, recipeCost, refreshGoods, unitWord, updateItem,
  type Catalog, type GoodsItem, type ItemInput, type PieceName, type StockMode, type Unit,
} from '@/lib/goods'

export type EditorTarget = { kind: 'goods' | 'ingredient'; itemId?: string; presetCategory?: string | null }

type RecipeRow = { componentId: string; qty: string }

const toBase = (v: string, factor: number) => {
  const n = parseDecimal(v)
  return n === null || n === 0 ? null : Math.round(n * factor)
}
const text = (n: number | null | undefined, factor = 1) => (n ? numberText(n / factor) : '')
const hint: React.CSSProperties = { fontSize: 12, color: 'var(--on-surface-variant)', margin: '6px 0 0', lineHeight: 1.45 }
const heading: React.CSSProperties = { fontSize: 13, fontWeight: 700, color: 'var(--on-surface-variant)' }

export function ItemEditor({ target, catalog, onClose }: { target: EditorTarget | null; catalog: Catalog; onClose: () => void }) {
  const original = target?.itemId ? catalog.byId.get(target.itemId) ?? null : null
  const kind = original?.kind ?? target?.kind ?? 'goods'
  const title = kind === 'ingredient' ? (original ? 'Ингредиент' : 'Новый ингредиент') : original ? 'Позиция' : 'Новая позиция'
  return (
    <Sheet open={!!target} onClose={onClose} title={title} desktopSize="lg" initialHeight="85dvh">
      {target && (kind === 'ingredient'
        ? <IngredientForm key={original?.id ?? 'new-ing'} original={original} onDone={onClose} />
        : <ItemForm key={original?.id ?? 'new'} original={original} presetCategory={target.presetCategory ?? null} catalog={catalog} onDone={onClose} />)}
    </Sheet>
  )
}

function useSave(onDone: () => void) {
  const qc = useQueryClient()
  const { show } = useToast()
  const [busy, setBusy] = useState(false)
  const run = async (fn: () => Promise<unknown>, okText: string) => {
    setBusy(true)
    try {
      await fn()
      refreshGoods(qc)
      show(okText, 'success')
      onDone()
    } catch (e) {
      show(e instanceof Error ? e.message : 'Не сохранилось', 'error')
    } finally {
      setBusy(false)
    }
  }
  return { busy, run }
}

function DeleteBlock({ item, onDone }: { item: GoodsItem; onDone: () => void }) {
  const isOwner = useAuthStore(s => s.user?.role) === 'owner'
  const [confirm, setConfirm] = useState(false)
  const { busy, run } = useSave(onDone)
  if (!isOwner) return null
  return (
    <>
      <Button variant="danger" icon="delete" fullWidth onClick={() => setConfirm(true)}>{item.kind === 'ingredient' ? 'Удалить ингредиент' : 'Удалить позицию'}</Button>
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} danger loading={busy} confirmLabel="Удалить"
        title={`Удалить «${item.name}»?`}
        message={item.kind === 'ingredient' ? 'Ингредиент пропадёт из остатков. Если он в составе блюд — сначала уберите его оттуда.' : 'Позиция исчезнет из меню и кассы. Прошлые чеки сохранятся.'}
        onConfirm={() => void run(() => deleteItem(item.id), 'Удалено')} />
    </>
  )
}

/** Строка-раскрывашка «Дополнительно»: что внутри — второй строкой. */
function Disclosure({ title, summary, open, onToggle }: { title: string; summary: string; open: boolean; onToggle: () => void }) {
  return (
    <button onClick={onToggle} aria-expanded={open} className="glass-l2"
      style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', minHeight: 56, padding: '10px 16px', borderRadius: 16, border: '1px solid rgba(255,255,255,0.08)', cursor: 'pointer', textAlign: 'left', color: 'var(--on-surface)' }}>
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 15, fontWeight: 600 }}>{title}</span>
        {summary && <span style={{ fontSize: 12.5, color: 'var(--on-surface-variant)' }}>{summary}</span>}
      </span>
      <Icon name="expand_more" size={20} color="var(--on-surface-variant)" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
    </button>
  )
}

/* ─── Позиция меню ─────────────────────────────────────────────────────────── */

function ItemForm({ original, presetCategory, catalog, onDone }: { original: GoodsItem | null; presetCategory: string | null; catalog: Catalog; onDone: () => void }) {
  const { data: spacesData } = useQuery({ queryKey: ['spaces'], queryFn: () => api.get<{ spaces: { id: string; name: string }[] }>('/spaces') })
  const spaces = spacesData?.spaces ?? []
  const [name, setName] = useState(original?.name ?? '')
  const [price, setPrice] = useState(original ? numberText(original.price, 2) : '')
  const [category, setCategory] = useState<string | null>(original ? original.category : presetCategory)
  const [recipe, setRecipe] = useState<RecipeRow[]>((original?.recipe ?? []).map(l => ({ componentId: l.componentId, qty: String(l.quantity) })))
  const [flags, setFlags] = useState({ isActive: original?.isActive ?? true, isTabletVisible: original?.isTabletVisible ?? false, isScreenVisible: original?.isScreenVisible ?? true, isTop: original?.isTop ?? false })
  const [pieces, setPieces] = useState(original?.stockMode === 'pieces')
  const [reorder, setReorder] = useState(text(original?.reorderPoint))
  const [par, setPar] = useState(text(original?.parLevel))
  const [cost, setCost] = useState(original && original.costPrice > 0 ? numberText(Math.round(original.costPrice * 100) / 100, 2) : '')
  const [costTouched, setCostTouched] = useState(false)
  const [tags, setTags] = useState((original?.searchTags ?? []).join(', '))
  const [spaceId, setSpaceId] = useState<string | null>(original?.linkedSpaceId ?? null)
  const [more, setMore] = useState(false)
  const [showErrors, setShowErrors] = useState(false)
  const { busy, run } = useSave(onDone)

  // Есть состав — учёт по составу; нет — штуками (если включено) или без учёта.
  const mode: StockMode = recipe.length > 0 ? 'recipe' : pieces ? 'pieces' : 'none'
  const categories = catalog.categories.filter(c => !isTariffCategory(c))
  const priceValue = parseDecimal(price)
  const costValue = parseDecimal(cost)
  const costEditable = mode === 'none' || (mode === 'pieces' && !original?.hasReceipts)
  const portionCost = recipeCost(recipe.map(r => ({ componentId: r.componentId, quantity: parseInt(r.qty) || 0 })), catalog.byId)
  const shownCost = mode === 'recipe' ? portionCost : costEditable ? (costValue ?? 0) : (original?.costPrice ?? 0)
  const m = priceValue !== null ? margin(priceValue, shownCost) : null
  const canSave = name.trim().length > 0 && priceValue !== null && (!costEditable || cost.trim() === '' || costValue !== null)
  const stockLeft = !!original && original.stockMode === 'pieces' && mode !== 'pieces' && original.stockQuantity !== 0
  const summary = [
    flags.isActive ? 'касса' : 'скрыта из кассы',
    flags.isTabletVisible ? 'Titan Home' : null,
    flags.isScreenVisible ? 'экран ТВ' : null,
    flags.isTop ? 'хит' : null,
    mode === 'pieces' ? 'учёт штуками' : null,
    tags.trim() ? 'теги' : null,
  ].filter(Boolean).join(' · ')

  const save = () => {
    if (mode === 'recipe' && recipe.some(r => !(parseInt(r.qty) > 0))) { setShowErrors(true); return }
    const input: ItemInput = {
      name: name.trim(), price: priceValue ?? 0, category, ...flags,
      searchTags: tags.split(',').map(t => t.trim()).filter(Boolean),
      stockMode: mode,
      ...(mode === 'recipe' ? { recipe: recipe.map(r => ({ componentId: r.componentId, quantity: parseInt(r.qty) })) } : {}),
      ...(mode === 'pieces' ? { reorderPoint: toBase(reorder, 1), parLevel: toBase(par, 1) } : {}),
      ...(costEditable && costTouched && costValue !== null ? { costPrice: costValue } : {}),
      ...(spaceId !== (original?.linkedSpaceId ?? null) ? { linkedSpaceId: spaceId } : {}),
    }
    void run(() => (original ? updateItem(original.id, input) : createItem('goods', input)), original ? 'Позиция сохранена' : 'Позиция добавлена')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <FormField label="Название"><input value={name} onChange={e => setName(e.target.value)} placeholder="Например, Наггетсы 6 шт" style={INP} autoFocus={!original} maxLength={120} /></FormField>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.4fr)', gap: 12 }}>
          <FormField label="Цена, ₽"><input value={price} onChange={e => setPrice(e.target.value)} inputMode="decimal" placeholder="0" style={INP} /></FormField>
          <FormField label="Категория">
            <select value={category ?? ''} onChange={e => setCategory(e.target.value || null)} style={SEL}>
              <option value="">Без категории</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </FormField>
        </div>
        {(m !== null || mode === 'none') && (
          <p style={{ ...hint, marginTop: -4 }}>
            {m !== null
              ? `Себестоимость ${money(shownCost)}${mode === 'recipe' ? ' по составу' : ''} · маржа ${m}% · ${money((priceValue ?? 0) - shownCost)} с продажи.`
              : 'Добавьте состав — себестоимость и маржа посчитаются сами.'}
          </p>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={heading}>Состав</span>
        <RecipeEditor rows={recipe} onChange={setRecipe} catalog={catalog} productId={original?.id ?? null} showErrors={showErrors} />
      </div>

      <Disclosure title="Дополнительно" summary={summary} open={more} onToggle={() => setMore(v => !v)} />

      {more && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={heading}>Где продаётся</span>
            <ToggleRow label="В кассе" value={flags.isActive} onChange={v => setFlags(f => ({ ...f, isActive: v }))} />
            <ToggleRow label="В Titan Home" subtitle="Если категория тоже показана гостям" value={flags.isTabletVisible} onChange={v => setFlags(f => ({ ...f, isTabletVisible: v }))} />
            <ToggleRow label="На экране ТВ" value={flags.isScreenVisible} onChange={v => setFlags(f => ({ ...f, isScreenVisible: v }))} />
            <ToggleRow label="Хит продаж" value={flags.isTop} onChange={v => setFlags(f => ({ ...f, isTop: v }))} />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={heading}>Склад</span>
            {mode === 'recipe'
              ? <p style={{ ...hint, marginTop: 0 }}>Учёт по составу: позиция с составом списывает ингредиенты, а не себя. Учёт штуками — для позиций без состава.</p>
              : <ToggleRow label="Считать штуки на складе" subtitle="Для готового товара — банка колы, шоколадка: продажа спишет одну штуку" value={pieces} onChange={setPieces} />}
            {mode === 'pieces' && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <FormField label="Точка заказа, шт" hint="Предупредить, когда останется столько"><input value={reorder} onChange={e => setReorder(e.target.value)} inputMode="numeric" placeholder="—" style={INP} /></FormField>
                <FormField label="Дозаказ до, шт" hint="Сколько держать после прихода"><input value={par} onChange={e => setPar(e.target.value)} inputMode="numeric" placeholder="—" style={INP} /></FormField>
              </div>
            )}
            {stockLeft && <p style={{ ...hint, marginTop: 0 }}>На складе ещё {itemQty(original, original.stockQuantity)} — их можно списать.</p>}
          </div>

          {mode !== 'recipe' && costEditable && (
            <FormField label="Себестоимость за штуку, ₽" hint="Для маржи. С первым приходом её начнёт считать склад по ценам закупки">
              <input value={cost} onChange={e => { setCost(e.target.value); setCostTouched(true) }} inputMode="decimal" placeholder="0" style={INP} />
            </FormField>
          )}

          <FormField label="Поиск в кассе" hint="Через запятую: касса найдёт позицию и по этим словам"><input value={tags} onChange={e => setTags(e.target.value)} placeholder="кола, газировка" style={INP} /></FormField>

          {spaces.length > 0 && (!original || original.role === 'rental') && (
            <FormField label="Зона аренды" hint="Для аренды: касса свяжет позицию с зоной">
              <select value={spaceId ?? ''} onChange={e => setSpaceId(e.target.value || null)} style={SEL}>
                <option value="">Не привязана</option>
                {spaces.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </FormField>
          )}
        </div>
      )}

      <Button fullWidth size="lg" icon="save" loading={busy} disabled={!canSave} onClick={save}>{original ? 'Сохранить' : 'Добавить позицию'}</Button>
      {original && more && <DeleteBlock item={original} onDone={onDone} />}
    </div>
  )
}

/** Состав порции: ингредиент и сколько его уходит (6 шт, 1 пачка, 18 г); добавление поиском или новым ингредиентом. */
function RecipeEditor({ rows, onChange, catalog, productId, showErrors }: { rows: RecipeRow[]; onChange: (r: RecipeRow[]) => void; catalog: Catalog; productId: string | null; showErrors: boolean }) {
  const qc = useQueryClient()
  const { show } = useToast()
  const [query, setQuery] = useState('')
  const [quick, setQuick] = useState(0)
  const q = query.trim().toLowerCase()
  const present = new Set(rows.map(r => r.componentId))
  const candidates = q ? catalog.items.filter(i => isStockItem(i) && i.id !== productId && !present.has(i.id) && matches(i, q)).slice(0, 8) : []
  const add = (id: string, unit: Unit) => { onChange([...rows, { componentId: id, qty: unit === 'pcs' ? '1' : '' }]); setQuery('') }
  const createIngredient = async () => {
    const choice = QUICK_UNITS[quick]
    try {
      const id = await createItem('ingredient', { name: query.trim(), unit: choice.unit, ...(choice.label ? { unitLabel: choice.label } : {}) })
      refreshGoods(qc)
      add(id, choice.unit)
      show('Ингредиент добавлен', 'success')
    } catch (e) { show(e instanceof Error ? e.message : 'Не создан', 'error') }
  }

  return (
    <div className="glass-l2" style={{ borderRadius: 16, padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
      {rows.length === 0 && <p style={{ ...hint, marginTop: 0 }}>Из чего собрана порция: например, 6 шт наггетсов и 1 пачка соуса. Продажа спишет их со склада, а себестоимость посчитается сама. Без состава продажа склад не трогает.</p>}
      {rows.map(r => {
        const c = catalog.byId.get(r.componentId)
        const qty = parseInt(r.qty) || 0
        const invalid = showErrors && qty <= 0
        const caption = invalid ? 'Укажите, сколько на порцию' : c ? [`на складе ${itemQty(c, c.stockQuantity)}`, packText(c), qty > 0 ? `${money(qty * c.costPrice)} на порцию` : null].filter(Boolean).join(' · ') : ''
        return (
          <div key={r.componentId} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 160px', minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{c?.name ?? 'Удалённый ингредиент'}</div>
              <div style={{ fontSize: 12, color: invalid ? 'var(--danger)' : 'var(--on-surface-variant)' }}>{caption}</div>
            </div>
            <QtyField value={r.qty} integer invalid={invalid} label={`${c?.name}, на порцию`} suffix={`${unitWord(c?.unit ?? 'pcs', c?.unitLabel, r.qty)} на порцию`} width={170}
              onChange={v => onChange(rows.map(x => (x.componentId === r.componentId ? { ...x, qty: v } : x)))} />
            <button onClick={() => onChange(rows.filter(x => x.componentId !== r.componentId))} aria-label="Убрать из состава" style={{ width: 36, height: 36, borderRadius: 10, border: 'none', background: 'rgba(251,113,133,0.1)', color: 'var(--danger)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="remove" size={16} /></button>
          </div>
        )
      })}
      <input value={query} onChange={e => setQuery(e.target.value)} placeholder="+ Ингредиент: наггетсы, соус, молоко…" aria-label="Добавить ингредиент" style={INP} />
      {candidates.map(c => (
        <button key={c.id} onClick={() => add(c.id, c.unit)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)', color: 'var(--on-surface)', cursor: 'pointer', textAlign: 'left' }}>
          <Icon name="add_circle" size={18} color="var(--primary-violet)" />
          <span style={{ flex: 1 }}>{c.name}</span>
          <span style={{ fontSize: 12, color: 'var(--on-surface-variant)' }}>{itemQty(c, c.stockQuantity)}</span>
        </button>
      ))}
      {q && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <select value={quick} onChange={e => setQuick(Number(e.target.value))} aria-label="В чём считать" style={{ ...SEL, width: 150, minHeight: 40, padding: '8px 12px' }}>
            {QUICK_UNITS.map((u, i) => <option key={u.title} value={i}>{u.title}</option>)}
          </select>
          <Button size="sm" variant="secondary" icon="add" onClick={() => void createIngredient()}>Новый ингредиент «{query.trim()}»</Button>
        </div>
      )}
    </div>
  )
}

/* ─── Ингредиент ───────────────────────────────────────────────────────────── */

function IngredientForm({ original, onDone }: { original: GoodsItem | null; onDone: () => void }) {
  const startFactor = BIG_UNIT[original?.unit ?? 'pcs'].factor
  const [name, setName] = useState(original?.name ?? '')
  const [unit, setUnit] = useState<Unit>(original?.unit ?? 'pcs')
  const [label, setLabel] = useState<PieceName | null>(original?.unitLabel ?? null)
  const [packName, setPackName] = useState<PieceName | null>(original?.packName ?? null)
  const [packSize, setPackSize] = useState(text(original?.packSize, startFactor))
  const [reorder, setReorder] = useState(text(original?.reorderPoint, startFactor))
  const [par, setPar] = useState(text(original?.parLevel, startFactor))
  const [cost, setCost] = useState(original && original.costPrice > 0 ? numberText(Math.round(original.costPrice * startFactor * 100) / 100, 2) : '')
  const [costTouched, setCostTouched] = useState(false)
  const { busy, run } = useSave(onDone)

  // Единицу меняем, пока по ингредиенту не было движений (иначе остаток потерял бы смысл).
  const unitLocked = !!original && (original.hasReceipts || original.stockQuantity !== 0)
  const factor = BIG_UNIT[unit].factor
  const pieceLabel = unit === 'pcs' ? label : null
  const word = bigWord(unit, pieceLabel)
  const costEditable = !original?.hasReceipts
  const costValue = parseDecimal(cost)
  const packValue = toBase(packSize, factor)
  const packMissing = packName !== null && !packValue
  const canSave = name.trim().length > 0 && !packMissing && (!costEditable || cost.trim() === '' || costValue !== null)

  const save = () => {
    const input: ItemInput = {
      name: name.trim(),
      ...(unitLocked ? {} : { unit }),
      unitLabel: pieceLabel,
      packName: packName && packValue ? packName : null,
      packSize: packName && packValue ? packValue : null,
      reorderPoint: toBase(reorder, factor),
      parLevel: toBase(par, factor),
      ...(costEditable && costTouched && costValue !== null ? { costPrice: Math.round((costValue / factor) * 10000) / 10000 } : {}),
    }
    void run(() => (original ? updateItem(original.id, input) : createItem('ingredient', input)), original ? 'Ингредиент сохранён' : 'Ингредиент добавлен')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <FormField label="Название" hint="Ингредиент не продаётся сам — его списывают продажи блюд, в чьём составе он есть">
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Например, Наггетсы" style={INP} autoFocus={!original} maxLength={120} />
      </FormField>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={heading}>Считаем в</span>
        {unitLocked
          ? <p style={{ ...hint, marginTop: 0 }}>{UNIT_CHOICES.find(c => c.unit === unit)?.title} — по ингредиенту уже были движения, единицу не поменять, а название штуки можно.</p>
          : <Segments value={unit} onChange={setUnit} items={UNIT_CHOICES.map(c => ({ key: c.unit, label: c.title, icon: c.unit === 'pcs' ? 'inventory_2' : 'tune' }))} />}
        {unit === 'pcs' && (
          <FormField label="Штука называется" hint="«1 пачка соуса на порцию» — так её назовут состав, приход и остатки">
            <select value={label ?? 'pcs'} onChange={e => setLabel(e.target.value === 'pcs' ? null : (e.target.value as PieceName))} style={SEL}>
              {PIECE_CHOICES.map(c => <option key={c} value={c}>{c === 'pcs' ? 'Штука (шт)' : PIECE_NAMES[c].title}</option>)}
            </select>
          </FormField>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={heading}>Фасовка при закупке</span>
        <div style={{ display: 'grid', gridTemplateColumns: packName ? '1fr 1fr' : '1fr', gap: 12 }}>
          <FormField label="Упаковка">
            <select value={packName ?? ''} onChange={e => setPackName(e.target.value ? (e.target.value as PieceName) : null)} style={SEL}>
              <option value="">Без фасовки</option>
              {PIECE_CHOICES.filter(c => c !== 'pcs').map(c => <option key={c} value={c}>{PIECE_NAMES[c].title}</option>)}
            </select>
          </FormField>
          {packName && (
            <FormField label={`В ${PIECE_NAMES[packName].in}, ${word}`}>
              <input value={packSize} onChange={e => setPackSize(e.target.value)} inputMode="decimal" placeholder="—" aria-invalid={packMissing} style={{ ...INP, ...(packMissing ? { borderColor: 'rgba(251,113,133,0.6)' } : {}) }} />
            </FormField>
          )}
        </div>
        <p style={{ ...hint, marginTop: 0, color: packMissing ? 'var(--danger)' : hint.color }}>
          {packMissing ? `Укажите, сколько в ${PIECE_NAMES[packName].in}.` : 'Как приходит от поставщика. В приходе вносите упаковки — количество подставится само, его можно поправить на факт.'}
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <FormField label={`Точка заказа, ${word}`} hint="Ниже — «Заканчивается» и уведомление"><input value={reorder} onChange={e => setReorder(e.target.value)} inputMode="decimal" placeholder="—" style={INP} /></FormField>
        <FormField label={`Дозаказ до, ${word}`} hint="Сколько держать после прихода"><input value={par} onChange={e => setPar(e.target.value)} inputMode="decimal" placeholder="—" style={INP} /></FormField>
      </div>
      {costEditable && (
        <FormField label={`Цена за ${unit === 'pcs' ? PIECE_NAMES[pieceLabel ?? 'pcs'].per : BIG_UNIT[unit].label}, ₽`} hint="Только до первого прихода — дальше её считает склад">
          <input value={cost} onChange={e => { setCost(e.target.value); setCostTouched(true) }} inputMode="decimal" placeholder="0" style={INP} />
        </FormField>
      )}
      <Button fullWidth size="lg" icon="save" loading={busy} disabled={!canSave} onClick={save}>{original ? 'Сохранить' : 'Добавить ингредиент'}</Button>
      {original && <DeleteBlock item={original} onDone={onDone} />}
    </div>
  )
}
