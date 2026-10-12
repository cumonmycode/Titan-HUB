/**
 * «Дело о мафии»: доска расследования на фиолетовой стене штаба. Форматы — улики
 * на булавках, красная нить ведёт к записке «ближайший вечер» и к заявке.
 */
import Link from 'next/link'
import { FORMATS, formatById } from '@/content/formats'
import { SITE } from '@/content/site'
import { dateLabel, nextEvening, newbiePrice, rub } from '@/lib/format'
import { RequestButton } from '@/components/request/RequestButton'
import { eveningOf } from '@/components/request/options'
import { Photo, Section, CtaBand } from '@/components/sections/blocks'
import { EventRates, EveningPrices, Formats, Schedule, formatMeta } from '@/components/sections/offer'
import { Players, Reviews, StoriesGrid } from '@/components/sections/community'
import type { HomeProps } from './types'

const BOARD = [
  { id: 'city', rot: -6, pos: 'case-pin-a' },
  { id: 'sport', rot: 5, pos: 'case-pin-b' },
  { id: 'kids', rot: 4, pos: 'case-pin-c' },
  { id: 'corporate', rot: -4, pos: 'case-pin-d' },
] as const

export function CaseHome({ config, stories, players }: HomeProps) {
  const next = nextEvening(config.schedule)
  const price = newbiePrice(config.eveningPrices)
  const evidence = stories.filter((s) => s.stats[0]).slice(0, 4)
  return (
    <>
      <section className="case-hero">
        <div className="case-hero-copy">
          <h1>Найди <span className="case-mark">мафию</span>, прежде чем она найдёт тебя</h1>
          <p className="lead">Клуб спортивной и городской мафии в Нальчике. Игры каждый вечер, ведущие, турниры с рейтингом и праздники под ключ.</p>
          <div className="actions">
            <RequestButton preset={{ kind: 'game' }} className="btn btn-primary btn-lg">Записаться на игру</RequestButton>
            <RequestButton preset={{ kind: 'event' }} className="btn btn-link">Заказать праздник</RequestButton>
          </div>
          <dl className="case-facts">
            {price && <div><dt>вечер для новичка</dt><dd>{rub(price)}</dd></div>}
            <div><dt>каждый день</dt><dd>{config.venue.hoursOpen || '19:00'}</dd></div>
            <div><dt>клуб на GoMafia</dt><dd>№ 40</dd></div>
          </dl>
        </div>
        <div className="case-board" aria-label="Форматы клуба">
          <p className="case-folder">Дело № 0700 · {SITE.address} · с {SITE.since}</p>
          <svg className="case-threads" viewBox="0 0 700 680" preserveAspectRatio="none" aria-hidden="true">
            <path d="M110 44 C 190 120, 280 210, 350 262" />
            <path d="M600 24 C 520 110, 420 200, 350 262" />
            <path d="M128 372 C 200 330, 290 290, 350 262" />
            <path d="M578 386 C 500 340, 410 290, 350 262" />
          </svg>
          {BOARD.map((b) => {
            const f = formatById(b.id)
            return (
              <Link key={b.id} href={f.href} className={`case-polaroid ${b.pos}`} style={{ ['--r' as string]: `${b.rot}deg` }}>
                <span className="case-pin" aria-hidden="true" />
                <Photo name={f.photo} alt={f.title} eager sizes="240px" />
                <span className="case-caption"><b>{f.title}</b><small>{formatMeta(f, config)}</small></span>
              </Link>
            )
          })}
          <div className="case-note">
            <span className="case-live">Запись открыта</span>
            <h2>{next ? (next.isToday ? 'Сегодня' : dateLabel(next.date)) : 'Каждый вечер'}{next ? `, ${next.day.time ?? '19:00'}` : ''}</h2>
            <p>{next?.day.title ?? 'Городская и спортивная мафия'}</p>
            <RequestButton preset={{ kind: 'game', evening: next ? (eveningOf(next.day.title) === 'any' ? undefined : eveningOf(next.day.title)) : undefined }} className="btn btn-ghost btn-sm">Я в деле</RequestButton>
          </div>
          <span className="case-stamp" aria-hidden="true">Под подозрением</span>
        </div>
      </section>

      {evidence.length > 0 && (
        <ul className="case-evidence" aria-label="Факты о клубе">
          {evidence.map((s, i) => (
            <li key={s.slug}><Link href={`/${s.slug}`}><b>Улика № {i + 1}</b>{s.title} — {s.stats[0]!.value} {s.stats[0]!.label}</Link></li>
          ))}
        </ul>
      )}

      <Section title="Подозреваемые" lead="Шесть форматов клуба. Выберите свой — и мы найдём для вас стол.">
        <Formats formats={FORMATS} config={config} />
      </Section>

      <Section title="График допросов" lead="Ближайшие игровые вечера. Запись — в один клик, подтвердим звонком.">
        <Schedule config={config} />
      </Section>

      <Section title="Цена вопроса" lead="Цены приходят прямо из кассы клуба и всегда актуальны." className="case-prices">
        <EveningPrices config={config} />
        <EventRates config={config} />
      </Section>

      <Section title="Самые опасные игроки" lead="Резиденты клуба по рейтингу GoMafia — обновляется автоматически.">
        <Players data={players} />
      </Section>

      <Section title="Раскрытые дела" lead="Турниры и вечеринки клуба.">
        <StoriesGrid stories={stories} limit={6} />
        <p className="sec-more"><Link href="/portfolio" className="btn btn-ghost">Все дела</Link></p>
      </Section>

      <Section title="Показания свидетелей">
        <Reviews />
      </Section>

      <CtaBand title="Дело ждёт вас" text="Оставьте заявку — администратор перезвонит и запишет вас на ближайший вечер." preset={{ kind: 'game' }} label="Записаться на игру"
        secondary={<RequestButton preset={{ kind: 'event' }} className="btn btn-link">Заказать мероприятие</RequestButton>} />
    </>
  )
}
