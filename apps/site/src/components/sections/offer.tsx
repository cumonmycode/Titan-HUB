/** Что продаём: форматы, расписание, цены вечера, тарифы мероприятий и залы — живое из HUB. */
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import type { SiteConfig } from '@/lib/types'
import { DAY_LONG, DAY_SHORT, daysOf, isoDate, rub } from '@/lib/format'
import type { Format } from '@/content/formats'
import { RequestButton } from '@/components/request/RequestButton'
import { eveningOf } from '@/components/request/options'
import { Photo } from './blocks'

/** Подпись под форматом: дни недели и цена из HUB. */
export function formatMeta(f: Format, config: SiteConfig): string {
  const newbie = config.eveningPrices.find((p) => /нович/i.test(p.name))?.price
  const rate = config.eventRates[0]
  switch (f.id) {
    case 'city': return [daysOf(config.schedule, /город/i), newbie ? `от ${rub(newbie)}` : ''].filter(Boolean).join(' · ')
    case 'sport': return [daysOf(config.schedule, /спорт/i), 'рейтинг ELO'].filter(Boolean).join(' · ')
    case 'board': return daysOf(config.schedule, /настол/i) || 'по расписанию'
    default: return rate ? `от ${rub(rate.price)} за ${rate.hours} ч` : 'по заявке'
  }
}

export function Formats({ formats, config }: { formats: Format[]; config: SiteConfig }) {
  return (
    <ul className="formats">
      {formats.map((f) => (
        <li key={f.id} className="fmt">
          <Photo name={f.photo} alt={f.title} sizes="(max-width: 720px) 100vw, 33vw" />
          <div className="fmt-body">
            <h3>{f.title}</h3>
            <p className="fmt-meta">{formatMeta(f, config)}</p>
            <p>{f.text}</p>
            <div className="fmt-actions">
              <RequestButton preset={f.request} className="btn btn-primary btn-sm">{f.request.kind === 'game' ? 'Записаться' : 'Оставить заявку'}</RequestButton>
              <Link href={f.href} className="btn btn-link">Подробнее <ArrowRight size={16} aria-hidden="true" /></Link>
            </div>
          </div>
        </li>
      ))}
    </ul>
  )
}

/** Ближайшие две недели вечеров по расписанию HUB (МСК), с кнопкой записи на конкретный день. */
export function Schedule({ config, days = 7 }: { config: SiteConfig; days?: number }) {
  const msk = new Date(Date.now() + 3 * 3600_000)
  const nowMin = msk.getUTCHours() * 60 + msk.getUTCMinutes()
  const rows: { date: Date; dow: number; title: string; time: string; today: boolean }[] = []
  for (let add = 0; add < 21 && rows.length < days; add++) {
    const date = new Date(Date.UTC(msk.getUTCFullYear(), msk.getUTCMonth(), msk.getUTCDate() + add))
    const dow = ((date.getUTCDay() + 6) % 7) + 1
    for (const s of config.schedule.filter((x) => x.day === dow)) {
      const time = s.time ?? '19:00'
      const [h, m] = time.split(':').map(Number)
      if (add === 0 && (h ?? 19) * 60 + (m ?? 0) <= nowMin) continue
      rows.push({ date, dow, title: s.title, time, today: add === 0 })
    }
  }
  if (!rows.length) return <p className="empty">Расписание уточняйте по телефону — играем каждый вечер.</p>
  return (
    <ol className="schedule">
      {rows.map((r) => {
        const evening = eveningOf(r.title)
        return (
          <li key={`${isoDate(r.date)}-${r.title}`} className={`day${r.today ? ' is-today' : ''}`}>
            <time dateTime={`${isoDate(r.date)}T${r.time}`} className="day-date">
              <span className="day-dow" aria-label={DAY_LONG[r.dow]}>{r.today ? 'сегодня' : DAY_SHORT[r.dow]}</span>
              <b>{r.date.getUTCDate()}</b>
              <span className="day-month">{r.date.toLocaleDateString('ru-RU', { timeZone: 'UTC', month: 'long' }).slice(0, 3)}</span>
            </time>
            <div className="day-body">
              <h3>{r.title}</h3>
              <p>начало в {r.time}</p>
            </div>
            <RequestButton preset={{ kind: 'game', evening: evening === 'any' ? undefined : evening }} className="btn btn-ghost btn-sm">Записаться</RequestButton>
          </li>
        )
      })}
    </ol>
  )
}

export function EveningPrices({ config }: { config: SiteConfig }) {
  return (
    <ul className="prices">
      {config.eveningPrices.map((p) => (
        <li key={p.name} className="price"><span className="price-name">{p.name}</span><b className="price-value">{rub(p.price)}</b></li>
      ))}
    </ul>
  )
}

export function EventRates({ config }: { config: SiteConfig }) {
  if (!config.eventRates.length) return null
  return (
    <table className="rates">
      <caption>Мероприятие под ключ: ведущий, реквизит, игра</caption>
      <thead><tr><th scope="col">Продолжительность</th><th scope="col">Стоимость</th></tr></thead>
      <tbody>
        {config.eventRates.map((r) => <tr key={r.hours}><td>{r.hours} ч</td><td>{rub(r.price)}</td></tr>)}
      </tbody>
    </table>
  )
}

export function Zones({ config }: { config: SiteConfig }) {
  if (!config.zones.length) return null
  return (
    <ul className="zones">
      {config.zones.map((z) => (
        <li key={z.id} className="zone">
          <h3>{z.name}</h3>
          <p>{z.capacity ? `до ${z.capacity} гостей · ` : ''}{rub(z.hourlyRate)} в час</p>
        </li>
      ))}
    </ul>
  )
}
