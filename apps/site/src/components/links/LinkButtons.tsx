'use client'
/**
 * Кнопки таплинка: запись на игру раскрывает выбор «На сайте» (шторка заявки) или
 * «В Telegram» (Tai сразу начинает запись), мероприятие открывает шторку заявки,
 * остальные — ссылки. Подписи и адреса уже собраны на сервере (page.tsx).
 */
import { useEffect, useState } from 'react'
import { ArrowUpRight, CalendarCheck, Globe, Instagram, Link2, MapPin, Megaphone, MessageCircle, PartyPopper, Phone, Send, Sparkles, type LucideIcon } from 'lucide-react'
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

/** «Сегодня · Городская мафия, 19:00» — ближайшая игра, считается у гостя по его времени. */
function useNextGame(schedule: ScheduleDay[]): string | null {
  const [label, setLabel] = useState<string | null>(null)
  useEffect(() => {
    const next = upcomingEvenings(schedule, 1)[0]
    setLabel(next ? `${next.label} · ${next.title}, ${next.time}` : null)
  }, [schedule])
  return label
}

export function LinkButtons({ items, schedule, taiUrl }: { items: LinkItem[]; schedule: ScheduleDay[]; taiUrl: string | null }) {
  const { open } = useRequest()
  const nextGame = useNextGame(schedule)
  const [choosing, setChoosing] = useState(false)
  return (
    <nav className="lk-list" aria-label="Ссылки клуба">
      {items.map((item) => {
        const Icon = ICONS[item.kind]
        const primary = item.kind === 'book_game' || item.kind === 'tai'
        const hint = item.kind === 'book_game' ? nextGame ?? item.hint : item.hint
        const body = (
          <>
            <span className="lk-icon" aria-hidden="true"><Icon size={20} strokeWidth={2.2} /></span>
            <span className="lk-text">
              <span className="lk-label">{item.label}</span>
              {hint && <span className="lk-hint">{hint}</span>}
            </span>
            <ArrowUpRight className="lk-arrow" size={18} aria-hidden="true" />
          </>
        )
        const className = `lk-btn ${primary ? 'lk-primary' : 'glass'}`
        if (item.kind === 'book_game' && taiUrl) {
          return (
            <div key={item.id} className={`lk-choice${choosing ? ' is-open' : ''}`}>
              <button type="button" className={className} aria-expanded={choosing} onClick={() => setChoosing((v) => !v)}>
                {body}
              </button>
              <div className="lk-choice-row" aria-hidden={!choosing}>
                <div className="lk-choice-inner">
                  <button type="button" className="lk-opt glass" tabIndex={choosing ? 0 : -1} onClick={() => open({ kind: 'game' })}>
                    <Globe size={18} strokeWidth={2.2} aria-hidden="true" />
                    <span>На сайте</span>
                  </button>
                  <a className="lk-opt glass" href={`${taiUrl}?start=game`} target="_blank" rel="noopener noreferrer" tabIndex={choosing ? 0 : -1}>
                    <Send size={18} strokeWidth={2.2} aria-hidden="true" />
                    <span>В Telegram</span>
                  </a>
                </div>
              </div>
            </div>
          )
        }
        if (item.kind === 'book_game' || item.kind === 'book_event') {
          return (
            <button key={item.id} type="button" className={className} onClick={() => open(item.kind === 'book_game' ? { kind: 'game' } : { kind: 'event' })}>
              {body}
            </button>
          )
        }
        const external = !!item.href && /^https?:/.test(item.href)
        return (
          <a key={item.id} className={className} href={item.href ?? '#'} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
            {body}
          </a>
        )
      })}
    </nav>
  )
}
