'use client'
/**
 * Проведённый документ склада (`?type=supply|write_off|revision&id=…`). Приход можно
 * исправить (с причиной) или удалить с откатом остатков, списание — отменить, последнюю
 * ревизию — поправить. Удаление и отмена — только владельцу.
 */
import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useAuthStore } from '@/store/auth.store'
import { useToast } from '@/components/Toast'
import { StateView } from '@/components/StateView'
import { Button, ConfirmDialog, formatMoney } from '@/components/manage/DesignSystem'
import { Card, DOC_LOOK, IconPlate, QtyField, Row, Trailing, money } from '@/components/manage/goods/parts'
import { DocShell, queryParam } from '@/components/manage/goods/docs'
import { PIECE_NAMES, formatQty, numberText, pieceText, plural, positionsText, refreshGoods, unitPrice, unitWord, useGoods, type Unit } from '@/lib/goods'

const longDate = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' })
const num = (v: unknown) => parseFloat(String(v ?? 0)) || 0

type SupplyDetail = { supply: { createdAt: string; supplier: string | null; totalCost: string; cashOperationId: string | null }; items: { itemId: string | null; name: string; unit: string; stockUnit?: Unit | null; quantity: number; costPerUnit: number; packs?: number | null }[]; corrections: { id: string; reason: string; totalBefore: number; totalAfter: number; createdAt: string }[] }
type WriteOffDetail = { writeOff: { createdAt: string; reason: string; note: string | null; totalCost: string; author: string | null }; items: { id: string; itemId: string; name: string; quantity: number; unitCost: string; unit?: Unit }[] }
type RevisionDetail = { revision: { id: string; createdAt: string; author: string | null; isLatest: boolean; status: string }; items: { id: string; itemId: string; name: string; expected: number; actual: number; costPrice: string; unit?: Unit }[] }

function Header({ type, date, lines, total, color }: { type: keyof typeof DOC_LOOK; date: string; lines: string[]; total: string; color?: string }) {
  return (
    <div className="glass-l2" style={{ borderRadius: 18, padding: 18, display: 'flex', alignItems: 'center', gap: 14 }}>
      <IconPlate icon={DOC_LOOK[type].icon} color={DOC_LOOK[type].color} size={46} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 16, fontWeight: 700 }}>{longDate.format(new Date(date)).replace('.', '')}</div>
        {lines.filter(Boolean).map(l => <div key={l} style={{ fontSize: 13, color: 'var(--on-surface-variant)' }}>{l}</div>)}
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, fontVariantNumeric: 'tabular-nums', color }}>{total}</div>
    </div>
  )
}

export default function GoodsDocPage() {
  const [params] = useState(() => ({ type: queryParam('type'), id: queryParam('id') ?? '' }))
  const title = params.type === 'supply' ? 'Приход' : params.type === 'write_off' ? 'Списание' : 'Ревизия'
  if (params.type === 'supply') return <SupplyView id={params.id} />
  if (params.type === 'write_off') return <WriteOffView id={params.id} />
  if (params.type === 'revision') return <RevisionView id={params.id} />
  return <DocShell title={title}><StateView state="empty" title="Документ не найден" /></DocShell>
}

function useOwnerAction(okText: string) {
  const router = useRouter()
  const qc = useQueryClient()
  const { show } = useToast()
  const [busy, setBusy] = useState(false)
  return { busy, run: async (fn: () => Promise<unknown>) => {
    setBusy(true)
    try { await fn(); refreshGoods(qc); show(okText, 'success'); router.push('/manage/goods?tab=warehouse') }
    catch (e) { show(e instanceof Error ? e.message : 'Не получилось', 'error') }
    finally { setBusy(false) }
  } }
}

function SupplyView({ id }: { id: string }) {
  const router = useRouter()
  const goods = useGoods()
  const isOwner = useAuthStore(s => s.user?.role) === 'owner'
  const q = useQuery({ queryKey: ['goods', 'supply', id], queryFn: () => api.get<SupplyDetail>(`/supplies/${id}`) })
  const [confirm, setConfirm] = useState(false)
  const del = useOwnerAction('Приход удалён')
  if (!q.data) return <DocShell title="Приход"><StateView state={q.isError ? 'error' : 'loading'} /></DocShell>
  const { supply, items, corrections } = q.data
  return (
    <DocShell title="Приход" action={{ label: 'Исправить', icon: 'edit', onClick: () => router.push(`/manage/goods/supply?supply=${id}`) }}>
      <Header type="supply" date={supply.createdAt} total={money(num(supply.totalCost))} lines={[[supply.supplier, positionsText(items.length)].filter(Boolean).join(' · '), supply.cashOperationId ? 'наличными из кассы смены' : 'не из кассы']} />
      <Card title="Состав">
        {items.map((l, i) => {
          const item = l.itemId ? goods.data?.byId.get(l.itemId) : undefined
          const unit = l.stockUnit ?? item?.unit ?? 'pcs'
          const per = l.packs
            ? { value: (l.costPerUnit * l.quantity) / l.packs, label: `за ${PIECE_NAMES[item?.packName ?? 'pack'].per}` }
            : unitPrice(l.costPerUnit, unit, item?.unitLabel)
          return (
            <Row key={`${l.itemId ?? l.name}-${i}`} onClick={item ? () => router.push(`/manage/goods/item/${item.id}`) : undefined}>
              <span style={{ flex: 1, minWidth: 0 }}><span style={{ display: 'block', fontSize: 15, fontWeight: 600 }}>{item?.name ?? l.name}</span>
                <span style={{ fontSize: 12.5, color: 'var(--on-surface-variant)' }}>{l.itemId ? `${formatQty(l.quantity, unit, item?.unitLabel)}${l.packs ? ` (${pieceText(l.packs, item?.packName ?? 'pack')})` : ''} по ${money(per.value)} ${per.label}` : `${numberText(l.quantity)} ${l.unit} · затрата без карточки`}</span></span>
              <Trailing value={money(l.quantity * l.costPerUnit)} />
            </Row>
          )
        })}
      </Card>
      {corrections.length > 0 && (
        <Card title="Исправления">
          {corrections.map(c => <Row key={c.id}><span style={{ flex: 1 }}><span style={{ display: 'block', fontSize: 14.5 }}>{c.reason}</span><span style={{ fontSize: 12, color: 'var(--on-surface-variant)' }}>{longDate.format(new Date(c.createdAt))}</span></span><Trailing value={`${money(c.totalBefore)} → ${money(c.totalAfter)}`} /></Row>)}
        </Card>
      )}
      {isOwner && <Button variant="danger" icon="delete" fullWidth onClick={() => setConfirm(true)}>Удалить приход</Button>}
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} danger loading={del.busy} confirmLabel="Удалить" title="Удалить приход?"
        message="Принятое количество снимется с остатков; выдача из кассы открытой смены тоже отменится. Себестоимость назад не пересчитается."
        onConfirm={() => void del.run(() => api.delete(`/supplies/${id}`))} />
    </DocShell>
  )
}

function WriteOffView({ id }: { id: string }) {
  const goods = useGoods()
  const isOwner = useAuthStore(s => s.user?.role) === 'owner'
  const q = useQuery({ queryKey: ['goods', 'write-off', id], queryFn: () => api.get<WriteOffDetail>(`/goods/write-offs/${id}`) })
  const [confirm, setConfirm] = useState(false)
  const cancel = useOwnerAction('Списание отменено — товар вернулся')
  if (!q.data) return <DocShell title="Списание"><StateView state={q.isError ? 'error' : 'loading'} /></DocShell>
  const { writeOff, items } = q.data
  return (
    <DocShell title="Списание">
      <Header type="write_off" date={writeOff.createdAt} total={money(num(writeOff.totalCost))} lines={[[writeOff.reason, positionsText(items.length)].filter(Boolean).join(' · '), writeOff.author ? `списал ${writeOff.author}` : '']} />
      {writeOff.note && <p style={{ margin: 0, padding: '0 4px', fontSize: 13, color: 'var(--on-surface-variant)' }}>{writeOff.note}</p>}
      <Card title="Списано">
        {items.map(l => {
          const item = goods.data?.byId.get(l.itemId)
          const portions = item?.stockMode === 'recipe'
          return <Row key={l.id}><span style={{ flex: 1, minWidth: 0 }}><span style={{ display: 'block', fontSize: 15, fontWeight: 600 }}>{l.name}</span><span style={{ fontSize: 12.5, color: 'var(--on-surface-variant)' }}>{portions ? `${l.quantity} ${plural(l.quantity, ['порция', 'порции', 'порций'])} по составу` : formatQty(l.quantity, l.unit ?? item?.unit ?? 'pcs', item?.unitLabel)}</span></span><Trailing value={money(l.quantity * num(l.unitCost))} /></Row>
        })}
      </Card>
      {isOwner && <Button variant="danger" icon="undo" fullWidth onClick={() => setConfirm(true)}>Отменить списание</Button>}
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} danger loading={cancel.busy} confirmLabel="Отменить" title="Отменить списание?" message="Списанное вернётся на склад."
        onConfirm={() => void cancel.run(() => api.delete(`/goods/write-offs/${id}`))} />
    </DocShell>
  )
}

function RevisionView({ id }: { id: string }) {
  const qc = useQueryClient()
  const { show } = useToast()
  const goods = useGoods()
  const q = useQuery({ queryKey: ['goods', 'revision', id], queryFn: () => api.get<RevisionDetail>(`/inventory/revisions/${id}`) })
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  if (!q.data) return <DocShell title="Ревизия"><StateView state={q.isError ? 'error' : 'loading'} /></DocShell>
  const { revision, items } = q.data
  const editable = revision.isLatest && revision.status === 'applied'
  const rows = items.map(l => {
    const raw = (edits[l.id] ?? '').replace(/[^\d]/g, '')
    const actual = raw !== '' ? Number(raw) : l.actual
    const diff = actual - l.expected
    const item = goods.data?.byId.get(l.itemId)
    return { l, unit: l.unit ?? item?.unit ?? 'pcs', label: item?.unitLabel ?? null, actual, diff, value: diff * num(l.costPrice), changed: raw !== '' && actual !== l.actual }
  })
  const changes = rows.filter(r => r.changed)
  const net = rows.reduce((s, r) => s + r.value, 0)
  const save = async () => {
    setBusy(true)
    try {
      await api.patch(`/inventory/revisions/${id}`, { items: changes.map(r => ({ id: r.l.id, actual: r.actual })) })
      refreshGoods(qc); setEdits({}); setEditing(false); show('Ревизия исправлена', 'success')
    } catch (e) { show(e instanceof Error ? e.message : 'Не исправлено', 'error') }
    finally { setBusy(false) }
  }
  return (
    <DocShell title="Ревизия" action={editable ? (editing ? { label: busy ? 'Сохраняем…' : 'Сохранить', icon: 'save', onClick: () => void save() } : { label: 'Исправить', icon: 'edit', onClick: () => setEditing(true) }) : undefined}>
      <Header type="revision" date={revision.createdAt} lines={[positionsText(items.length), revision.author ? `провёл ${revision.author}` : '']}
        total={Math.abs(net) < 0.005 ? 'сходится' : formatMoney(net, { sign: true })} color={net >= 0 ? 'var(--success)' : 'var(--danger)'} />
      <p style={{ margin: 0, padding: '0 4px', fontSize: 12, color: 'var(--on-surface-variant)' }}>{editable ? 'Поправить можно последнюю ревизию: остаток сдвинется на разницу, продажи после неё сохранятся.' : 'Только просмотр: после неё уже была ревизия.'}</p>
      <Card title="Позиции">
        {rows.map(r => (
          <Row key={r.l.id}>
            <span style={{ flex: 1, minWidth: 0 }}><span style={{ display: 'block', fontSize: 15, fontWeight: 600 }}>{r.l.name}</span>
              <span style={{ fontSize: 12.5, color: r.diff === 0 ? 'var(--on-surface-variant)' : r.diff > 0 ? 'var(--success)' : 'var(--danger)' }}>
                учёт {formatQty(r.l.expected, r.unit, r.label)} · {r.diff === 0 ? 'сходится' : `${r.diff > 0 ? '+' : '−'}${formatQty(Math.abs(r.diff), r.unit, r.label)} · ${formatMoney(r.value, { sign: true })}`}
              </span></span>
            {editing ? <QtyField label={`${r.l.name}, факт`} value={edits[r.l.id] ?? String(r.l.actual)} integer suffix={unitWord(r.unit, r.label, edits[r.l.id] ?? String(r.l.actual))} width={130} onChange={v => setEdits(e => ({ ...e, [r.l.id]: v }))} />
              : <Trailing value={formatQty(r.actual, r.unit, r.label)} />}
          </Row>
        ))}
      </Card>
    </DocShell>
  )
}
