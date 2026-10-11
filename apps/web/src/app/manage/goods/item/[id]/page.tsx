'use client'
/**
 * Карточка позиции: цена и маржа (или остаток ингредиента), как учитывается и из чего
 * состоит, продажи и расход за 30 дней, журнал движений. Правка — «Изменить»;
 * остаток меняют документы (приход, списание, ревизия), открываются с этой позицией.
 */
import React, { useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { PageHeader, Button } from '@/components/manage/DesignSystem'
import { StateView } from '@/components/StateView'
import { Icon } from '@/components/Icon'
import { Card, IconPlate, LevelBar, MOVEMENT_LOOK, Row, Trailing, money } from '@/components/manage/goods/parts'
import { ItemEditor, type EditorTarget } from '@/components/manage/goods/ItemEditor'
import {
  LEVEL_LOOK, PIECE_NAMES, daysLeft, itemQty, margin, packText, plural, servings, stockLevel, unitPrice, useGoods, useGoodsCard,
  type Catalog, type DaySeries, type GoodsCard, type GoodsItem, type GoodsMovement,
} from '@/lib/goods'

const MUTED = 'var(--on-surface-variant)'
const longDate = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: 'Europe/Moscow' })
const moveDate = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' })
const SHORT = 12

export default function GoodsItemPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const goods = useGoods()
  const card = useGoodsCard(id)
  const [editor, setEditor] = useState<EditorTarget | null>(null)
  const item = goods.data?.byId.get(id)

  if (!goods.data || !item) {
    return (
      <div style={{ minHeight: '100dvh' }}>
        <PageHeader title="Позиция" onBack={() => router.push('/manage/goods')} />
        <div style={{ padding: 16 }}><StateView state={goods.isError ? 'error' : goods.data ? 'empty' : 'loading'} title={goods.data ? 'Позиция удалена' : undefined} /></div>
      </div>
    )
  }
  const catalog = goods.data
  const category = catalog.categories.find(c => c.id === item.category)?.name ?? null
  const tracked = item.kind === 'ingredient' || item.stockMode === 'pieces'

  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <PageHeader title={item.name} subtitle={item.kind === 'ingredient' ? 'Ингредиент' : category ?? 'Без категории'}
        action={item.role !== 'tariff' ? { label: 'Изменить', icon: 'edit', onClick: () => setEditor({ kind: item.kind, itemId: item.id }) } : undefined} />
      <div style={{ padding: '16px 16px var(--bottom-nav-clear, 24px)', maxWidth: 'var(--content-narrow)', margin: '0 auto', width: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 18 }}>
        {item.kind !== 'ingredient' && <ItemHero item={item} />}
        {tracked && <StockHero item={item} />}

        {item.stockMode === 'recipe' && (() => {
          const portions = servings(item, catalog.byId)
          return (
            <Card title="Состав порции" footer={`Порция стоит ${money(item.costPrice)}.${portions ? (portions.count > 0 ? ` Хватит на ≈ ${portions.count} ${plural(portions.count, ['порцию', 'порции', 'порций'])} — первым кончится «${portions.limitedBy?.name}».` : ` Не хватает «${portions.limitedBy?.name}».`) : ''} Продажа списывает состав со склада.`}>
              {item.recipe.map(l => {
                const c = catalog.byId.get(l.componentId)
                return (
                  <Row key={l.componentId} onClick={c ? () => router.push(`/manage/goods/item/${c.id}`) : undefined}>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: 15, fontWeight: 600 }}>{c?.name ?? 'Удалённый ингредиент'}</span>
                      {c && <span style={{ fontSize: 12.5, color: MUTED }}>на складе {itemQty(c, c.stockQuantity)}</span>}
                    </span>
                    {c && <Trailing value={itemQty(c, l.quantity)} caption={money(l.quantity * c.costPrice)} />}
                  </Row>
                )
              })}
            </Card>
          )
        })()}

        {item.stockMode === 'none' && item.kind !== 'ingredient' && item.role !== 'tariff' && (
          <Card footer="Продажи не списывают эту позицию со склада. Включить учёт штуками или по составу — кнопкой «Изменить».">
            <Row><IconPlate icon="inventory_2" color="#94A3B8" /><span style={{ fontSize: 15 }}>Остатки не учитываются</span></Row>
          </Card>
        )}

        {item.kind === 'ingredient' && <UsedIn ingredient={item} catalog={catalog} />}
        {card.data && <Activity item={item} card={card.data} />}
        {tracked && <Journal item={item} card={card.data} loading={card.isLoading} />}
      </div>
      <ItemEditor target={editor} catalog={catalog} onClose={() => setEditor(null)} />
    </div>
  )
}

/** Блюда, в чьём составе есть ингредиент, и сколько его уходит на порцию. */
function UsedIn({ ingredient, catalog }: { ingredient: GoodsItem; catalog: Catalog }) {
  const router = useRouter()
  const users = catalog.items.filter(i => i.recipe.some(l => l.componentId === ingredient.id))
  return (
    <Card title="Используется в" footer={users.length === 0 ? 'Добавьте ингредиент в состав блюда — продажи начнут списывать его сами.' : undefined}>
      {users.length === 0 ? <Row><span style={{ color: MUTED }}>Пока ни в одном блюде</span></Row>
        : users.map(p => {
          const l = p.recipe.find(x => x.componentId === ingredient.id)
          return <Row key={p.id} onClick={() => router.push(`/manage/goods/item/${p.id}`)}><span style={{ flex: 1, fontSize: 15, fontWeight: 600 }}>{p.name}</span>{l && <Trailing value={itemQty(ingredient, l.quantity)} caption="на порцию" />}</Row>
        })}
    </Card>
  )
}

function Place({ label, on }: { label: string; on: boolean }) {
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 13, color: on ? 'var(--on-surface)' : MUTED }}><Icon name={on ? 'check_circle' : 'visibility_off'} size={15} color={on ? 'var(--success)' : MUTED} />{label}</span>
}

function ItemHero({ item }: { item: GoodsItem }) {
  const m = margin(item.price, item.costPrice)
  const costNote = item.stockMode === 'recipe' ? 'по составу' : item.stockMode === 'pieces' && item.hasReceipts ? 'средняя по приходам' : item.costPrice > 0 ? 'задана вручную' : 'не задана'
  return (
    <div className="glass-l2" style={{ borderRadius: 18, padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1 }}>
          {item.isTop && <span style={{ fontSize: 12, color: '#F59E0B', fontWeight: 700 }}>★ хит продаж</span>}
          <div style={{ fontSize: 32, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{money(item.price)}</div>
        </div>
        {m !== null && (
          <div style={{ minWidth: 72, padding: '8px 12px', borderRadius: 14, textAlign: 'center', background: m < 0 ? 'var(--danger)' : 'rgba(255,255,255,0.06)' }}>
            <div style={{ fontSize: 18, fontWeight: 800 }}>{m}%</div><div style={{ fontSize: 11, color: m < 0 ? '#fff' : MUTED }}>маржа</div>
          </div>
        )}
      </div>
      <div style={{ fontSize: 14, color: MUTED }}>Себестоимость {item.costPrice > 0 ? money(item.costPrice) : '—'} · {costNote}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}><Place label="Касса" on={item.isActive} /><Place label="Titan Home" on={item.isTabletVisible} /><Place label="Экран ТВ" on={item.isScreenVisible} /></div>
    </div>
  )
}

function StockHero({ item }: { item: GoodsItem }) {
  const router = useRouter()
  const level = stockLevel(item)
  const look = LEVEL_LOOK[level]
  const days = daysLeft(item)
  const price = unitPrice(item.costPrice, item.unit, item.unitLabel)
  const pack = packText(item)
  return (
    <Card title="Склад" footer={pack ? `Фасовка: ${pack}. В приходе вносите ${PIECE_NAMES[item.packName ?? 'pack'].forms[2]} — количество подставится, его можно поправить на факт.` : 'Остаток меняют приход, списание и ревизия; продажи кассы списывают сами.'}>
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12.5, color: look.color }}>{look.label}</div>
            <div style={{ fontSize: 28, fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: level === 'ok' ? 'var(--on-surface)' : look.color }}>{itemQty(item, item.stockQuantity)}</div>
          </div>
          {days !== null && <div style={{ minWidth: 64, padding: '8px 12px', borderRadius: 14, background: 'rgba(255,255,255,0.06)', textAlign: 'center' }}><div style={{ fontSize: 18, fontWeight: 800 }}>{days}</div><div style={{ fontSize: 11, color: MUTED }}>{plural(days, ['день', 'дня', 'дней'])}</div></div>}
        </div>
        <div style={{ fontSize: 14, color: MUTED }}>
          {item.costPrice > 0 ? `${money(Math.max(0, item.stockQuantity) * item.costPrice)} на складе · ${money(price.value)} ${price.label}` : 'Себестоимость появится с первым приходом'}
        </div>
        {(item.reorderPoint || item.parLevel) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <LevelBar item={item} width={120} />
            <span style={{ fontSize: 12.5, color: MUTED }}>{[item.reorderPoint ? `заказ при ${itemQty(item, item.reorderPoint)}` : null, item.parLevel ? `до ${itemQty(item, item.parLevel)}` : null].filter(Boolean).join(' · ')}</span>
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', paddingTop: 4 }}>
          <Button size="sm" variant="secondary" icon="local_shipping" onClick={() => router.push(`/manage/goods/supply?item=${item.id}`)}>Приход</Button>
          <Button size="sm" variant="secondary" icon="delete" onClick={() => router.push(`/manage/goods/write-off?item=${item.id}`)}>Списать</Button>
          <Button size="sm" variant="secondary" icon="fact_check" onClick={() => router.push(`/manage/goods/revision?item=${item.id}`)}>Пересчитать</Button>
        </div>
      </div>
    </Card>
  )
}

/** Столбики по дням за 30 дней; подпись — при наведении. */
function Bars({ series, format }: { series: DaySeries; format: (n: number) => string }) {
  const max = Math.max(1, ...series.map(p => p.qty))
  if (series.every(p => p.qty === 0)) return null
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 90, padding: '4px 16px 14px' }}>
      {series.map(p => <div key={p.date} title={`${longDate.format(new Date(p.date))}: ${format(p.qty)}`} style={{ flex: 1, height: `${Math.max(3, (p.qty / max) * 100)}%`, borderRadius: 3, background: p.qty > 0 ? 'var(--primary-violet)' : 'rgba(255,255,255,0.06)' }} />)}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div style={{ flex: 1 }}><div style={{ fontSize: 12, color: MUTED }}>{label}</div><div style={{ fontSize: 18, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{value}</div></div>
}

function Activity({ item, card }: { item: GoodsItem; card: GoodsCard }) {
  if (item.kind === 'ingredient') {
    if (card.usage.qty <= 0) return null
    return (
      <Card title="Расход · 30 дней">
        <div style={{ display: 'flex', gap: 12, padding: '14px 16px' }}><Stat label="Ушло" value={itemQty(item, card.usage.qty)} /><Stat label="В день" value={itemQty(item, Math.round(card.usage.qty / 30))} /></div>
        <Bars series={card.usage.series} format={n => itemQty(item, n)} />
      </Card>
    )
  }
  return (
    <Card title="Продажи · 30 дней" footer={card.sales.qty ? 'Только закрытые чеки.' : undefined}>
      <div style={{ display: 'flex', gap: 12, padding: '14px 16px' }}><Stat label="Продано" value={`${card.sales.qty} шт`} /><Stat label="Выручка" value={money(card.sales.revenue)} /><Stat label="В день" value={`${(card.sales.qty / 30).toFixed(1).replace('.', ',').replace(',0', '')} шт`} /></div>
      <Bars series={card.sales.series} format={n => `${n} шт`} />
    </Card>
  )
}

function movementText(m: GoodsMovement): string {
  const label = MOVEMENT_LOOK[m.type].label
  if (m.soldItemName) return `${label} · ${m.soldItemName}`
  const reason = (m.reason ?? '').replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, '').replace(/(Продажа|Приёмка|Возврат позиции|Отмена чека)[: ·]*(чек)?\s*$/i, '$1').trim()
  if (!reason || reason === label) return label
  if (reason.startsWith('Приёмка')) return reason.replace('Приёмка', 'Приход')
  return reason.startsWith(label) ? reason : `${label} · ${reason}`
}

function Journal({ item, card, loading }: { item: GoodsItem; card: GoodsCard | undefined; loading: boolean }) {
  const router = useRouter()
  const [all, setAll] = useState(false)
  const moves = card?.movements ?? []
  return (
    <>
      {card?.lastSupply && (
        <Card title="Последний приход">
          <Row onClick={() => router.push(`/manage/goods/doc?type=supply&id=${card.lastSupply!.supplyId}`)}>
            <IconPlate icon="local_shipping" color="#34D399" />
            <span style={{ flex: 1 }}><span style={{ display: 'block', fontSize: 15, fontWeight: 600 }}>{[longDate.format(new Date(card.lastSupply.date)), card.lastSupply.supplier].filter(Boolean).join(' · ')}</span><span style={{ fontSize: 12.5, color: MUTED }}>{itemQty(item, card.lastSupply.quantity)} на {money(card.lastSupply.quantity * card.lastSupply.costPerUnit)}</span></span>
          </Row>
        </Card>
      )}
      <Card title="Движения">
        {loading ? <Row><span style={{ color: MUTED }}>Загружаем…</span></Row>
          : moves.length === 0 ? <Row><span style={{ color: MUTED }}>Движений пока не было</span></Row>
          : (all ? moves : moves.slice(0, SHORT)).map(m => {
            const look = MOVEMENT_LOOK[m.type]
            return (
              <Row key={m.id}>
                <IconPlate icon={look.icon} color={look.color} size={30} />
                <span style={{ flex: 1, minWidth: 0 }}><span style={{ display: 'block', fontSize: 14.5 }}>{movementText(m)}</span><span style={{ fontSize: 12, color: MUTED }}>{[moveDate.format(new Date(m.createdAt)).replace('.', ''), m.author].filter(Boolean).join(' · ')}</span></span>
                <Trailing value={`${m.delta > 0 ? '+' : '−'}${itemQty(item, Math.abs(m.delta))}`} color={m.delta > 0 ? 'var(--success)' : 'var(--danger)'} caption={`→ ${itemQty(item, m.qtyAfter)}`} />
              </Row>
            )
          })}
        {!all && moves.length > SHORT && <Row onClick={() => setAll(true)}><span style={{ color: 'var(--primary-violet)', fontWeight: 600 }}>Показать все · {moves.length}</span></Row>}
      </Card>
    </>
  )
}
