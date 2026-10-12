/**
 * Контакты клуба на сайте: из HUB («Сайт → Контакты»), пустые поля — из
 * встроенных значений content/site.ts (сайт не остаётся без телефона, если HUB
 * недоступен или поле ещё не заполнено).
 */
import { SITE, SOCIALS, type SocialLink } from '@/content/site'
import type { SiteContactsData } from './types'

export interface Contacts {
  phone: string
  phoneHref: string
  email: string
  socials: SocialLink[]
}

const SOCIAL_LABELS: Record<SocialLink['id'], string> = {
  telegram: 'Telegram', whatsapp: 'WhatsApp', channel: 'Канал', vk: 'ВКонтакте', instagram: 'Instagram',
}
const SOCIAL_ORDER: SocialLink['id'][] = ['telegram', 'whatsapp', 'channel', 'vk', 'instagram']

function phoneHrefOf(phone: string): string {
  const d = phone.replace(/\D/g, '')
  const n = d.length === 11 && d.startsWith('8') ? `7${d.slice(1)}` : d.length === 10 ? `7${d}` : d
  return `tel:+${n}`
}

export function contactsOf(c: SiteContactsData | null | undefined): Contacts {
  const phone = c?.phone || SITE.phone
  const fallback = Object.fromEntries(SOCIALS.map((s) => [s.id, s.href])) as Partial<Record<SocialLink['id'], string>>
  const socials = SOCIAL_ORDER.flatMap((id) => {
    const href = (c && c[id]) || fallback[id]
    return href ? [{ id, label: SOCIAL_LABELS[id], href }] : []
  })
  return { phone, phoneHref: c?.phone ? phoneHrefOf(c.phone) : SITE.phoneHref, email: c?.email || SITE.email, socials }
}

/** Адрес сайта: домен из HUB или встроенный (для canonical, sitemap, JSON-LD). */
export const siteUrlOf = (url: string | null | undefined): string => url || SITE.url
