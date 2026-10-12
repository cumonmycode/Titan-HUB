'use client'
/**
 * Неделя игр: лента дней-капсул (дни с играми помечены), под ней — стеклянная
 * карточка выбранного дня с записью. Дни считает сервер (МСК), клиент только выбирает.
 */
import { useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { RequestButton } from '@/components/request/RequestButton'

export interface WeekDay {
  iso: string
  dow: string
  num: number
  month: string
  today: boolean
  events: { title: string; time: string; evening?: 'city_mafia' | 'sport_mafia' | 'board_games' }[]
}

const EASE = [0.16, 1, 0.3, 1] as const

export function WeekSchedule({ days }: { days: WeekDay[] }) {
  const reduce = useReducedMotion()
  const first = Math.max(0, days.findIndex((d) => d.events.length))
  const [sel, setSel] = useState(first)
  const day = days[sel]
  return (
    <div className="g-week">
      <div className="g-week-strip glass" role="tablist" aria-label="Дни недели">
        {days.map((d, i) => (
          <button
            key={d.iso} type="button" role="tab" aria-selected={sel === i}
            className={`g-week-day${d.events.length ? ' has-game' : ''}${d.today ? ' is-today' : ''}`}
            onClick={() => setSel(i)}
          >
            {sel === i && <motion.span layoutId="g-week-pill" className="g-week-pill" transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 34 }} />}
            <span className="g-week-dow">{d.today ? 'сегодня' : d.dow}</span>
            <b>{d.num}</b>
            <span className="g-week-dot" aria-hidden="true" />
          </button>
        ))}
      </div>
      <AnimatePresence mode="wait" initial={false}>
        {day && (
          <motion.div
            key={day.iso}
            className="g-week-card glass"
            role="tabpanel"
            initial={reduce ? false : { opacity: 0, y: 16, filter: 'blur(8px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            exit={reduce ? undefined : { opacity: 0, y: -10, filter: 'blur(6px)' }}
            transition={{ duration: 0.45, ease: EASE }}
          >
            <p className="g-week-date">{day.today ? 'Сегодня' : day.dow}, {day.num} {day.month}</p>
            {day.events.length ? day.events.map((e) => (
              <div key={`${e.title}-${e.time}`} className="g-week-event">
                <div>
                  <h3>{e.title}</h3>
                  <p>начало в {e.time} · Кабардинская, 152</p>
                </div>
                <RequestButton preset={{ kind: 'game', evening: e.evening }} className="btn btn-primary">Записаться</RequestButton>
              </div>
            )) : (
              <div className="g-week-event">
                <div>
                  <h3>Игр по расписанию нет</h3>
                  <p>Соберите компанию — проведём закрытую игру или праздник.</p>
                </div>
                <RequestButton preset={{ kind: 'event' }} className="btn btn-ghost glass">Заказать вечер</RequestButton>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
