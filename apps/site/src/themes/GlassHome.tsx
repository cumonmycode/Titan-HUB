/**
 * Liquid Glass — главная сайта в духе страниц Apple Keynote: крупные заголовки
 * по центру, фото целиком (стекло никогда не лежит поверх фото — только рядом или
 * под ним), стеклянные карточки, интерактивная неделя игр и переключатель цен.
 */
import Link from 'next/link'
import type { CSSProperties } from 'react'
import { ArrowRight, MapPin } from 'lucide-react'
import { FORMATS } from '@/content/formats'
import { GOMAFIA, SITE } from '@/content/site'
import { DAY_SHORT, dateLabel, isoDate, nextEvening, newbiePrice, rub } from '@/lib/format'
import type { ScheduleDay } from '@/lib/types'
import { RequestButton } from '@/components/request/RequestButton'
import { eveningOf } from '@/components/request/options'
import { Photo } from '@/components/sections/blocks'
import { formatMeta } from '@/components/sections/offer'
import { PlayersPodium, ReviewsMarquee, StoriesGrid } from '@/components/sections/community'
import { AppPromo } from '@/components/app/AppPromo'
import { CountUp } from '@/components/motion/CountUp'
import { HeroDepth } from '@/components/motion/HeroDepth'
import { Reveal, RevealItem } from '@/components/motion/Reveal'
import { WordRotator } from '@/components/motion/WordRotator'
import { PriceTabs } from '@/components/glass/PriceTabs'
import { WeekSchedule, type WeekDay } from '@/components/glass/WeekSchedule'
import { TonightSignups } from '@/components/live/TonightSignups'
import type { HomeProps } from './types'

const WEEK_DAYS = 14
const v = (vars: Record<string, string | number>) => vars as CSSProperties

/** Две недели вперёд по МСК с играми из расписания HUB. */
function buildWeek(schedule: ScheduleDay[]): WeekDay[] {
  const msk = new Date(Date.now() + 3 * 3600_000)
  const nowMin = msk.getUTCHours() * 60 + msk.getUTCMinutes()
  return Array.from({ length: WEEK_DAYS }, (_, add) => {
    const d = new Date(Date.UTC(msk.getUTCFullYear(), msk.getUTCMonth(), msk.getUTCDate() + add))
    const dow = ((d.getUTCDay() + 6) % 7) + 1
    const events = schedule.filter((s) => s.day === dow).flatMap((s) => {
      const time = s.time ?? '19:00'
      const [h, m] = time.split(':').map(Number)
      if (add === 0 && (h ?? 19) * 60 + (m ?? 0) <= nowMin) return []
      const evening = eveningOf(s.title)
      return [{ title: s.title, time, evening: evening === 'any' ? undefined : evening }]
    })
    return {
      iso: isoDate(d), dow: DAY_SHORT[dow] ?? '', num: d.getUTCDate(), today: add === 0,
      month: d.toLocaleDateString('ru-RU', { timeZone: 'UTC', month: 'long', day: 'numeric' }).replace(/^\d+\s/, ''),
      events,
    }
  })
}

function SectionHead({ title, lead }: { title: string; lead?: string }) {
  return (
    <RevealItem className="sec-head">
      <h2>{title}</h2>
      {lead && <p className="sec-lead">{lead}</p>}
    </RevealItem>
  )
}

export function GlassHome({ config, stories, players }: HomeProps) {
  const next = nextEvening(config.schedule)
  const price = newbiePrice(config.eveningPrices)
  const top = players.players[0]
  const years = new Date().getFullYear() - SITE.since
  const nextKind = next ? eveningOf(next.day.title) : 'any'
  return (
    <div className="g-home">
      <HeroDepth
        className="k-hero"
        copy={<>
          <h1 className="g-title">
            <span className="g-line" style={v({ '--i': 0 })}>Мафия в Нальчике.</span>
            <span className="g-line" style={v({ '--i': 1 })}>Каждый вечер —</span>
            <span className="g-line g-line-accent" style={v({ '--i': 2 })}><WordRotator words={['городская', 'спортивная', 'детская', 'корпоративная']} /></span>
          </h1>
          <p className="lead g-rise" style={v({ '--i': 3 })}>Клуб TITAN KBR: игры с ведущими, турниры с рейтингом GoMafia, праздники и выезд со всем реквизитом. Цены и расписание — прямо из кассы клуба.</p>
          <div className="actions g-rise" style={v({ '--i': 4 })}>
            <RequestButton preset={{ kind: 'game' }} className="btn btn-primary btn-lg">Записаться на игру</RequestButton>
            <RequestButton preset={{ kind: 'event' }} className="btn btn-ghost btn-lg glass">Заказать праздник</RequestButton>
          </div>
          <TonightSignups />
        </>}
        media={<Photo name="table-night" alt="Игра в штабе TITAN KBR" eager sizes="(max-width: 1240px) 100vw, 1180px" />}
      />

      {/* Карточки — под фото, а не поверх: фото видно целиком. */}
      <Reveal className="k-glance">
        <RevealItem className="k-glance-card k-glance-next glass">
          <span className="g-live">{next?.isToday ? 'Сегодня играем' : 'Ближайшая игра'}</span>
          <h2>{next ? (next.isToday ? `Сегодня, ${next.day.time ?? '19:00'}` : dateLabel(next.date)) : 'Каждый вечер'}</h2>
          <p>{next ? `${next.day.title}${next.isToday ? '' : ` · ${next.day.time ?? '19:00'}`}` : 'Городская и спортивная мафия'}</p>
          <p className="k-glance-addr"><MapPin size={15} aria-hidden="true" /> {SITE.address}</p>
          <RequestButton preset={{ kind: 'game', evening: nextKind === 'any' ? undefined : nextKind }} className="btn btn-primary btn-sm">Я в игре</RequestButton>
        </RevealItem>
        {price && (
          <RevealItem className="k-glance-card k-glance-price glass">
            <span>Вечер для новичка</span>
            <b>{rub(price)}</b>
            <small>правила объяснит ведущий</small>
          </RevealItem>
        )}
        {top && (
          <RevealItem className="k-glance-card k-glance-top glass">
            {top.avatar ? <img src={top.avatar} alt="" width={56} height={56} /> : <span className="k-glance-dot" aria-hidden="true" />}
            <span>Лидер клуба на GoMafia</span>
            <b>{top.id ? <a className="pl-link" href={GOMAFIA.player(top.id)} target="_blank" rel="noopener noreferrer">{top.nickname}</a> : top.nickname}</b>
            <small>ELO {top.elo}</small>
          </RevealItem>
        )}
      </Reveal>

      <Reveal className="g-stats">
        <RevealItem className="g-stat"><b><CountUp value={years} /></b><span>лет клубу</span></RevealItem>
        {players.total > 0 && <RevealItem className="g-stat"><b><CountUp value={players.total} /></b><span>резидентов на GoMafia</span></RevealItem>}
        {top && <RevealItem className="g-stat"><b><CountUp value={top.elo} /></b><span>ELO лидера клуба</span></RevealItem>}
        <RevealItem className="g-stat"><b><CountUp value={stories.length} /></b><span>турниров и вечеринок</span></RevealItem>
      </Reveal>

      <Reveal as="section" className="sec">
        <SectionHead title="Выберите свой вечер" lead="Шесть форматов клуба — от первой игры до турнира и праздника под ключ." />
        <div className="k-tiles">
          {FORMATS.map((f) => (
            <RevealItem key={f.id} className="k-tile glass">
              <div className="k-tile-media"><Photo name={f.photo} alt="" sizes="(max-width: 700px) 85vw, 33vw" /></div>
              <div className="k-tile-body">
                <p className="k-tile-meta">{formatMeta(f, config)}</p>
                <h3>{f.title}</h3>
                <p className="k-tile-text">{f.short}</p>
                <div className="k-tile-actions">
                  <RequestButton preset={f.request} className="btn btn-primary btn-sm">{f.request.kind === 'game' ? 'Записаться' : 'Заявка'}</RequestButton>
                  <Link href={f.href} className="btn btn-link">Подробнее <ArrowRight size={16} aria-hidden="true" /></Link>
                </div>
              </div>
            </RevealItem>
          ))}
        </div>
      </Reveal>

      <Reveal as="section" className="sec">
        <SectionHead title="Неделя игр" lead="Выберите день — запишитесь в один клик, администратор подтвердит." />
        <RevealItem><WeekSchedule days={buildWeek(config.schedule)} /></RevealItem>
      </Reveal>

      <Reveal as="section" className="sec">
        <SectionHead title="Цены" lead="Всегда актуальные — подтягиваются из кассы клуба." />
        <RevealItem><PriceTabs evening={config.eveningPrices} rates={config.eventRates} zones={config.zones} /></RevealItem>
      </Reveal>

      <Reveal as="section" className="sec g-app">
        <RevealItem><AppPromo /></RevealItem>
      </Reveal>

      <Reveal as="section" className="sec">
        <SectionHead title="Лучшие игроки клуба" lead="Рейтинг резидентов на GoMafia — обновляется автоматически." />
        <RevealItem><PlayersPodium data={players} /></RevealItem>
      </Reveal>

      <Reveal as="section" className="sec g-stories">
        <SectionHead title="Турниры и события" lead="Society Mafia Cup, миникапы и вечеринки клуба." />
        <RevealItem><StoriesGrid stories={stories} limit={10} /></RevealItem>
        <RevealItem><p className="sec-more"><Link href="/portfolio" className="btn btn-ghost glass">Все события <ArrowRight size={16} aria-hidden="true" /></Link></p></RevealItem>
      </Reveal>

      <section className="sec">
        <div className="sec-head"><h2>Что говорят гости</h2></div>
        <ReviewsMarquee />
      </section>

      <Reveal as="section" className="cta-band glass">
        <RevealItem>
          <h2>Ваше место за столом</h2>
          <p>Оставьте заявку — администратор перезвонит и запишет на ближайший вечер.</p>
        </RevealItem>
        <RevealItem className="actions">
          <RequestButton preset={{ kind: 'game' }} className="btn btn-primary btn-lg">Записаться на игру</RequestButton>
          <RequestButton preset={{ kind: 'event' }} className="btn btn-link">Заказать мероприятие</RequestButton>
        </RevealItem>
      </Reveal>
    </div>
  )
}
