'use client'
/**
 * Блоки таплинка: карточка ближайшей игры с записью «На сайте» (шторка заявки) или
 * «В Telegram» (Tai сразу начинает запись), строки действий (мероприятие, Tai, свои
 * ссылки), плитки связи и соцсетей, карточка адреса с маршрутом. Подписи и адреса
 * уже собраны на сервере (page.tsx), порядок из HUB сохраняется внутри блока.
 */
import { useEffect, useState, type CSSProperties } from 'react'
import { CalendarCheck, ChevronRight, Globe, Instagram, Link2, MapPin, Megaphone, MessageCircle, Navigation, PartyPopper, Phone, Send, Sparkles, type LucideIcon } from 'lucide-react'
import type { ScheduleDay, SiteLinkKind } from '@/lib/types'
import { useRequest } from '@/components/request/RequestProvider'
import { upcomingEvenings } from '@/components/request/options'

export interface LinkItem { id: string; kind: SiteLinkKind; label: string; hint: string | null; href: string | null }

const ICONS: Record<SiteLinkKind, LucideIcon> = {
  book_game: CalendarCheck,
  book_event: PartyPopper,
  tai: Sparkles,
  telegram: Send,
  channel: Megaphone,
  whatsapp: MessageCircle,
  vk: Globe,
  instagram: Instagram,
  phone: Phone,
  map: MapPin,
  site: Globe,
  custom: Link2,
}

const CONTACT_KINDS: SiteLinkKind[] = ['phone', 'whatsapp', 'telegram', 'channel', 'vk', 'instagram']
const ROW_KINDS: SiteLinkKind[] = ['book_event', 'tai', 'custom']
/** До четырёх плиток — в один ряд, больше — по три. */
const MAX_TILES_IN_ROW = 4
const TILES_PER_ROW = 3

interface NextGame { when: string; title: string }

/** Ближайшая игра по расписанию — считается у гостя по его времени. */
function useNextGame(schedule: ScheduleDay[]): NextGame | null {
  const [next, setNext] = useState<NextGame | null>(null)
  useEffect(() => {
    const evening = upcomingEvenings(schedule, 1)[0]
    setNext(evening ? { when: `${evening.label}, ${evening.time}`, title: evening.title } : null)
  }, [schedule])
  return next
}

const linkProps = (href: string) => (/^https?:/.test(href) ? { target: '_blank', rel: 'noopener noreferrer' } : {})

type GameCardProps = { item: LinkItem; taiUrl: string | null; schedule: ScheduleDay[] }

function GameCard({ item, taiUrl, schedule }: GameCardProps) {
  const { open } = useRequest()
  const next = useNextGame(schedule)
  const eyebrow = next ? `Ближайшая игра · ${next.when}` : 'Игры каждый вечер'
  return (
    <section className="lk-game" aria-label={item.label}>
      <p className="lk-eyebrow"><CalendarCheck size={15} strokeWidth={2.4} aria-hidden="true" />{eyebrow}</p>
      <h2 className="lk-game-title">{next?.title ?? item.label}</h2>
      <p className="lk-game-sub">{taiUrl ? 'Запишитесь, как удобнее:' : 'Оставьте заявку — администратор подтвердит место.'}</p>
      <div className={`lk-game-actions${taiUrl ? '' : ' is-single'}`}>
        <button type="button" className="lk-cta lk-cta-solid" onClick={() => open({ kind: 'game' })}>
          <Globe size={18} strokeWidth={2.3} aria-hidden="true" />
          {taiUrl ? 'На сайте' : item.label}
        </button>
        {taiUrl && (
          <a className="lk-cta lk-cta-ghost" href={`${taiUrl}?start=game`} target="_blank" rel="noopener noreferrer">
            <Send size={18} strokeWidth={2.3} aria-hidden="true" />
            В Telegram
          </a>
        )}
      </div>
    </section>
  )
}

function ActionRow({ item }: { item: LinkItem }) {
  const { open } = useRequest()
  const Icon = ICONS[item.kind]
  const body = (
    <>
      <span className="lk-icon" aria-hidden="true"><Icon size={20} strokeWidth={2.2} /></span>
      <span className="lk-text">
        <span className="lk-label">{item.label}</span>
        {item.hint && <span className="lk-hint">{item.hint}</span>}
      </span>
      <ChevronRight className="lk-arrow" size={18} aria-hidden="true" />
    </>
  )
  if (item.kind === 'book_event') {
    return <button type="button" className="lk-row glass" onClick={() => open({ kind: 'event' })}>{body}</button>
  }
  if (!item.href) return null
  return <a className="lk-row glass" href={item.href} {...linkProps(item.href)}>{body}</a>
}

function ContactTiles({ items }: { items: LinkItem[] }) {
  const cols = items.length <= MAX_TILES_IN_ROW ? items.length : TILES_PER_ROW
  return (
    <section className="lk-block" aria-labelledby="lk-contacts">
      <h2 id="lk-contacts" className="lk-sec">Связаться и подписаться</h2>
      <div className="lk-tiles" style={{ '--cols': cols } as CSSProperties}>
        {items.map((item) => {
          if (!item.href) return null
          const Icon = ICONS[item.kind]
          return (
            <a key={item.id} className="lk-tile glass" href={item.href} {...linkProps(item.href)} aria-label={item.hint ? `${item.label}: ${item.hint}` : item.label}>
              <span className="lk-tile-icon" aria-hidden="true"><Icon size={22} strokeWidth={2.1} /></span>
              <span className="lk-tile-label">{item.label}</span>
            </a>
          )
        })}
      </div>
    </section>
  )
}

function PlaceCard({ item, hours }: { item: LinkItem; hours: string | null }) {
  if (!item.href) return null
  return (
    <section className="lk-block" aria-labelledby="lk-place">
      <h2 id="lk-place" className="lk-sec">Где мы</h2>
      <a className="lk-row glass" href={item.href} {...linkProps(item.href)}>
        <span className="lk-icon" aria-hidden="true"><MapPin size={20} strokeWidth={2.2} /></span>
        <span className="lk-text">
          <span className="lk-label">{item.hint ?? item.label}</span>
          {hours && <span className="lk-hint">Каждый день {hours}</span>}
        </span>
        <span className="lk-pill"><Navigation size={14} strokeWidth={2.4} aria-hidden="true" />Маршрут</span>
      </a>
    </section>
  )
}

type LinkButtonsProps = { items: LinkItem[]; schedule: ScheduleDay[]; taiUrl: string | null; hours: string | null }

export function LinkButtons({ items, schedule, taiUrl, hours }: LinkButtonsProps) {
  const game = items.find((i) => i.kind === 'book_game')
  const rows = items.filter((i) => ROW_KINDS.includes(i.kind))
  const contacts = items.filter((i) => CONTACT_KINDS.includes(i.kind))
  const place = items.find((i) => i.kind === 'map')
  return (
    <div className="lk-list">
      {game && <GameCard item={game} taiUrl={taiUrl} schedule={schedule} />}
      {rows.length > 0 && (
        <nav className="lk-rows" aria-label="Ещё">
          {rows.map((item) => <ActionRow key={item.id} item={item} />)}
        </nav>
      )}
      {contacts.length > 0 && <ContactTiles items={contacts} />}
      {place && <PlaceCard item={place} hours={hours} />}
    </div>
  )
}
