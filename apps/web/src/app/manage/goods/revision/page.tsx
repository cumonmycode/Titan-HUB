'use client'
/**
 * Ревизия: все учётные позиции списком (категории и ингредиенты). Считаете «вслепую» —
 * ожидаемый остаток не виден, чтобы не подгонять. «Сверить» показывает расхождения и
 * их цену; проводятся только посчитанные позиции, остальные не меняются.
 */
import React, { useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useToast } from '@/components/Toast'
import { StateView } from '@/components/StateView'
import { Button, ConfirmDialog, formatMoney } from '@/components/manage/DesignSystem'
import { Card, ChipRow, QtyField, Row, Trailing, money } from '@/components/manage/goods/parts'
import { DocShell, queryParam, savedNote, useAutosave } from '@/components/manage/goods/docs'
import { isStockItem, itemQty, unitWord, isTariffCategory, positionsText, refreshGoods, useGoods, type Catalog, type GoodsItem } from '@/lib/goods'

type Detail = { revision: { draftData: { items: { itemId: string; actual: number | null }[] } | null } }

export default function RevisionPage() {
  const goods = useGoods()
  const [params] = useState(() => ({ draft: queryParam('draft'), item: queryParam('item') }))
  // Факты редактор берёт один раз — только из свежего ответа: в кэше мог остаться
  // черновик до последнего автосохранения, и следующее сохранение затёрло бы правки.
  const source = useQuery({ queryKey: ['goods', 'revision', params.draft], queryFn: () => api.get<Detail>(`/inventory/revisions/${params.draft}`), enabled: !!params.draft, refetchOnMount: 'always' })
  if (!goods.data || (params.draft && (!source.data || !source.isFetchedAfterMount))) return <DocShell title="Ревизия"><StateView state={goods.isError || source.isError ? 'error' : 'loading'} /></DocShell>
  const facts = Object.fromEntries((source.data?.revision.draftData?.items ?? []).filter(l => l.actual !== null).map(l => [l.itemId, String(l.actual)]))
  return <RevisionEditor catalog={goods.data} draft={params.draft} preset={params.draft ? null : params.item} initialFacts={facts} />
}

function RevisionEditor({ catalog, draft, preset, initialFacts }: { catalog: Catalog; draft: string | null; preset: string | null; initialFacts: Record<string, string> }) {
  const router = useRouter()
  const qc = useQueryClient()
  const { show } = useToast()
  const items = useMemo(() => catalog.items.filter(isStockItem), [catalog.items])
  const [facts, setFacts] = useState(initialFacts)
  const [scope, setScope] = useState(preset ? `item:${preset}` : 'all')
  const [reviewing, setReviewing] = useState(false)
  const [draftId, setDraftId] = useState(draft)
  // id черновика для сохранений и проведения: state отстаёт на рендер, а черновик мог
  // родиться, пока открыт диалог «Провести?».
  const draftRef = useRef(draftId)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  const categories = catalog.categories.filter(c => !isTariffCategory(c))
  const known = new Set(categories.map(c => c.id))
  const keyOf = (i: GoodsItem) => (i.kind === 'ingredient' ? 'raw' : i.category && known.has(i.category) ? i.category : 'none')
  const groups = [...categories.map(c => ({ id: c.id, title: c.name })), { id: 'none', title: 'Без категории' }, { id: 'raw', title: 'Ингредиенты' }]
    .map(g => ({ ...g, items: items.filter(i => keyOf(i) === g.id) })).filter(g => g.items.length > 0)

  const rows = items.map(item => {
    const raw = (facts[item.id] ?? '').replace(/[^\d]/g, '')
    const actual = raw === '' ? null : Number(raw)
    const diff = actual === null ? 0 : actual - item.stockQuantity
    return { item, actual, diff, value: diff * item.costPrice }
  })
  const counted = rows.filter(r => r.actual !== null)
  const changed = counted.filter(r => r.diff !== 0)
  const surplus = changed.filter(r => r.diff > 0).reduce((s, r) => s + r.value, 0)
  const shortage = changed.filter(r => r.diff < 0).reduce((s, r) => s - r.value, 0)
  const payload = counted.map(r => ({ itemId: r.item.id, actual: r.actual }))

  const autosave = useAutosave(JSON.stringify(payload), !done && !busy && (counted.length > 0 || !!draftId), async () => {
    const r = await api.post<{ id: string }>('/inventory/revisions/draft', { ...(draftRef.current ? { id: draftRef.current } : {}), items: payload })
    draftRef.current = r.id
    setDraftId(r.id)
    refreshGoods(qc)
  })

  const post = async () => {
    setBusy(true)
    try {
      await autosave.flush()
      const lines = counted.map(r => ({ itemId: r.item.id, actual: r.actual! }))
      let id = draftRef.current
      if (id) await api.post(`/inventory/revisions/${id}/apply`, { items: lines })
      else id = (await api.post<{ revision: { id: string } }>('/inventory/revisions', { items: lines })).revision.id
      setDone(true)
      refreshGoods(qc)
      show('Ревизия проведена', 'success')
      router.push(`/manage/goods/doc?type=revision&id=${id}`)
    } catch (e) {
      show(`${e instanceof Error ? e.message : 'Не проведено'}. Остатки не изменились.`, 'error')
    } finally {
      setBusy(false); setConfirm(false)
    }
  }

  if (items.length === 0) return <DocShell title="Ревизия"><StateView state="empty" icon="fact_check" title="Нечего пересчитывать" description="Остатки ведут ингредиенты и позиции с учётом штуками." /></DocShell>

  const visible = scope.startsWith('item:')
    ? groups.map(g => ({ ...g, items: g.items.filter(i => `item:${i.id}` === scope) })).filter(g => g.items.length > 0)
    : groups.filter(g => scope === 'all' || g.id === scope)
  const chip = (id: string, label: string) => (
    <button key={id} onClick={() => setScope(id)} aria-pressed={scope === id}
      style={{ flexShrink: 0, minHeight: 36, padding: '0 14px', borderRadius: 999, cursor: 'pointer', fontSize: 13, fontWeight: 700, border: scope === id ? '1px solid transparent' : '1px solid rgba(255,255,255,0.1)', background: scope === id ? 'var(--primary-violet)' : 'rgba(255,255,255,0.05)', color: scope === id ? '#fff' : 'var(--on-surface-variant)' }}>{label}</button>
  )

  if (reviewing) {
    return (
      <DocShell title="Сверка" subtitle={`Посчитано ${counted.length} из ${items.length}`} action={{ label: busy ? 'Проводим…' : 'Провести', icon: 'check_circle', onClick: () => setConfirm(true) }}>
        <div className="glass-l2" style={{ borderRadius: 18, padding: 16, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          <div><div style={{ fontSize: 12, color: 'var(--on-surface-variant)' }}>Посчитано</div><div style={{ fontSize: 20, fontWeight: 800 }}>{counted.length} из {items.length}</div></div>
          <div><div style={{ fontSize: 12, color: 'var(--on-surface-variant)' }}>Излишек</div><div style={{ fontSize: 20, fontWeight: 800, color: surplus > 0 ? 'var(--success)' : undefined }}>{surplus > 0 ? `+${money(surplus)}` : '—'}</div></div>
          <div><div style={{ fontSize: 12, color: 'var(--on-surface-variant)' }}>Недостача</div><div style={{ fontSize: 20, fontWeight: 800, color: shortage > 0 ? 'var(--danger)' : undefined }}>{shortage > 0 ? `−${money(shortage)}` : '—'}</div></div>
        </div>
        <Card title={changed.length ? `Расхождения · ${changed.length}` : 'Расхождений нет'} footer={changed.length ? 'По себестоимости. Непосчитанные позиции не изменятся.' : 'Факт везде совпал с учётом.'}>
          {changed.map(r => (
            <Row key={r.item.id}>
              <span style={{ flex: 1, minWidth: 0 }}><span style={{ display: 'block', fontSize: 15, fontWeight: 600 }}>{r.item.name}</span><span style={{ fontSize: 12.5, color: 'var(--on-surface-variant)' }}>учёт {itemQty(r.item, r.item.stockQuantity)} → факт {itemQty(r.item, r.actual ?? 0)}</span></span>
              <Trailing value={`${r.diff > 0 ? '+' : '−'}${itemQty(r.item, Math.abs(r.diff))}`} color={r.diff > 0 ? 'var(--success)' : 'var(--danger)'} caption={formatMoney(r.value, { sign: true })} captionColor={r.diff > 0 ? 'var(--success)' : 'var(--danger)'} />
            </Row>
          ))}
        </Card>
        <Button variant="secondary" icon="edit" fullWidth onClick={() => setReviewing(false)}>Вернуться к подсчёту</Button>
        <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} onConfirm={() => void post()} loading={busy} confirmLabel="Провести" title="Провести ревизию?"
          message={changed.length ? `Остатки ${positionsText(changed.length)} станут равны факту, расхождения попадут в журнал.` : 'Всё сходится — остатки не изменятся, ревизия сохранится в истории.'} />
      </DocShell>
    )
  }

  return (
    <DocShell title="Ревизия" subtitle={`Посчитано ${counted.length} из ${items.length}`} action={counted.length ? { label: 'Сверить', icon: 'fact_check', onClick: () => setReviewing(true) } : undefined}>
      <ChipRow>{[chip('all', `Все · ${items.length}`), ...groups.map(g => chip(g.id, g.title))]}</ChipRow>
      {visible.map(g => (
        <Card key={g.id} title={g.title}>
          {g.items.map(i => (
            <div key={i.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', minHeight: 56 }}>
              <span style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 600 }}>{i.name}</span>
              <QtyField label={`${i.name}, факт`} value={facts[i.id] ?? ''} integer placeholder="—" suffix={unitWord(i.unit, i.unitLabel, facts[i.id] ?? '')} width={140} onChange={v => setFacts(f => ({ ...f, [i.id]: v }))} />
            </div>
          ))}
        </Card>
      ))}
      {scope.startsWith('item:') && <Button variant="secondary" icon="checklist" fullWidth onClick={() => setScope('all')}>Пересчитать и остальное</Button>}
      <p style={{ margin: 0, padding: '0 4px', fontSize: 12, color: 'var(--on-surface-variant)' }}>Ожидаемый остаток скрыт до сверки — считайте по факту. {savedNote(autosave.savedAt)}</p>
      {draftId && <Button variant="danger" icon="delete" fullWidth onClick={() => { setDone(true); void autosave.flush().then(() => api.delete(`/inventory/revisions/${draftId}`)).then(() => { refreshGoods(qc); router.push('/manage/goods?tab=warehouse') }) }}>Удалить черновик</Button>}
    </DocShell>
  )
}
