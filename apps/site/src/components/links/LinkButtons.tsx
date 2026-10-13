'use client'
/**
 * Кнопки таплинка: запись на игру и мероприятие открывают шторку заявки (она сразу
 * ведёт к Tai), остальные — ссылки. Подписи и адреса уже собраны на сервере (page.tsx).
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

export function LinkButtons({ items, schedule }: { items: LinkItem[]; schedule: ScheduleDay[] }) {
  const { open } = useRequest()
  const nextGame = useNextGame(schedule)
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
