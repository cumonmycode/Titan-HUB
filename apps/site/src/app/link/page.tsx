import type { Metadata, Viewport } from 'next'
import { SITE } from '@/content/site'
import { getSiteConfig } from '@/lib/hub'
import { contactsOf, siteUrlOf } from '@/lib/contacts'
import type { SiteConfig, SiteLink, SiteLinkKind } from '@/lib/types'
import { ContactsProvider } from '@/components/chrome/ContactsContext'
import { RequestProvider } from '@/components/request/RequestProvider'
import { GlassBackdrop } from '@/components/glass/GlassBackdrop'
import { HolidayLayer } from '@/components/holiday/HolidayLayer'
import { TonightSignups } from '@/components/live/TonightSignups'
import { LinkButtons, type LinkItem } from '@/components/links/LinkButtons'

/**
 * Таплинк клуба (/link): одна ссылка для профилей в соцсетях — запись на игру и
 * мероприятие, Tai в Telegram, телефон, мессенджеры, соцсети, как добраться и сайт.
 * Кнопки, их порядок и подписи — в HUB («Сайт → Таплинк»); адреса берутся из контактов.
 */
export const viewport: Viewport = { themeColor: '#07060E', width: 'device-width', initialScale: 1, viewportFit: 'cover' }
export const metadata: Metadata = {
  title: 'Все ссылки',
  description: 'TITAN KBR — клуб мафии в Нальчике: записаться на игру, заказать мероприятие, написать администратору, контакты и соцсети.',
  alternates: { canonical: '/link' },
}

const DEFAULT_KINDS: SiteLinkKind[] = ['book_game', 'tai', 'book_event', 'phone', 'whatsapp', 'channel', 'vk', 'instagram', 'map', 'site']
const DEFAULT_BIO = 'Клуб спортивной и городской мафии. Игры каждый вечер, турниры, дни рождения и корпоративы.'
const LABEL: Record<SiteLinkKind, string> = {
  book_game: 'Записаться на игру',
  book_event: 'Заказать мероприятие',
  tai: 'Написать администратору',
  telegram: 'Telegram',
  channel: 'Канал клуба',
  whatsapp: 'WhatsApp',
  vk: 'ВКонтакте',
  instagram: 'Instagram',
  phone: 'Позвонить',
  map: 'Как добраться',
  site: 'Сайт клуба',
  custom: 'Ссылка',
}
const HINT: Partial<Record<SiteLinkKind, string>> = {
  book_event: 'День рождения, корпоратив, детская мафия, выезд',
  tai: 'Tai в Telegram — ответит сразу и подтвердит запись',
}

const mapUrl = (address: string) => (address ? `https://yandex.ru/maps/?text=${encodeURIComponent(`Нальчик, ${address}`)}` : SITE.mapUrl)

/** Кнопки таплинка с готовыми адресами; кнопки без адреса не показываем. */
function itemsOf(config: SiteConfig): LinkItem[] {
  const contacts = contactsOf(config.contacts)
  const social = (id: string) => contacts.socials.find((s) => s.id === id)?.href ?? null
  const source: SiteLink[] = config.links?.links ?? DEFAULT_KINDS.map((kind) => ({ id: kind, kind, label: '', url: '', on: true }))
  const hrefOf = (l: SiteLink): string | null => {
    switch (l.kind) {
      case 'book_game': case 'book_event': return null
      case 'tai': return config.taiUrl
      case 'telegram': case 'channel': case 'whatsapp': case 'vk': case 'instagram': return social(l.kind)
      case 'phone': return contacts.phoneHref
      case 'map': return mapUrl(config.venue.address)
      case 'site': return siteUrlOf(config.url)
      case 'custom': return /^https:\/\//.test(l.url) ? l.url : null
    }
  }
  return source.filter((l) => l.on).flatMap((l) => {
    const href = hrefOf(l)
    if (l.kind !== 'book_game' && l.kind !== 'book_event' && !href) return []
    const hint = l.kind === 'phone' ? contacts.phone : l.kind === 'map' ? config.venue.address || SITE.address : HINT[l.kind] ?? null
    return [{ id: l.id, kind: l.kind, label: l.label || LABEL[l.kind], hint, href }]
  })
}

export default async function LinkPage() {
  const config = await getSiteConfig()
  const contacts = contactsOf(config.contacts)
  const title = config.links?.title || config.venue.name || SITE.name
  const bio = config.links ? config.links.bio : DEFAULT_BIO
  const hours = config.venue.hoursOpen && config.venue.hoursClose ? `${config.venue.hoursOpen}–${config.venue.hoursClose}` : null
  return (
    <div className="site lk-site" data-theme="glass" data-holiday={config.holiday ?? undefined}>
      <ContactsProvider value={contacts}>
        <RequestProvider config={config}>
          <GlassBackdrop />
          <main className="lk">
            <header className="lk-head">
              <span className="lk-logo"><img src="/media/logo.webp" alt="" width={88} height={88} /></span>
              <h1>{title}</h1>
              {bio && <p className="lk-bio">{bio}</p>}
              <TonightSignups />
            </header>
            <LinkButtons items={itemsOf(config)} schedule={config.schedule} />
            <footer className="lk-foot">
              <p>{[config.venue.address || SITE.address, hours].filter(Boolean).join(' · ')}</p>
              <a href="/">{siteUrlOf(config.url).replace(/^https:\/\//, '')}</a>
            </footer>
          </main>
          {config.holiday && <HolidayLayer key={config.holiday} holiday={config.holiday} />}
        </RequestProvider>
      </ContactsProvider>
    </div>
  )
}
