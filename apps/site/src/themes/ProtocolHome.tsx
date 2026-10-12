/**
 * «Протокол судьи»: сайт как бланк протокола стола. Девять мест заняты
 * форматами клуба, место № 10 — ваше: строка протокола и есть главная кнопка.
 */
import Link from 'next/link'
import { formatById, type FormatId } from '@/content/formats'
import { TEAM } from '@/content/people'
import { SITE } from '@/content/site'
import { DAY_SHORT, daysOf, nextEvening, newbiePrice, rub } from '@/lib/format'
import { RequestButton } from '@/components/request/RequestButton'
import { CtaBand, Section } from '@/components/sections/blocks'
import { EventRates, EveningPrices, Schedule } from '@/components/sections/offer'
import { Players, Reviews, StoriesGrid } from '@/components/sections/community'
import type { HomeProps } from './types'

interface Seat { title: string; when: string; value: string; href?: string; format?: FormatId }

export function ProtocolHome({ config, stories, players }: HomeProps) {
  const next = nextEvening(config.schedule)
  const price = newbiePrice(config.eveningPrices)
  const rate = config.eventRates[0]
  const topStory = stories.find((s) => s.kind === 'tournament' && s.stats.length)
  const elo = topStory?.stats.find((s) => /elo/i.test(s.label))
  const seats: Seat[] = [
    { title: 'Городская мафия', when: daysOf(config.schedule, /город/i) || 'по расписанию', value: price ? `от ${rub(price)}` : '—', format: 'city' },
    { title: 'Спортивная мафия', when: daysOf(config.schedule, /спорт/i) || 'по расписанию', value: 'рейтинг ELO', format: 'sport' },
    { title: 'Настольные игры', when: daysOf(config.schedule, /настол/i) || 'по расписанию', value: 'компанией', format: 'board' },
    { title: 'День рождения', when: 'штаб или выезд', value: rate ? `${rub(rate.price)}/${rate.hours} ч` : 'по заявке', href: '/events' },
    { title: 'Детская мафия', when: 'праздники и школы', value: 'по заявке', href: '/kidspromo' },
    { title: 'Корпоратив', when: 'тимбилдинг', value: rate ? `от ${rub(rate.price)}` : 'по заявке', href: '/events' },
    { title: 'Турниры', when: topStory?.title ?? 'Society Mafia Cup', value: elo ? `ELO ${elo.value}` : 'GoMafia', href: '/portfolio' },
    { title: 'Школа мафии', when: 'правила ФСМ', value: 'резидентам', href: '/residents' },
    { title: 'Сертификат', when: 'активировать', value: 'в подарок', href: '/promoinfo' },
  ]
  const host = TEAM[0]
  return (
    <>
      <section className="proto-sheet">
        <dl className="proto-meta">
          <div><dt>Клуб</dt><dd>{SITE.name}, {SITE.city}</dd></div>
          <div><dt>Ближайшая игра</dt><dd>{next ? (next.isToday ? 'сегодня' : `${DAY_SHORT[next.day.day]}, ${next.date.getUTCDate()}`) : 'каждый вечер'}</dd></div>
          <div><dt>Начало</dt><dd>{next?.day.time ?? config.venue.hoursOpen ?? '19:00'}</dd></div>
          <div><dt>Ведущий</dt><dd>{host.name.replace(/ (\S)\S+$/, ' $1.')}</dd></div>
          <div><dt>Стол</dt><dd>№ 1 · штаб</dd></div>
        </dl>
        <div className="proto-main">
          <div className="proto-lead">
            <h1>Свободно место <span className="proto-seat">№10</span></h1>
            <p className="lead">Девять мест за столом уже заняты. Городская и спортивная мафия каждый вечер, ведущие, рейтинг GoMafia — не хватает только вас.</p>
            <div className="actions">
              <RequestButton preset={{ kind: 'game' }} className="btn btn-primary btn-lg">Занять место</RequestButton>
              <span className="proto-hint">Новичкам объясним правила прямо перед игрой</span>
            </div>
            <EveningPrices config={config} />
          </div>
          <table className="proto-table">
            <caption className="visually-hidden">Форматы клуба</caption>
            <thead><tr><th scope="col">№</th><th scope="col">Формат</th><th scope="col">Когда</th><th scope="col">Цена</th></tr></thead>
            <tbody>
              {seats.map((s, i) => {
                const href = s.href ?? (s.format ? formatById(s.format).href : '/games')
                return (
                  <tr key={s.title}>
                    <td className="proto-n">{i + 1}</td>
                    <td className="proto-hand"><Link href={href}>{s.title}</Link></td>
                    <td className="proto-when">{s.when}</td>
                    <td className="proto-hand proto-val">{s.value}</td>
                  </tr>
                )
              })}
              <tr className="proto-you">
                <td className="proto-n">10</td>
                <td className="proto-hand" colSpan={2}><RequestButton preset={{ kind: 'game' }} className="proto-blank">впишите своё имя</RequestButton></td>
                <td className="proto-hand proto-val">ваш ход</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <Section title="Расписание стола" lead="Ближайшие вечера. Отметьтесь — администратор подтвердит место.">
        <Schedule config={config} />
      </Section>

      <Section title="Тарифы" lead="Из кассы клуба, без звёздочек." className="proto-prices">
        <EveningPrices config={config} />
        <EventRates config={config} />
      </Section>

      <Section title="Рейтинг ELO" lead="Резиденты клуба на GoMafia.">
        <Players data={players} />
      </Section>

      <Section title="Архив протоколов" lead="Турниры и вечеринки клуба.">
        <StoriesGrid stories={stories} limit={6} />
        <p className="sec-more"><Link href="/portfolio" className="btn btn-ghost">Весь архив</Link></p>
      </Section>

      <Section title="Особое мнение">
        <Reviews />
      </Section>

      <CtaBand title="Протокол открыт" text="Оставьте имя и телефон — администратор впишет вас за стол." preset={{ kind: 'game' }} label="Занять место"
        secondary={<RequestButton preset={{ kind: 'event' }} className="btn btn-link">Заказать мероприятие</RequestButton>} />
    </>
  )
}
