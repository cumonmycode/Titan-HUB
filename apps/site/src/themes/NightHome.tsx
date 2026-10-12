/**
 * «Город засыпает»: главная как раунд игры. Ночь — роли и вечера, рассвет —
 * цены и события, день — запись. Небо светлеет с прокруткой (NightSky).
 */
import Link from 'next/link'
import { FORMATS } from '@/content/formats'
import { SITE } from '@/content/site'
import { nextEvening, newbiePrice, rub } from '@/lib/format'
import { RequestButton } from '@/components/request/RequestButton'
import { CtaBand, Photo, Section } from '@/components/sections/blocks'
import { EventRates, EveningPrices, Formats, Schedule } from '@/components/sections/offer'
import { Players, Reviews, StoriesGrid } from '@/components/sections/community'
import type { HomeProps } from './types'

export function NightHome({ config, stories, players }: HomeProps) {
  const next = nextEvening(config.schedule)
  const price = newbiePrice(config.eveningPrices)
  return (
    <>
      <section className="night-hero">
        <Photo name="dark-room" alt="" className="night-hero-photo" eager sizes="40vw" />
        <h1><span>Город</span><span>засыпает…</span></h1>
        <div className="night-hero-foot">
          <p className="lead">Мафия просыпается каждый вечер{next ? ` — ближайшая игра ${next.isToday ? 'сегодня' : 'скоро'} в ${next.day.time ?? '19:00'}` : ''}. Спортивная и городская мафия, турниры и праздники в клубе {SITE.name}, {SITE.city}.</p>
          <div className="actions">
            <RequestButton preset={{ kind: 'game' }} className="btn btn-primary btn-lg">Проснуться и записаться</RequestButton>
            {price && <span className="night-price">вечер от {rub(price)}</span>}
          </div>
        </div>
        <p className="night-cue" aria-hidden="true">Реплика ведущего · {config.venue.hoursOpen || '19:00'} · Кабардинская, 152</p>
      </section>

      <Section title="Мафия просыпается" lead="Выберите свою роль в клубе." className="night-phase">
        <Formats formats={FORMATS} config={config} />
      </Section>

      <Section title="Вечера недели" lead="Отметьтесь на ближайшую игру — подтвердим звонком." className="night-phase">
        <Schedule config={config} />
      </Section>

      <Section title="Самые опасные" lead="Резиденты клуба по рейтингу GoMafia." className="night-phase">
        <Players data={players} />
      </Section>

      <div className="night-day">
        <Section title="Город просыпается" lead="Цены — честно, при свете дня. Прямо из кассы клуба." className="is-day">
          <EveningPrices config={config} />
          <EventRates config={config} />
        </Section>
        <Section title="Что было ночью" lead="Турниры и вечеринки клуба." className="is-day">
          <StoriesGrid stories={stories} limit={6} />
          <p className="sec-more"><Link href="/portfolio" className="btn btn-ghost">Все события</Link></p>
        </Section>
        <Section title="Город говорит" className="is-day">
          <Reviews />
        </Section>
        <CtaBand title="Голосуем за вечер" text="Оставьте заявку — администратор перезвонит и запишет вас." preset={{ kind: 'game' }} label="Записаться на игру"
          secondary={<RequestButton preset={{ kind: 'event' }} className="btn btn-link">Заказать праздник</RequestButton>} />
      </div>
    </>
  )
}
