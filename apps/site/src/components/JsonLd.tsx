import type { SiteConfig } from '@/lib/types'
import { SITE } from '@/content/site'
import { contactsOf, siteUrlOf } from '@/lib/contacts'

/** Карточка организации для поисковиков (адрес, телефон, часы, соцсети). */
export function JsonLd({ config }: { config: SiteConfig }) {
  const contacts = contactsOf(config.contacts)
  const url = siteUrlOf(config.url)
  const data = {
    '@context': 'https://schema.org',
    '@type': 'EntertainmentBusiness',
    name: SITE.name,
    alternateName: SITE.nameRu,
    url,
    telephone: contacts.phoneHref.replace(/^tel:/, ''),
    email: contacts.email,
    image: `${url}/media/table-night-1600.webp`,
    logo: `${url}/media/logo-512.png`,
    foundingDate: String(SITE.since),
    address: { '@type': 'PostalAddress', streetAddress: 'ул. Кабардинская, 152', addressLocality: 'Нальчик', addressRegion: 'Кабардино-Балкарская Республика', addressCountry: 'RU' },
    openingHours: config.venue.hoursOpen && config.venue.hoursClose ? `Mo-Su ${config.venue.hoursOpen}-${config.venue.hoursClose}` : undefined,
    sameAs: contacts.socials.map((s) => s.href),
  }
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }} />
}
