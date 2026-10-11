'use client'
/**
 * Списание: бой, порча, угощение — одним документом на несколько позиций. Порция по
 * составу списывает свои ингредиенты. Больше, чем есть на складе, не спишется.
 */
import React, { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useToast } from '@/components/Toast'
import { Icon } from '@/components/Icon'
import { StateView } from '@/components/StateView'
import { Button, ConfirmDialog, INP } from '@/components/manage/DesignSystem'
import { Card, ChipRow, QtyField, money } from '@/components/manage/goods/parts'
import { DocShell, PickSheet, TotalRow, queryParam, savedNote, useAutosave } from '@/components/manage/goods/docs'
import { itemQty, newIdempotencyKey, unitWord, positionsText, refreshGoods, useGoods, type Catalog, type GoodsItem } from '@/lib/goods'

const REASONS = ['Бой', 'Порча', 'Истёк срок', 'Угощение', 'Персоналу']
type Line = { itemId: string; qty: string }
type Detail = { writeOff: { reason: string; note: string | null; draftData: { reason?: string; note?: string; items: { itemId: string; quantity: number }[] } | null } }

export default function WriteOffPage() {
  const goods = useGoods()
  const [params] = useState(() => ({ draft: queryParam('draft'), item: queryParam('item') }))
  // Состав редактор берёт один раз — только из свежего ответа: в кэше мог остаться
  // черновик до последнего автосохранения, и следующее сохранение затёрло бы правки.
  const source = useQuery({ queryKey: ['goods', 'write-off', params.draft], queryFn: () => api.get<Detail>(`/goods/write-offs/${params.draft}`), enabled: !!params.draft, refetchOnMount: 'always' })
  if (!goods.data || (params.draft && (!source.data || !source.isFetchedAfterMount))) return <DocShell title="Списание"><StateView state={goods.isError || source.isError ? 'error' : 'loading'} /></DocShell>
  const d = source.data?.writeOff.draftData
  const lines: Line[] = (d?.items ?? []).map(l => ({ itemId: l.itemId, qty: String(l.quantity) }))
  const preset = params.item ? goods.data.byId.get(params.item) : undefined
  if (preset && !lines.some(l => l.itemId === preset.id)) lines.push({ itemId: preset.id, qty: preset.unit === 'pcs' ? '1' : '' })
  return <WriteOffEditor catalog={goods.data} draft={params.draft} initialLines={lines} initialReason={d?.reason ?? ''} initialNote={d?.note ?? ''} />
}

function WriteOffEditor({ catalog, draft, initialLines, initialReason, initialNote }: { catalog: Catalog; draft: string | null; initialLines: Line[]; initialReason: string; initialNote: string }) {
  const router = useRouter()
  const qc = useQueryClient()
  const { show } = useToast()
  const [lines, setLines] = useState(initialLines)
  const [reason, setReason] = useState(initialReason)
  const [custom, setCustom] = useState(initialReason && !REASONS.includes(initialReason) ? initialReason : '')
  const [note, setNote] = useState(initialNote)
  const [draftId, setDraftId] = useState(draft)
  // id черновика для сохранений и проведения: state отстаёт на рендер, а черновик мог
  // родиться, пока открыт диалог «Списать?».
  const draftRef = useRef(draftId)
  const [picking, setPicking] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [showErrors, setShowErrors] = useState(false)
  const [key] = useState(newIdempotencyKey)

  const rows = lines.map(l => {
    const item = catalog.byId.get(l.itemId)
    const qty = parseInt(l.qty) || 0
    return { l, item, qty, cost: item ? qty * item.costPrice : 0 }
  })
  const total = rows.reduce((s, r) => s + r.cost, 0)
  const items = rows.map(r => ({ itemId: r.l.itemId, quantity: r.qty }))
  const valid = rows.length > 0 && rows.every(r => r.qty > 0) && reason.trim().length > 0

  const autosave = useAutosave(JSON.stringify([lines, reason, note]), !done && !busy && (lines.length > 0 || !!draftId), async () => {
    const r = await api.post<{ id: string }>('/goods/write-offs/draft', { ...(draftRef.current ? { id: draftRef.current } : {}), reason, ...(note.trim() ? { note: note.trim() } : {}), items })
    draftRef.current = r.id
    setDraftId(r.id)
    refreshGoods(qc)
  })

  const post = async () => {
    setBusy(true)
    try {
      await autosave.flush()
      const body = { reason: reason.trim(), ...(note.trim() ? { note: note.trim() } : {}), items }
      if (draftRef.current) await api.post(`/goods/write-offs/${draftRef.current}/apply`, body)
      else await api.post('/goods/write-offs', { ...body, idempotencyKey: key })
      setDone(true)
      refreshGoods(qc)
      show('Списано', 'success')
      router.push('/manage/goods?tab=warehouse')
    } catch (e) {
      show(`${e instanceof Error ? e.message : 'Не списано'}. Остатки не изменились.`, 'error')
    } finally {
      setBusy(false); setConfirm(false)
    }
  }
  const onPost = () => {
    setShowErrors(true)
    if (!valid) { show(!reason.trim() ? 'Выберите причину' : rows.length === 0 ? 'Добавьте, что списать' : 'Укажите количество у каждой позиции', 'warning'); return }
    setConfirm(true)
  }
  const add = (picked: GoodsItem[]) => setLines(ls => [...ls, ...picked.map(i => ({ itemId: i.id, qty: i.unit === 'pcs' ? '1' : '' }))])

  return (
    <DocShell title="Списание" subtitle={savedNote(autosave.savedAt)} action={{ label: busy ? 'Списываем…' : 'Списать', icon: 'delete', onClick: onPost }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <ChipRow>
          {REASONS.map(r => (
            <button key={r} onClick={() => { setReason(r); setCustom('') }} aria-pressed={reason === r}
              style={{ flexShrink: 0, minHeight: 36, padding: '0 14px', borderRadius: 999, cursor: 'pointer', fontSize: 13, fontWeight: 700, border: reason === r ? '1px solid transparent' : '1px solid rgba(255,255,255,0.1)', background: reason === r ? 'var(--danger)' : 'rgba(255,255,255,0.05)', color: reason === r ? '#fff' : 'var(--on-surface-variant)' }}>{r}</button>
          ))}
        </ChipRow>
        <input value={custom} onChange={e => { setCustom(e.target.value); setReason(e.target.value) }} placeholder="Другая причина" style={INP} aria-label="Другая причина" />
        {showErrors && !reason.trim() && <span style={{ fontSize: 12, color: 'var(--danger)', padding: '0 4px' }}>Выберите причину — она попадёт в историю и аналитику потерь.</span>}
      </div>

      <Card title={lines.length ? `Что списать · ${positionsText(lines.length)}` : 'Что списать'} footer={lines.length ? 'Больше, чем есть на складе, не спишется.' : undefined}>
        {rows.map(({ l, item, qty, cost }) => {
          const recipe = item?.stockMode === 'recipe'
          const invalid = showErrors && qty <= 0
          const over = item && !recipe && qty > Math.max(0, item.stockQuantity)
          return (
            <div key={l.itemId} style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ flex: '1 1 180px', minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 15, fontWeight: 600 }}>{item?.name ?? 'Позиция удалена'}</span>
                <span style={{ fontSize: 12.5, color: invalid || over ? 'var(--danger)' : 'var(--on-surface-variant)' }}>
                  {invalid ? 'Укажите количество' : recipe ? 'спишется состав порции' : item ? `на складе ${itemQty(item, item.stockQuantity)}${over ? ' — спишется только это' : ''}` : ''}
                </span>
              </span>
              <QtyField label={`${item?.name}, количество`} value={l.qty} integer invalid={invalid} suffix={recipe ? 'порц.' : unitWord(item?.unit ?? 'pcs', item?.unitLabel, l.qty)} width={130}
                onChange={v => setLines(ls => ls.map(x => (x.itemId === l.itemId ? { ...x, qty: v } : x)))} />
              <span style={{ minWidth: 70, textAlign: 'right', fontSize: 15, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{cost > 0 ? money(cost) : ''}</span>
              <button onClick={() => setLines(ls => ls.filter(x => x.itemId !== l.itemId))} aria-label="Убрать" style={{ width: 32, height: 32, borderRadius: 10, border: 'none', background: 'transparent', color: 'var(--on-surface-variant)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="close" size={16} /></button>
            </div>
          )
        })}
        <button onClick={() => setPicking(true)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', background: 'transparent', border: 'none', color: 'var(--primary-violet)', fontWeight: 700, fontSize: 14.5, cursor: 'pointer', width: '100%' }}>
          <Icon name="add_circle" size={18} />{lines.length ? 'Добавить ещё' : 'Добавить из каталога'}
        </button>
      </Card>

      <textarea value={note} onChange={e => setNote(e.target.value)} placeholder="Комментарий (необязательно): что случилось" rows={2} style={{ ...INP, resize: 'vertical' }} />
      <TotalRow value={money(total)} note={`${savedNote(autosave.savedAt)} Сумма — по себестоимости, она уйдёт в потери.`} />
      {draftId && <Button variant="danger" icon="delete" fullWidth onClick={() => { setDone(true); void autosave.flush().then(() => api.delete(`/goods/write-offs/${draftId}`)).then(() => { refreshGoods(qc); router.push('/manage/goods?tab=warehouse') }) }}>Удалить черновик</Button>}

      <PickSheet open={picking} mode="write_off" catalog={catalog} present={new Set(lines.map(l => l.itemId))} onClose={() => setPicking(false)} onPick={add} />
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} onConfirm={() => void post()} loading={busy} danger confirmLabel="Списать" title="Списать?"
        message={`${positionsText(rows.length)} на ${money(total)} — «${reason.trim()}». Остатки уменьшатся.`} />
    </DocShell>
  )
}
