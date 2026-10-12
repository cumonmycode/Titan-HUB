'use client'
/**
 * Поставка, собранная Tai со слов: строки правятся прямо в карточке (±, количество,
 * цена, верная позиция склада), «Принять» проводит приход как экран «Приход».
 */
import { useState } from 'react'
import { Icon } from '@/components/Icon'
import { acceptTaiSupply, cancelTaiSupply, editTaiSupply, type TaiRoute, type TaiSupplyCard, type TaiSupplyLine, type TaiSupplyOp } from '@/lib/tai'

const money = (n: number) => `${n.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ₽`
const round: React.CSSProperties = { width: 28, height: 28, borderRadius: 14, border: 'none', background: 'rgba(255,255,255,0.08)', color: 'var(--primary-violet)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }
const plain: React.CSSProperties = { background: 'none', border: 'none', padding: 0, color: 'inherit', cursor: 'pointer', font: 'inherit', textAlign: 'left' }

export function SupplyCard({ card: initial, open }: { card: TaiSupplyCard; open: (to: TaiRoute) => void }) {
  const [card, setCard] = useState(initial)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [choosing, setChoosing] = useState<number | null>(null)
  const draft = card.status === 'draft'

  async function run(key: string, task: () => Promise<TaiSupplyCard | null>) {
    setBusy(key)
    setError(null)
    try {
      const next = await task()
      if (next) setCard(next)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не получилось')
    } finally {
      setBusy(null)
    }
  }
  const edit = (key: string, ops: TaiSupplyOp[]) => run(key, () => editTaiSupply(card.id, ops))
  function ask(title: string, current: number, apply: (n: number) => TaiSupplyOp) {
    const value = window.prompt(title, String(current))
    if (value === null) return
    const n = Number(value.replace(',', '.'))
    if (Number.isFinite(n) && n >= 0) void edit(title, [apply(n)])
  }

  const title = card.status === 'posted' ? 'Поставка принята' : card.status === 'cancelled' ? 'Черновик удалён' : 'Поставка'
  return (
    <div className="glass-l2" style={{ borderRadius: 16, padding: 16, display: 'flex', flexDirection: 'column', gap: 10, opacity: card.status === 'cancelled' ? 0.55 : 1, border: draft ? '1px solid rgba(139,92,246,0.4)' : undefined }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Icon name={card.status === 'posted' ? 'check_circle' : 'inventory_2'} size={20} color={card.status === 'posted' ? '#10B981' : 'var(--primary-violet)'} />
        <p style={{ margin: 0, fontSize: 15, fontWeight: 700, flex: 1 }}>{title}</p>
        {busy && <Icon name="progress_activity" size={16} />}
      </div>
      {card.supplier && <p style={{ margin: 0, fontSize: 13, color: 'var(--on-surface-variant)' }}>Поставщик: {card.supplier}</p>}
      {card.lines.map((line) => (
        <Row key={`${line.index}-${line.itemId ?? line.name}`} line={line} draft={draft} disabled={!!busy} choosing={choosing === line.index}
          onChoose={() => setChoosing(choosing === line.index ? null : line.index)}
          onMatch={(itemId) => { setChoosing(null); void edit('m', [{ op: 'match', line: line.index, itemId }]) }}
          onStep={(direction) => void edit('s', [{ op: 'step', line: line.index, direction }])}
          onRemove={() => void edit('r', [{ op: 'remove', line: line.index }])}
          onQuantity={() => ask(`Количество, ${line.unit}`, line.quantity, (quantity) => ({ op: 'quantity', line: line.index, quantity }))}
          onPrice={() => ask(`Цена за ${line.unit}`, line.costPerUnit, (costPerUnit) => ({ op: 'price', line: line.index, costPerUnit }))}
        />
      ))}
      <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 8, fontWeight: 700 }}>
        <span>Итого</span><span>{money(card.total)}</span>
      </div>
      {draft && (
        <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 14 }}>
          Оплата наличными из кассы
          <input type="checkbox" checked={card.fromRegister} disabled={!!busy} onChange={(e) => void edit('pay', [{ op: 'payment', fromRegister: e.target.checked }])} style={{ width: 18, height: 18, accentColor: '#8B5CF6' }} />
        </label>
      )}
      {error && <p style={{ margin: 0, fontSize: 13, color: '#F43F5E' }}>{error}</p>}
      {card.result && <p style={{ margin: 0, fontSize: 13, color: 'var(--on-surface-variant)' }}>{card.result}</p>}
      {draft && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button type="button" disabled={!!busy} onClick={() => void run('accept', () => acceptTaiSupply(card.id))}
            style={{ flex: 1, padding: '11px 14px', borderRadius: 12, border: 'none', background: 'var(--primary-violet)', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
            {busy === 'accept' ? 'Принимаем…' : `Принять · ${money(card.total)}`}
          </button>
          <button type="button" disabled={!!busy} onClick={() => void run('cancel', () => cancelTaiSupply(card.id))} style={{ ...plain, color: 'var(--on-surface-variant)', fontSize: 14 }}>Отменить</button>
        </div>
      )}
      {card.status !== 'cancelled' && (
        <button type="button" onClick={() => open({ screen: 'supply', supplyId: card.id, draft })} style={{ ...plain, color: 'var(--primary-violet)', fontSize: 13, fontWeight: 600 }}>
          {draft ? 'Открыть в редакторе прихода' : 'Открыть приход'}
        </button>
      )}
    </div>
  )
}

function Row(p: {
  line: TaiSupplyLine; draft: boolean; disabled: boolean; choosing: boolean
  onChoose: () => void; onMatch: (itemId: string) => void; onStep: (d: 1 | -1) => void; onRemove: () => void; onQuantity: () => void; onPrice: () => void
}) {
  const { line, draft, disabled } = p
  const doubtful = draft && line.uncertain
  const packs = line.packs && line.packSize ? ` · ${line.packs} ${line.packName || 'уп'}` : ''
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
      <button type="button" onClick={doubtful && line.alternatives?.length ? p.onChoose : undefined} disabled={!doubtful} style={{ ...plain, cursor: doubtful ? 'pointer' : 'default' }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: doubtful ? '#F59E0B' : 'var(--on-surface)' }}>{doubtful ? '? ' : ''}{line.index + 1}. {line.name}</span>
        {line.said && <span style={{ display: 'block', fontSize: 12, color: 'var(--on-surface-variant)' }}>сказали «{line.said}»{doubtful ? ' — нажмите, чтобы выбрать позицию' : ''}</span>}
      </button>
      {p.choosing && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {(line.alternatives ?? []).map((alt) => (
            <button key={alt.itemId} type="button" onClick={() => p.onMatch(alt.itemId)} style={{ padding: '6px 10px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.04)', color: 'var(--on-surface)', fontSize: 13, cursor: 'pointer' }}>{alt.name}</button>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
        {draft && <button type="button" aria-label="Меньше" disabled={disabled} onClick={() => p.onStep(-1)} style={round}><Icon name="remove" size={16} /></button>}
        <button type="button" disabled={!draft || disabled} onClick={p.onQuantity} style={plain}>{line.quantity} {line.unit}{packs}</button>
        {draft && <button type="button" aria-label="Больше" disabled={disabled} onClick={() => p.onStep(1)} style={round}><Icon name="add" size={16} /></button>}
        <button type="button" disabled={!draft || disabled} onClick={p.onPrice} style={{ ...plain, flex: 1, color: 'var(--on-surface-variant)' }}>× {money(line.costPerUnit)}</button>
        <span style={{ fontWeight: 700 }}>{money(line.sum)}</span>
        {draft && <button type="button" aria-label="Убрать строку" disabled={disabled} onClick={p.onRemove} style={{ ...round, color: '#F43F5E' }}><Icon name="delete" size={16} /></button>}
      </div>
    </div>
  )
}
