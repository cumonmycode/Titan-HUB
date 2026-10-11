'use client'
/**
 * Приход: что пришло, сколько и почём. Позиции — из каталога (несколько сразу,
 * «Добавить заканчивающиеся»), количество и цена — в одной строке, граммы и миллилитры
 * в кг и литрах. У позиции с фасовкой вносят упаковки: количество подставляется
 * (правится на факт), цена — за упаковку.
 * Черновик сохраняется сам; «Провести» добавляет остатки и пересчитывает себестоимость.
 * «Из кассы смены» — сумма уходит выдачей из кассы открытой смены.
 */
import React, { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useToast } from '@/components/Toast'
import { Icon } from '@/components/Icon'
import { StateView } from '@/components/StateView'
import { Button, ConfirmDialog, INP } from '@/components/manage/DesignSystem'
import { Card, ChipRow, QtyField, Segments, money } from '@/components/manage/goods/parts'
import { DocShell, PickSheet, TotalRow, queryParam, savedNote, useAutosave } from '@/components/manage/goods/docs'
import {
  PIECE_NAMES, bigWord, itemQty, unitWord, newIdempotencyKey, numberText, packText, parseDecimal, positionsText, refreshGoods, reorderQuantity, round2, round4,
  BIG_UNIT, useGoods, useSuppliers, type Catalog, type GoodsItem, type PieceName, type Unit,
} from '@/lib/goods'

type Line = {
  key: string; itemId: string | null; name: string; unit: Unit; label: PieceName | null; qty: string; price: string
  /** Фасовка: сколько упаковок; количество подставляется packs × packSize, пока его не правили руками. */
  packs: string; packSize: number | null; packName: PieceName | null; qtyManual: boolean
}
type Saved = { itemId?: string | null; name?: string; quantity: number; costPerUnit?: number; packs?: number | null }
type SupplyDetail = {
  supply: { id: string; status: string; supplier: string | null; cashOperationId: string | null; draftData: { supplier?: string; fromRegister?: boolean; items: Saved[] } | null }
  items: (Saved & { stockUnit?: Unit | null })[]
}

let seq = 0
const lineOf = (catalog: Catalog, s: Saved, unit?: Unit | null): Line => {
  const item = s.itemId ? catalog.byId.get(s.itemId) : undefined
  const u = unit ?? item?.unit ?? 'pcs'
  const factor = s.itemId ? BIG_UNIT[u].factor : 1
  const packSize = item?.packSize ?? null
  const packs = s.packs ?? 0
  const price = !s.costPerUnit ? 0 : packs > 0 ? (s.costPerUnit * s.quantity) / packs : packSize ? s.costPerUnit * packSize : s.costPerUnit * factor
  return {
    key: `l${++seq}`, itemId: s.itemId ?? null, name: item?.name ?? s.name ?? '—', unit: u, label: item?.unitLabel ?? null,
    qty: s.quantity > 0 ? numberText(s.quantity / factor) : '', price: price > 0 ? numberText(round2(price), 2) : '',
    packs: packs > 0 ? numberText(packs, 2) : '', packSize, packName: item?.packName ?? null, qtyManual: packs > 0,
  }
}
/** Новая строка: дозаказ до целевого уровня (у фасовки — целыми упаковками), цена по средней. */
const lineFromItem = (i: GoodsItem): Line => {
  const f = BIG_UNIT[i.unit].factor
  const need = reorderQuantity(i)
  const base = { key: `l${++seq}`, itemId: i.id, name: i.name, unit: i.unit, label: i.unitLabel, packSize: i.packSize, packName: i.packName, qtyManual: false }
  if (i.packSize) {
    const packs = need > 0 ? Math.ceil(need / i.packSize) : 0
    return { ...base, packs: packs > 0 ? String(packs) : '', qty: packs > 0 ? numberText((packs * i.packSize) / f) : '', price: i.costPrice > 0 ? numberText(round2(i.costPrice * i.packSize), 2) : '' }
  }
  return { ...base, packs: '', qty: need > 0 ? numberText(need / f) : '', price: i.costPrice > 0 ? numberText(round2(i.costPrice * f), 2) : '' }
}
/** Строка в единицах сервера: целое в базовой единице, цена за неё, упаковки. С фасовкой цена — за упаковку. */
function values(l: Line) {
  const factor = l.itemId ? BIG_UNIT[l.unit].factor : 1
  const qty = parseDecimal(l.qty) ?? 0
  const price = parseDecimal(l.price) ?? 0
  const packs = l.packSize ? (parseDecimal(l.packs) ?? 0) : 0
  const quantity = l.itemId ? Math.round(qty * factor) : qty
  const entered = !l.packSize ? round2(qty * price) : packs > 0 ? round2(packs * price) : round2((quantity / l.packSize) * price)
  const costPerUnit = !l.packSize ? round4(price / factor) : quantity > 0 ? round4(entered / quantity) : 0
  // Сумма строки — как её считает сервер: количество × округлённая цена единицы.
  const sum = round2(quantity * costPerUnit)
  return { quantity, costPerUnit, sum, packs: packs > 0 ? packs : null, error: !l.name.trim() ? 'Укажите название' : quantity <= 0 ? 'Укажите количество' : null }
}
/** Упаковки подставляют количество, пока его не поправили руками. */
function withPacks(l: Line, text: string): Line {
  const packs = parseDecimal(text)
  if (l.qtyManual || !l.packSize || packs === null) return { ...l, packs: text }
  return { ...l, packs: text, qty: numberText((packs * l.packSize) / BIG_UNIT[l.unit].factor) }
}

export default function SupplyPage() {
  const goods = useGoods()
  const [params] = useState(() => ({ draft: queryParam('draft'), supply: queryParam('supply'), item: queryParam('item') }))
  const sourceId = params.supply ?? params.draft
  // Состав редактор берёт один раз — только из свежего ответа: в кэше мог остаться
  // черновик до последнего автосохранения, и следующее сохранение затёрло бы правки.
  const source = useQuery({ queryKey: ['goods', 'supply', sourceId], queryFn: () => api.get<SupplyDetail>(`/supplies/${sourceId}`), enabled: !!sourceId, refetchOnMount: 'always' })
  if (!goods.data || (sourceId && (!source.data || !source.isFetchedAfterMount))) {
    return <DocShell title="Приход"><StateView state={goods.isError || source.isError ? 'error' : 'loading'} /></DocShell>
  }
  const catalog = goods.data
  const mode = params.supply ? 'correct' : params.draft ? 'draft' : 'new'
  const saved = mode === 'correct' ? source.data!.items.map(s => lineOf(catalog, s, s.stockUnit)) : (source.data?.supply.draftData?.items ?? []).map(s => lineOf(catalog, s))
  const preset = params.item ? catalog.byId.get(params.item) : undefined
  return <SupplyEditor mode={mode} sourceId={sourceId} catalog={catalog} initialLines={preset ? [...saved, lineFromItem(preset)] : saved}
    initialSupplier={source.data?.supply.draftData?.supplier ?? source.data?.supply.supplier ?? ''} initialFromRegister={!!source.data?.supply.draftData?.fromRegister} />
}

function SupplyEditor({ mode, sourceId, catalog, initialLines, initialSupplier, initialFromRegister }: {
  mode: 'new' | 'draft' | 'correct'; sourceId: string | null; catalog: Catalog; initialLines: Line[]; initialSupplier: string; initialFromRegister: boolean
}) {
  const router = useRouter()
  const qc = useQueryClient()
  const { show } = useToast()
  const suppliers = useSuppliers()
  const [lines, setLines] = useState<Line[]>(initialLines)
  const [supplier, setSupplier] = useState(initialSupplier)
  const [fromRegister, setFromRegister] = useState(initialFromRegister)
  const [reason, setReason] = useState('')
  const [draftId, setDraftId] = useState<string | null>(mode === 'draft' ? sourceId : null)
  // id черновика для сохранений и проведения: state отстаёт на рендер, а черновик мог
  // родиться, пока открыт диалог «Провести?».
  const draftRef = useRef(draftId)
  const [picking, setPicking] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [showErrors, setShowErrors] = useState(false)
  const [key] = useState(newIdempotencyKey)

  const parsed = lines.map(l => ({ l, ...values(l) }))
  // Итог — как у сервера (Σ количество × цена единицы): столько и уйдёт из кассы.
  const total = round2(parsed.reduce((s, p) => s + p.quantity * p.costPerUnit, 0))
  const valid = lines.length > 0 && parsed.every(p => !p.error) && (mode !== 'correct' || reason.trim().length >= 3)
  const payload = parsed.map(p => ({ ...(p.l.itemId ? { itemId: p.l.itemId } : {}), ...(p.l.name.trim() ? { name: p.l.name.trim() } : {}), quantity: p.quantity, costPerUnit: p.costPerUnit, ...(p.packs ? { packs: p.packs } : {}) }))
  const header = { ...(supplier.trim() ? { supplier: supplier.trim() } : {}), fromRegister, paymentMethod: fromRegister ? 'cash' : 'transfer' }

  const autosave = useAutosave(JSON.stringify([lines, supplier, fromRegister]), mode !== 'correct' && !done && !busy && (lines.length > 0 || !!draftId), async () => {
    const r = await api.post<{ id: string }>('/supplies/draft', { ...(draftRef.current ? { id: draftRef.current } : {}), ...header, items: payload })
    draftRef.current = r.id
    setDraftId(r.id)
    refreshGoods(qc)
  })

  const set = (k: string, patch: Partial<Line>) => setLines(ls => ls.map(l => (l.key === k ? { ...l, ...patch } : l)))
  const post = async () => {
    setBusy(true)
    try {
      await autosave.flush()
      if (mode === 'correct' && sourceId) await api.patch(`/supplies/${sourceId}`, { reason: reason.trim(), items: payload })
      else if (draftRef.current) await api.post(`/supplies/${draftRef.current}/apply`, { ...header, items: payload })
      else await api.post('/supplies', { ...header, items: payload, idempotencyKey: key })
      setDone(true)
      refreshGoods(qc)
      show(mode === 'correct' ? 'Приход исправлен' : 'Приход проведён', 'success')
      router.push('/manage/goods?tab=warehouse')
    } catch (e) {
      show(`${e instanceof Error ? e.message : 'Не проведено'}. Остатки не изменились.`, 'error')
    } finally {
      setBusy(false); setConfirm(false)
    }
  }
  const onPost = () => {
    setShowErrors(true)
    if (!valid) { show(lines.length === 0 ? 'Добавьте, что пришло' : mode === 'correct' && reason.trim().length < 3 ? 'Укажите причину корректировки' : 'Проверьте позиции — ошибки подписаны', 'warning'); return }
    if (mode === 'correct') void post()
    else setConfirm(true)
  }
  const hints = (suppliers.data ?? []).filter(s => s !== supplier && (!supplier.trim() || s.toLowerCase().includes(supplier.trim().toLowerCase()))).slice(0, 8)

  return (
    <DocShell title={mode === 'correct' ? 'Корректировка прихода' : 'Приход'} subtitle={mode === 'correct' ? undefined : savedNote(autosave.savedAt)}
      action={{ label: busy ? 'Проводим…' : mode === 'correct' ? 'Сохранить' : 'Провести', icon: 'check_circle', onClick: onPost }}>
      {mode !== 'correct' && (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input value={supplier} onChange={e => setSupplier(e.target.value)} placeholder="Поставщик: Метро, рынок, бар-маркет…" style={INP} aria-label="Поставщик" />
            {hints.length > 0 && <ChipRow>{hints.map(h => <button key={h} onClick={() => setSupplier(h)} style={{ flexShrink: 0, padding: '6px 12px', borderRadius: 999, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)', color: 'var(--on-surface)', cursor: 'pointer', fontSize: 13 }}>{h}</button>)}</ChipRow>}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <Segments value={fromRegister ? 'register' : 'other'} onChange={v => setFromRegister(v === 'register')} items={[{ key: 'other', label: 'Не из кассы', icon: 'account_balance' }, { key: 'register', label: 'Из кассы смены', icon: 'point_of_sale' }]} />
            <p style={{ margin: 0, padding: '0 4px', fontSize: 12, color: 'var(--on-surface-variant)' }}>{fromRegister ? 'Сумма прихода уйдёт выдачей из кассы открытой смены — наличные в кассе уменьшатся.' : 'Касса смены не меняется: оплачено переводом, картой или не из кассы.'}</p>
          </div>
        </>
      )}

      <Card title={lines.length ? `Что пришло · ${positionsText(lines.length)}` : 'Что пришло'} footer={lines.length ? 'Граммы и миллилитры — в килограммах и литрах. У позиций с фасовкой цена — за упаковку.' : undefined}>
        {parsed.map(({ l, sum, error }) => {
          const item = l.itemId ? catalog.byId.get(l.itemId) : undefined
          const big = l.itemId ? bigWord(l.unit, l.label) : 'шт'
          const per = l.packSize ? PIECE_NAMES[l.packName ?? 'pack'].per : l.itemId && l.unit === 'pcs' ? PIECE_NAMES[l.label ?? 'pcs'].per : big
          const invalid = showErrors && !!error
          const avg = item && item.costPrice > 0 ? item.costPrice * (l.packSize ?? BIG_UNIT[item.unit].factor) : null
          const entered = parseDecimal(l.price) ?? 0
          const note = [item ? packText(item) : null, avg && entered > 0 && Math.abs(entered - avg) >= 0.01 ? `${entered > avg ? 'дороже' : 'дешевле'} средней (${money(avg)})` : null].filter(Boolean).map(t => ` · ${t}`).join('')
          return (
            <div key={l.key} style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 15, fontWeight: 600 }}>{l.name}</span>
                  <span style={{ fontSize: 12.5, color: invalid ? 'var(--danger)' : 'var(--on-surface-variant)' }}>{invalid ? error : `${item ? `на складе ${itemQty(item, item.stockQuantity)}` : 'затрата без карточки'}${note}`}</span>
                </span>
                {sum > 0 && <span style={{ fontSize: 15, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{money(sum)}</span>}
                <button onClick={() => setLines(ls => ls.filter(x => x.key !== l.key))} aria-label="Убрать" style={{ width: 32, height: 32, borderRadius: 10, border: 'none', background: 'transparent', color: 'var(--on-surface-variant)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="close" size={16} /></button>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {l.packSize ? <QtyField label={`${l.name}, упаковок`} value={l.packs} suffix={unitWord('pcs', l.packName ?? 'pack', l.packs)} onChange={v => setLines(ls => ls.map(x => (x.key === l.key ? withPacks(x, v) : x)))} /> : null}
                <QtyField label={`${l.name}, количество`} value={l.qty} suffix={big} invalid={invalid && error === 'Укажите количество'} onChange={v => set(l.key, { qty: v, qtyManual: true })} />
                <QtyField label={`${l.name}, цена`} value={l.price} suffix={`₽ за ${per}`} onChange={v => set(l.key, { price: v })} />
              </div>
            </div>
          )
        })}
        <button onClick={() => setPicking(true)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', background: 'transparent', border: 'none', color: 'var(--primary-violet)', fontWeight: 700, fontSize: 14.5, cursor: 'pointer', width: '100%' }}>
          <Icon name="add_circle" size={18} />{lines.length ? 'Добавить ещё' : 'Добавить из каталога'}
        </button>
      </Card>

      {mode === 'correct' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="Причина корректировки: например, ошиблись в количестве" rows={2} style={{ ...INP, resize: 'vertical' }} />
          {showErrors && reason.trim().length < 3 && <span style={{ fontSize: 12, color: 'var(--danger)', padding: '0 4px' }}>Не короче 3 символов — она попадёт в историю прихода.</span>}
        </div>
      )}

      <TotalRow value={money(total)} note={mode === 'correct' ? 'Остатки сдвинутся на разницу с прежним составом.' : `${savedNote(autosave.savedAt)} Остатки изменятся, только когда проведёте приход.`} />
      {draftId && mode !== 'correct' && (
        <Button variant="danger" icon="delete" fullWidth onClick={() => { setDone(true); void autosave.flush().then(() => api.delete(`/supplies/${draftId}`)).then(() => { refreshGoods(qc); router.push('/manage/goods?tab=warehouse') }) }}>Удалить черновик</Button>
      )}

      <PickSheet open={picking} mode="supply" catalog={catalog} present={new Set(lines.map(l => l.itemId ?? ''))} onClose={() => setPicking(false)}
        onPick={items => setLines(ls => [...ls, ...items.map(lineFromItem)])}
        onFree={name => setLines(ls => [...ls, { key: `l${++seq}`, itemId: null, name, unit: 'pcs', label: null, qty: '1', price: '', packs: '', packSize: null, packName: null, qtyManual: false }])} />
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} onConfirm={() => void post()} loading={busy} confirmLabel="Провести" title="Провести приход?"
        message={`${positionsText(lines.length)} на ${money(total)}${fromRegister ? ' — наличными из кассы смены' : ''}. Остатки и себестоимость обновятся.`} />
    </DocShell>
  )
}
