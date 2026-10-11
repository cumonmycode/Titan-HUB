'use client'
/**
 * Интерактивные блоки ответа Tai (веб): показатели, столбцы, доли, список, карточка
 * действия, выбор и переходы. Столбец и доля показывают точные цифры и ведут в чеки,
 * строки и ссылки открывают экраны, карточка выполняет действие по нажатию.
 */
import { useState } from 'react'
import { Icon } from '@/components/Icon'
import type { TaiActionCard, TaiBlock, TaiLink, TaiRoute } from '@/lib/tai'
import { useTaiStore } from '@/store/tai.store'

type Open = (to: TaiRoute) => void

const CARD: React.CSSProperties = { borderRadius: 16, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }
const CAPTION: React.CSSProperties = { fontSize: 12, color: 'var(--on-surface-variant)', margin: 0 }
const fmt = (n: number) => `${Math.round(n).toLocaleString('ru')} ₽`

function LinkLine({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', padding: 0, color: 'var(--primary-violet)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
      {label} <Icon name="chevron_right" size={15} />
    </button>
  )
}

export function TaiBlockView({ block, open }: { block: TaiBlock; open: Open }) {
  switch (block.type) {
    case 'metrics':
      return (
        <div className="glass-l2" style={CARD}>
          {block.title && <p style={CAPTION}>{block.title}</p>}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
            {block.items.map((m) => {
              const good = !m.delta ? null : m.invert ? m.delta < 0 : m.delta > 0
              return (
                <div key={m.label} style={{ minWidth: 0 }}>
                  <p style={{ ...CAPTION, fontSize: 11 }}>{m.label}</p>
                  <p style={{ margin: '2px 0 0', fontSize: 19, fontWeight: 800, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.value}</p>
                  {good !== null ? (
                    <p style={{ margin: '2px 0 0', fontSize: 11, fontWeight: 700, color: good ? '#10B981' : '#F43F5E' }}>{`${m.delta! > 0 ? '+' : '−'}${Math.abs(m.delta!)}%`}</p>
                  ) : m.hint ? <p style={{ ...CAPTION, fontSize: 11, marginTop: 2 }}>{m.hint}</p> : null}
                </div>
              )
            })}
          </div>
          {block.link && <LinkLine label={block.link.label} onClick={() => open(block.link!.to)} />}
        </div>
      )
    case 'chart':
      return <ChartBlock block={block} open={open} />
    case 'breakdown':
      return <BreakdownBlock block={block} open={open} />
    case 'list':
      return (
        <div className="glass-l2" style={{ ...CARD, gap: 8 }}>
          <p style={CAPTION}>{block.title}</p>
          {block.rows.length === 0 ? <p style={{ margin: 0, fontSize: 13, color: 'var(--on-surface-variant)' }}>{block.empty ?? 'Пусто'}</p> : (
            <div>
              {block.rows.map((row, i) => (
                <button key={row.id + i} disabled={!row.to} onClick={() => row.to && open(row.to)} className="tai-row"
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', border: 'none', borderTop: i ? '1px solid rgba(255,255,255,0.06)' : 'none', background: 'none', borderRadius: 0, color: 'var(--on-surface)', cursor: row.to ? 'pointer' : 'default', textAlign: 'left' }}>
                  {row.avatar && (row.avatar.url
                    ? <img src={row.avatar.url} alt="" width={30} height={30} style={{ borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
                    : <span style={{ width: 30, height: 30, borderRadius: '50%', background: 'rgba(139,92,246,0.18)', color: 'var(--primary-violet)', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{row.avatar.name.slice(0, 2).toUpperCase()}</span>)}
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.title}</span>
                    {row.subtitle && <span style={{ display: 'block', fontSize: 12, color: 'var(--on-surface-variant)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.subtitle}</span>}
                  </span>
                  {row.value && <span style={{ fontSize: 14, fontWeight: 700, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{row.value}</span>}
                  {row.to && <Icon name="chevron_right" size={15} color="rgba(204,195,216,0.4)" />}
                </button>
              ))}
            </div>
          )}
          {block.more && <LinkLine label={block.more.label} onClick={() => open(block.more!.to)} />}
        </div>
      )
    case 'action':
      return <ActionBlock card={block.action} open={open} />
    case 'choice':
      return <ChoiceBlock block={block} />
    case 'links':
      return <LinksBlock links={block.links} open={open} />
  }
}

function ChartBlock({ block, open }: { block: Extract<TaiBlock, { type: 'chart' }>; open: Open }) {
  const [selected, setSelected] = useState<string | null>(null)
  const max = Math.max(1, ...block.points.map((p) => p.value))
  const point = block.points.find((p) => p.key === selected)
  const every = Math.max(1, Math.ceil(block.points.length / 10))
  return (
    <div className="glass-l2" style={CARD}>
      <p style={CAPTION}>{block.title}</p>
      <div style={{ minHeight: 40, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 2 }}>
        {point ? (
          <>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>{point.detail ?? `${point.label} · ${block.unit === 'money' ? fmt(point.value) : point.value}`}</p>
            {point.to && <LinkLine label={point.toLabel ?? 'Подробнее'} onClick={() => open(point.to!)} />}
          </>
        ) : <p style={CAPTION}>{block.caption ?? 'Нажмите на столбец — покажу цифры'}</p>}
      </div>
      <div role="group" aria-label={block.title} style={{ display: 'flex', alignItems: 'flex-end', gap: block.points.length > 40 ? 1 : 3, height: 120 }}>
        {block.points.map((p) => (
          <button key={p.key} onClick={() => setSelected((s) => (s === p.key ? null : p.key))} title={p.detail ?? p.label} aria-pressed={p.key === selected}
            style={{ flex: 1, minWidth: 0, height: '100%', display: 'flex', alignItems: 'flex-end', padding: 0, background: 'none', border: 'none', cursor: 'pointer' }}>
            <span style={{ display: 'block', width: '100%', height: `${Math.max(p.value > 0 ? 3 : 1, (p.value / max) * 100)}%`, borderRadius: 3, background: p.value > 0 ? 'var(--primary-violet)' : 'rgba(255,255,255,0.1)', opacity: selected && p.key !== selected ? 0.3 : 1, transition: 'opacity .15s' }} />
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: block.points.length > 40 ? 1 : 3, marginTop: -6 }}>
        {block.points.map((p, i) => (
          <span key={p.key} style={{ flex: 1, minWidth: 0, fontSize: 10, color: p.key === selected ? 'var(--on-surface)' : 'rgba(204,195,216,0.5)', whiteSpace: 'nowrap', overflow: 'visible' }}>{i % every === 0 ? p.label : ''}</span>
        ))}
      </div>
    </div>
  )
}

function BreakdownBlock({ block, open }: { block: Extract<TaiBlock, { type: 'breakdown' }>; open: Open }) {
  const [selected, setSelected] = useState<string | null>(null)
  const current = block.parts.find((p) => p.key === selected)
  return (
    <div className="glass-l2" style={CARD}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <p style={CAPTION}>{block.title}</p>
        <p style={{ ...CAPTION, color: 'var(--on-surface)', fontWeight: 700 }}>{current ? `${current.label}: ${fmt(current.value)} · ${current.share}%` : block.total}</p>
      </div>
      <div style={{ display: 'flex', height: 12, borderRadius: 999, overflow: 'hidden', gap: 2 }}>
        {block.parts.map((p) => (
          <button key={p.key} onClick={() => setSelected((s) => (s === p.key ? null : p.key))} title={`${p.label}: ${p.share}%`}
            style={{ width: `${Math.max(p.share, 1)}%`, border: 'none', padding: 0, cursor: 'pointer', background: p.color ?? 'var(--primary-violet)', opacity: selected && p.key !== selected ? 0.3 : 1 }} />
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {block.parts.map((p) => (
          <button key={p.key} onClick={() => (p.to && selected === p.key ? open(p.to) : setSelected((s) => (s === p.key ? null : p.key)))}
            style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 8px', borderRadius: 10, border: 'none', background: selected === p.key ? 'rgba(255,255,255,0.06)' : 'none', color: 'var(--on-surface)', cursor: 'pointer', textAlign: 'left' }}>
            <span style={{ width: 9, height: 9, borderRadius: '50%', background: p.color ?? 'var(--primary-violet)', flexShrink: 0 }} />
            <span style={{ flex: 1, fontSize: 13 }}>{p.label}</span>
            <span style={{ fontSize: 12, color: 'var(--on-surface-variant)' }}>{p.share}%</span>
            <span style={{ fontSize: 13, fontWeight: 700, minWidth: 84, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(p.value)}</span>
          </button>
        ))}
      </div>
      {current?.to && <LinkLine label={`Чеки: ${current.label}`} onClick={() => open(current.to!)} />}
    </div>
  )
}

function ActionBlock({ card, open }: { card: TaiActionCard; open: Open }) {
  const confirm = useTaiStore((s) => s.confirm)
  const dismiss = useTaiStore((s) => s.dismiss)
  const [busy, setBusy] = useState(false)
  const done = card.status === 'done'
  const failed = card.status === 'failed'
  const cancelled = card.status === 'cancelled'
  return (
    <div className="glass-l2" style={{ ...CARD, opacity: cancelled ? 0.5 : 1, border: card.status === 'pending' ? `1px solid ${card.destructive ? 'rgba(244,63,94,0.4)' : 'rgba(139,92,246,0.4)'}` : undefined }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Icon name={done ? 'check_circle' : failed ? 'error' : card.destructive ? 'delete' : 'bolt'} size={20} color={done ? '#10B981' : failed ? '#F59E0B' : card.destructive ? '#F43F5E' : 'var(--primary-violet)'} />
        <p style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{card.title}</p>
      </div>
      <div>
        {card.rows.map((r, i) => (
          <div key={`${r.label}-${i}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '4px 0', fontSize: 13 }}>
            <span style={{ color: 'var(--on-surface-variant)' }}>{r.label}</span>
            <span style={{ fontWeight: 600, textAlign: 'right' }}>{r.value}</span>
          </div>
        ))}
        {card.total && (
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '8px 0 0', marginTop: 4, borderTop: '1px solid rgba(255,255,255,0.08)', fontSize: 15, fontWeight: 800 }}>
            <span>Итого</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{card.total}</span>
          </div>
        )}
      </div>
      {card.status === 'pending' ? (
        <div style={{ display: 'flex', gap: 8 }}>
          <button disabled={busy} onClick={async () => { setBusy(true); await confirm(card.id); setBusy(false) }}
            style={{ flex: 1, padding: '11px 14px', borderRadius: 12, border: 'none', background: card.destructive ? '#F43F5E' : 'var(--primary-violet)', color: '#fff', fontSize: 14, fontWeight: 700, cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.7 : 1 }}>
            {busy ? 'Выполняю…' : card.confirmLabel}
          </button>
          <button disabled={busy} onClick={() => dismiss(card.id)} style={{ padding: '11px 14px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)', color: 'var(--on-surface-variant)', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
            Отмена
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <span style={{ fontSize: 13, color: failed ? '#F43F5E' : 'var(--on-surface-variant)' }}>{cancelled ? 'Отменено' : card.result}</span>
          {done && card.to && <LinkLine label={card.to.screen === 'check' ? 'Перейти к чеку' : 'Открыть'} onClick={() => open(card.to!)} />}
        </div>
      )}
    </div>
  )
}

function ChoiceBlock({ block }: { block: Extract<TaiBlock, { type: 'choice' }> }) {
  const send = useTaiStore((s) => s.send)
  const busy = useTaiStore((s) => s.busy)
  const [picked, setPicked] = useState<string | null>(null)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <p style={{ margin: 0, fontSize: 15 }}>{block.question}</p>
      {block.options.map((o) => (
        <button key={o.label} disabled={busy || picked !== null} onClick={() => { setPicked(o.label); void send(o.reply, { display: o.label }) }} className="glass-l2"
          style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderRadius: 14, color: 'var(--on-surface)', cursor: 'pointer', textAlign: 'left', opacity: picked && picked !== o.label ? 0.45 : 1 }}>
          <span style={{ flex: 1 }}>
            <span style={{ display: 'block', fontSize: 14, fontWeight: 700 }}>{o.label}</span>
            {o.subtitle && <span style={{ display: 'block', fontSize: 12, color: 'var(--on-surface-variant)' }}>{o.subtitle}</span>}
          </span>
          <Icon name={picked === o.label ? 'check_circle' : 'chevron_right'} size={18} color={picked === o.label ? 'var(--primary-violet)' : 'rgba(204,195,216,0.4)'} />
        </button>
      ))}
    </div>
  )
}

function LinksBlock({ links, open }: { links: TaiLink[]; open: Open }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {links.map((l) => (
        <button key={l.label} onClick={() => open(l.to)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 14px', borderRadius: 999, border: '1px solid rgba(139,92,246,0.4)', background: 'rgba(139,92,246,0.1)', color: 'var(--primary-violet)', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
          {l.label} <Icon name="north_east" size={14} />
        </button>
      ))}
    </div>
  )
}
