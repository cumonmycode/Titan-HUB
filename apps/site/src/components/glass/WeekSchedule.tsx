'use client'
/**
 * Неделя игр: календарь на две недели в духе iOS (Пн–Вс, точка — день с игрой,
 * выбранный день — белый круг) и карточка выбранного дня с записью. Дни считает
 * сервер (МСК, с понедельника текущей недели), прошедшие — неактивны.
 */
import { useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { RequestButton } from '@/components/request/RequestButton'

export interface WeekDay {
  iso: string
  dow: string
  dowLong: string
  num: number
  month: string
  today: boolean
  past: boolean
  events: { title: string; time: string; evening?: 'city_mafia' | 'sport_mafia' | 'board_games' }[]
}

const EASE = [0.16, 1, 0.3, 1] as const
const HEAD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

function rangeLabel(days: WeekDay[]): string {
  const a = days[0]
  const b = days[days.length - 1]
  if (!a || !b) return ''
  return a.month === b.month ? `${a.num} – ${b.num} ${b.month}` : `${a.num} ${a.month} – ${b.num} ${b.month}`
}

export function WeekSchedule({ days }: { days: WeekDay[] }) {
  const reduce = useReducedMotion()
  const firstGame = days.findIndex((d) => !d.past && d.events.length)
  const [sel, setSel] = useState(firstGame >= 0 ? firstGame : Math.max(0, days.findIndex((d) => d.today)))
  const day = days[sel]
  return (
    <div className="g-cal">
      <div className="g-cal-month glass">
        <p className="g-cal-title">{rangeLabel(days)}</p>
        <div className="g-cal-head" aria-hidden="true">{HEAD.map((h) => <span key={h}>{h}</span>)}</div>
        <div className="g-cal-days" role="group" aria-label="Дни игр на две недели">
          {days.map((d, i) => (
            <button
              key={d.iso} type="button" disabled={d.past} aria-pressed={sel === i}
              aria-label={`${d.dowLong}, ${d.num} ${d.month}${d.events.length ? ` — ${d.events.map((e) => e.title).join(', ')}` : ''}`}
              className={`g-cal-day${d.events.length ? ' has-game' : ''}${d.today ? ' is-today' : ''}`}
              onClick={() => setSel(i)}
            >
              {sel === i && <motion.span layoutId="g-cal-sel" className="g-cal-sel" transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 460, damping: 36 }} />}
              <b>{d.num}</b>
              <span className="g-cal-dot" aria-hidden="true" />
            </button>
          ))}
        </div>
        <p className="g-cal-legend"><span className="g-cal-dot" aria-hidden="true" /> вечер с игрой</p>
      </div>
      <AnimatePresence mode="wait" initial={false}>
        {day && (
          <motion.div
            key={day.iso}
            className="g-cal-card glass"
            initial={reduce ? false : { opacity: 0, y: 14, filter: 'blur(8px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            exit={reduce ? undefined : { opacity: 0, y: -8, filter: 'blur(6px)' }}
            transition={{ duration: 0.4, ease: EASE }}
            aria-live="polite"
          >
            <p className="g-cal-date"><span>{day.today ? 'Сегодня' : day.dowLong}</span>{day.num} {day.month}</p>
            {day.events.length ? day.events.map((e) => (
              <div key={`${e.title}-${e.time}`} className="g-cal-event">
                <span className="g-cal-time">{e.time}</span>
                <div className="g-cal-what">
                  <h3>{e.title}</h3>
                  <p>Кабардинская, 152 · ведущий объяснит правила</p>
                </div>
                <RequestButton preset={{ kind: 'game', evening: e.evening }} className="btn btn-primary">Записаться</RequestButton>
              </div>
            )) : (
              <div className="g-cal-event is-empty">
                <div className="g-cal-what">
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
