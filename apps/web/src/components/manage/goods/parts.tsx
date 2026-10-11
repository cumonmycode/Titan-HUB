'use client'
/**
 * Общие элементы веб-раздела «Товары»: карточка-секция, строки позиции меню, остатка и
 * документа, поле количества с единицей, полоска запаса. Стиль — «тихая роскошь»:
 * один violet-акцент, цвет только смысловой (уровень запаса, излишек/недостача).
 */
import React from 'react'
import { Icon } from '@/components/Icon'
import { formatMoney } from '@/components/manage/DesignSystem'
import {
  LEVEL_LOOK, daysLeft, itemQty, margin, packText, plural, positionsText, servings, stockLevel,
  type Catalog, type DocType, type GoodsDocument, type GoodsItem, type MovementType,
} from '@/lib/goods'

export const money = (n: number) => formatMoney(n, { kopecks: Math.round(n * 100) % 100 !== 0 })

export const MOVEMENT_LOOK: Record<MovementType, { label: string; icon: string; color: string }> = {
  receipt: { label: 'Приход', icon: 'local_shipping', color: '#34D399' },
  sale: { label: 'Продажа', icon: 'shopping_cart', color: '#60A5FA' },
  return: { label: 'Возврат', icon: 'undo', color: '#22D3EE' },
  write_off: { label: 'Списание', icon: 'delete', color: '#FB7185' },
  count: { label: 'Ревизия', icon: 'fact_check', color: '#F59E0B' },
  adjustment: { label: 'Корректировка', icon: 'tune', color: '#A78BFA' },
  opening: { label: 'Начальный остаток', icon: 'inventory', color: '#94A3B8' },
  transfer: { label: 'Перемещение', icon: 'repeat', color: '#94A3B8' },
}

export const DOC_LOOK: Record<DocType, { label: string; icon: string; color: string }> = {
  supply: { label: 'Приход', icon: 'local_shipping', color: '#34D399' },
  write_off: { label: 'Списание', icon: 'delete', color: '#FB7185' },
  revision: { label: 'Ревизия', icon: 'fact_check', color: '#F59E0B' },
}

const MUTED = 'var(--on-surface-variant)'

/** Секция: подпись над стеклянной карточкой, строки внутри разделены тонкой линией. */
export function Card({ title, footer, children, action }: { title?: string; footer?: React.ReactNode; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {(title || action) && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '0 4px' }}>
          {title && <h2 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: MUTED }}>{title}</h2>}
          {action}
        </div>
      )}
      <div className="glass-l2 goods-card" style={{ borderRadius: 18, overflow: 'hidden' }}>{children}</div>
      {footer && <p style={{ margin: 0, padding: '0 4px', fontSize: 12, lineHeight: 1.45, color: MUTED }}>{footer}</p>}
      <style>{`.goods-card > * + * { border-top: 1px solid rgba(255,255,255,0.06); }`}</style>
    </section>
  )
}

/** Строка карточки: кнопка с откликом наведения, если есть onClick. */
export function Row({ onClick, children, ariaLabel, padding = '12px 16px' }: { onClick?: () => void; children: React.ReactNode; ariaLabel?: string; padding?: string }) {
  const style: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 12, padding, minHeight: 56, width: '100%', boxSizing: 'border-box', textAlign: 'left', background: 'transparent', border: 'none', color: 'var(--on-surface)', font: 'inherit' }
  if (!onClick) return <div style={style}>{children}</div>
  return (
    <button onClick={onClick} aria-label={ariaLabel} className="goods-row" style={{ ...style, cursor: 'pointer' }}>
      {children}
      <Icon name="chevron_right" size={18} color={MUTED} />
      <style>{`.goods-row:hover { background: rgba(255,255,255,0.03); } .goods-row:active { background: rgba(255,255,255,0.06); }`}</style>
    </button>
  )
}

export function IconPlate({ icon, color, size = 34 }: { icon: string; color: string; size?: number }) {
  return (
    <span style={{ width: size, height: size, borderRadius: size * 0.3, background: `${color}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <Icon name={icon} size={Math.round(size * 0.55)} color={color} />
    </span>
  )
}

function Titles({ title, subtitle, subtitleColor, muted }: { title: React.ReactNode; subtitle?: React.ReactNode; subtitleColor?: string; muted?: boolean }) {
  return (
    <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: 15, fontWeight: 600, color: muted ? MUTED : 'var(--on-surface)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
      {subtitle && <span style={{ fontSize: 12.5, color: subtitleColor ?? MUTED, lineHeight: 1.35 }}>{subtitle}</span>}
    </span>
  )
}

export function Trailing({ value, caption, color, captionColor }: { value: React.ReactNode; caption?: React.ReactNode; color?: string; captionColor?: string }) {
  return (
    <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2, flexShrink: 0 }}>
      <span style={{ fontSize: 15, fontWeight: 700, color: color ?? 'var(--on-surface)', fontVariantNumeric: 'tabular-nums' }}>{value}</span>
      {caption && <span style={{ fontSize: 11.5, color: captionColor ?? MUTED, fontVariantNumeric: 'tabular-nums' }}>{caption}</span>}
    </span>
  )
}

/** Полоска запаса: сколько осталось до целевого уровня (или двойной точки заказа). */
export function LevelBar({ item, width = 72 }: { item: Pick<GoodsItem, 'stockQuantity' | 'reorderPoint' | 'parLevel'>; width?: number }) {
  const max = item.parLevel ?? (item.reorderPoint ? item.reorderPoint * 2 : 0)
  if (max <= 0) return null
  const share = Math.max(0, Math.min(1, item.stockQuantity / max))
  return (
    <span aria-hidden style={{ display: 'block', width, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
      <span style={{ display: 'block', height: '100%', width: `${share * 100}%`, borderRadius: 2, background: LEVEL_LOOK[stockLevel(item)].color, transition: 'width 0.3s' }} />
    </span>
  )
}

/** Что сказать про запас позиции меню: штуки, порции по составу или ничего. */
export function stockCaption(item: GoodsItem, catalog: Catalog): { text: string; color?: string } | null {
  if (item.stockMode === 'pieces') {
    const level = stockLevel(item)
    return { text: level === 'out' ? 'нет на складе' : itemQty(item, item.stockQuantity), color: level === 'ok' ? undefined : LEVEL_LOOK[level].color }
  }
  if (item.stockMode === 'recipe') {
    const s = servings(item, catalog.byId)
    if (!s) return { text: 'по составу' }
    if (s.count === 0) return { text: `не хватает: ${s.limitedBy?.name ?? 'состава'}`, color: LEVEL_LOOK.out.color }
    return { text: `≈ ${s.count} ${plural(s.count, ['порция', 'порции', 'порций'])}` }
  }
  return null
}

export function MenuRow({ item, catalog, onClick }: { item: GoodsItem; catalog: Catalog; onClick: () => void }) {
  const stock = stockCaption(item, catalog)
  const m = margin(item.price, item.costPrice)
  const notes = [!item.isActive ? 'скрыта из кассы' : null, item.role === 'rental' ? 'аренда' : null].filter(Boolean).join(' · ')
  return (
    <Row onClick={onClick} ariaLabel={item.name}>
      <Titles
        muted={!item.isActive}
        title={<>{item.isTop && <Icon name="star" size={13} color="#F59E0B" style={{ marginRight: 4, verticalAlign: '-1px' }} />}{item.name}</>}
        subtitle={stock || notes ? <>{stock && <span style={{ color: stock.color }}>{stock.text}</span>}{stock && notes ? ' · ' : ''}{notes}</> : undefined}
      />
      <Trailing value={money(item.price)} caption={m !== null ? `маржа ${m}%` : undefined} captionColor={m !== null && m < 0 ? 'var(--danger)' : undefined} />
    </Row>
  )
}

export function StockRow({ item, usedIn, onClick }: { item: GoodsItem; usedIn?: number; onClick: () => void }) {
  const level = stockLevel(item)
  const days = daysLeft(item)
  const caption = [
    item.kind === 'ingredient' && usedIn ? `в ${usedIn} ${plural(usedIn, ['блюде', 'блюдах', 'блюдах'])}` : null,
    item.kind === 'ingredient' ? packText(item) : null,
    level !== 'out' && days !== null ? `хватит на ${days} ${plural(days, ['день', 'дня', 'дней'])}` : null,
    item.reorderPoint ? `заказ при ${itemQty(item, item.reorderPoint)}` : null,
  ].filter(Boolean).join(' · ')
  return (
    <Row onClick={onClick} ariaLabel={item.name}>
      <Titles title={item.name} subtitle={caption || undefined} />
      <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, minWidth: 80 }}>
        <span style={{ fontSize: 15, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: level === 'ok' ? 'var(--on-surface)' : LEVEL_LOOK[level].color }}>{itemQty(item, item.stockQuantity)}</span>
        <LevelBar item={item} />
      </span>
    </Row>
  )
}

const dayTime = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' })

export function docTitle(doc: Pick<GoodsDocument, 'type' | 'title'>): string {
  return doc.title ? `${DOC_LOOK[doc.type].label} · ${doc.title}` : DOC_LOOK[doc.type].label
}

export function docAmount(doc: Pick<GoodsDocument, 'type' | 'amount' | 'surplus' | 'shortage' | 'status'>): { text: string; color?: string } {
  if (doc.type !== 'revision') return { text: doc.amount > 0 ? money(doc.amount) : '' }
  if (doc.status === 'draft') return { text: '' }
  if (!doc.surplus && !doc.shortage) return { text: 'сходится', color: 'var(--success)' }
  return { text: formatMoney(doc.amount, { sign: true }), color: doc.amount >= 0 ? 'var(--success)' : 'var(--danger)' }
}

export function DocRow({ doc, onClick }: { doc: GoodsDocument; onClick: () => void }) {
  const look = DOC_LOOK[doc.type]
  const date = new Date(doc.status === 'draft' && doc.updatedAt ? doc.updatedAt : doc.createdAt)
  const amount = docAmount(doc)
  const caption = [positionsText(doc.positions), Number.isNaN(date.getTime()) ? null : dayTime.format(date).replace('.', ''), doc.author, doc.fromRegister ? 'из кассы' : null].filter(Boolean).join(' · ')
  return (
    <Row onClick={onClick} ariaLabel={docTitle(doc)}>
      <IconPlate icon={doc.status === 'draft' ? 'edit' : look.icon} color={doc.status === 'draft' ? '#A78BFA' : look.color} />
      <Titles title={docTitle(doc)} subtitle={caption} />
      {amount.text && <Trailing value={amount.text} color={amount.color} />}
    </Row>
  )
}

/** Поле числа с единицей справа: «2 кг», «18 г», «1 850 ₽ за кг». */
export function QtyField({ value, onChange, suffix, integer, invalid, label, placeholder = '0', width }: {
  value: string; onChange: (v: string) => void; suffix: string; integer?: boolean; invalid?: boolean; label: string; placeholder?: string; width?: number
}) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 42, padding: '0 12px', borderRadius: 12, background: 'rgba(255,255,255,0.05)', border: `1px solid ${invalid ? 'rgba(251,113,133,0.6)' : 'rgba(255,255,255,0.1)'}`, flex: width ? `0 0 ${width}px` : '1 1 120px', minWidth: 0, boxSizing: 'border-box' }}>
      <input
        aria-label={label}
        value={value}
        inputMode={integer ? 'numeric' : 'decimal'}
        placeholder={placeholder}
        onFocus={e => e.currentTarget.select()}
        onChange={e => onChange(integer ? e.target.value.replace(/[^\d]/g, '') : e.target.value.replace(/[^\d.,]/g, '').replace('.', ','))}
        style={{ flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none', color: 'var(--on-surface)', fontSize: 15, fontVariantNumeric: 'tabular-nums' }}
      />
      <span style={{ fontSize: 12.5, color: MUTED, whiteSpace: 'nowrap' }}>{suffix}</span>
    </label>
  )
}

/** Сегмент-переключатель: подпись и (если задана) иконка слева. */
export function Segments<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { key: T; label: string; icon?: string }[] }) {
  return (
    <div style={{ display: 'flex', gap: 4, padding: 4, borderRadius: 14, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
      {items.map(t => {
        const active = value === t.key
        return (
          <button key={t.key} onClick={() => onChange(t.key)} aria-pressed={active}
            style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '10px 6px', borderRadius: 11, border: 'none', cursor: 'pointer', transition: 'background 0.15s', background: active ? 'var(--primary-violet)' : 'transparent', color: active ? '#fff' : MUTED, fontSize: 13, fontWeight: 700 }}>
            {t.icon && <Icon name={t.icon} size={17} color={active ? '#fff' : MUTED} />}
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.label}</span>
          </button>
        )
      })}
    </div>
  )
}

export function SearchField({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 46, padding: '0 14px', borderRadius: 14, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}>
      <Icon name="search" size={18} color={MUTED} />
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder}
        style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'var(--on-surface)', fontSize: 15 }} />
      {value && <button onClick={() => onChange('')} aria-label="Очистить" style={{ background: 'none', border: 'none', cursor: 'pointer', color: MUTED, display: 'flex' }}><Icon name="close" size={16} /></button>}
    </label>
  )
}

/** Лента чипсов, листается по горизонтали. */
export function ChipRow({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2, scrollbarWidth: 'none' }}>{children}</div>
}
