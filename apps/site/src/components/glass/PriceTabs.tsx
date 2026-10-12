'use client'
/** Цены из кассы HUB в стеклянной панели с переключателем «вечер · мероприятие · залы». */
import { useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import type { EventRate, Price, Zone } from '@/lib/types'
import { RequestButton } from '@/components/request/RequestButton'

const rub = (n: number) => `${Math.round(n).toLocaleString('ru-RU')} ₽`
type Tab = 'evening' | 'event' | 'zones'

export function PriceTabs({ evening, rates, zones }: { evening: Price[]; rates: EventRate[]; zones: Zone[] }) {
  const reduce = useReducedMotion()
  const tabs: { id: Tab; label: string }[] = [
    { id: 'evening', label: 'Игровой вечер' },
    { id: 'event', label: 'Мероприятие' },
    ...(zones.length ? [{ id: 'zones' as const, label: 'Залы' }] : []),
  ]
  const [tab, setTab] = useState<Tab>('evening')
  return (
    <div className="g-prices glass">
      <div className="g-seg" role="tablist" aria-label="Вид цены">
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className="g-seg-btn" onClick={() => setTab(t.id)}>
            {tab === t.id && <motion.span layoutId="g-seg-pill" className="g-seg-pill" transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 34 }} />}
            <span>{t.label}</span>
          </button>
        ))}
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={tab}
          role="tabpanel"
          className="g-price-panel"
          initial={reduce ? false : { opacity: 0, y: 12, filter: 'blur(6px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          exit={reduce ? undefined : { opacity: 0, y: -8, filter: 'blur(6px)' }}
          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
        >
          {tab === 'evening' && (
            <>
              <ul className="g-price-grid">{evening.map((p) => <li key={p.name}><span>{p.name}</span><b>{rub(p.price)}</b></li>)}</ul>
              <div className="g-price-foot"><p>Цена за вечер игр. Баллы My Titan оплачивают до половины счёта.</p><RequestButton preset={{ kind: 'game' }} className="btn btn-primary">Записаться</RequestButton></div>
            </>
          )}
          {tab === 'event' && (
            <>
              <ul className="g-price-grid">{rates.map((r) => <li key={r.hours}><span>{r.hours} {r.hours === 1 ? 'час' : r.hours < 5 ? 'часа' : 'часов'}</span><b>{rub(r.price)}</b></li>)}</ul>
              <div className="g-price-foot"><p>Мероприятие под ключ: ведущий, реквизит, игра — в штабе или у вас.</p><RequestButton preset={{ kind: 'event' }} className="btn btn-primary">Заказать</RequestButton></div>
            </>
          )}
          {tab === 'zones' && (
            <>
              <ul className="g-price-grid">{zones.map((z) => <li key={z.id}><span>{z.name}</span><b>{rub(z.hourlyRate)}<small>/ч</small></b></li>)}</ul>
              <div className="g-price-foot"><p>Почасовая аренда зон штаба для своей компании.</p><RequestButton preset={{ kind: 'event', location: 'titan' }} className="btn btn-primary">Забронировать</RequestButton></div>
            </>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
