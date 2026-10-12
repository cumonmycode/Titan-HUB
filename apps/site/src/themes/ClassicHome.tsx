/** «Классика»: фото стола во весь экран, понятные карточки форматов, цены и запись. */
import Link from 'next/link'
import { FORMATS } from '@/content/formats'
import { SITE } from '@/content/site'
import { nextEvening, newbiePrice, rub } from '@/lib/format'
import { RequestButton } from '@/components/request/RequestButton'
import { CtaBand, Photo, Section } from '@/components/sections/blocks'
import { EventRates, EveningPrices, Formats, Schedule } from '@/components/sections/offer'
import { Players, Reviews, StoriesGrid } from '@/components/sections/community'
import type { HomeProps } from './types'

export function ClassicHome({ config, stories, players }: HomeProps) {
  const next = nextEvening(config.schedule)
  const price = newbiePrice(config.eveningPrices)
  return (
    <>
      <section className="classic-hero">
        <Photo name="table-night" alt="Игра в мафию в штабе TITAN KBR" className="classic-hero-photo" eager sizes="100vw" />
        <div className="classic-hero-copy">
          <h1>Мафия в Нальчике каждый вечер</h1>
          <p className="lead">Спортивная и городская мафия, турниры с рейтингом, дни рождения, корпоративы и детские праздники. С {SITE.since} года.</p>
          <div className="actions">
            <RequestButton preset={{ kind: 'game' }} className="btn btn-primary btn-lg">Записаться на игру</RequestButton>
            <RequestButton preset={{ kind: 'event' }} className="btn btn-ghost btn-lg">Заказать праздник</RequestButton>
          </div>
          <ul className="classic-facts">
            {next && <li><b>{next.isToday ? 'Сегодня' : 'Скоро'} в {next.day.time ?? '19:00'}</b>{next.day.title}</li>}
            {price && <li><b>{rub(price)}</b>вечер для новичка</li>}
            <li><b>№ 40</b>клуб на GoMafia</li>
          </ul>
        </div>
      </section>

      <Section title="Чем заняться в клубе">
        <Formats formats={FORMATS} config={config} />
      </Section>

      <Section title="Ближайшие игры">
        <Schedule config={config} />
      </Section>

      <Section title="Цены" lead="Актуальные цены из кассы клуба." className="classic-prices">
        <EveningPrices config={config} />
        <EventRates config={config} />
      </Section>

      <Section title="Турниры и события">
        <StoriesGrid stories={stories} limit={6} />
        <p className="sec-more"><Link href="/portfolio" className="btn btn-ghost">Все события</Link></p>
      </Section>

      <Section title="Рейтинг клуба">
        <Players data={players} />
      </Section>

      <Section title="Отзывы гостей">
        <Reviews />
      </Section>

      <CtaBand title="Приходите поиграть" text="Оставьте заявку — перезвоним и запишем на удобный вечер." preset={{ kind: 'game' }} label="Записаться на игру" />
    </>
  )
}
