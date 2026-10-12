import type { SiteConfig } from '@/lib/types'
import { SITE, SOCIALS } from '@/content/site'

/** Карточка организации для поисковиков (адрес, телефон, часы, соцсети). */
export function JsonLd({ config }: { config: SiteConfig }) {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'EntertainmentBusiness',
    name: SITE.name,
    alternateName: SITE.nameRu,
    url: SITE.url,
    telephone: '+79656660700',
    email: SITE.email,
    image: `${SITE.url}/media/table-night-1600.webp`,
    logo: `${SITE.url}/media/logo-512.png`,
    foundingDate: String(SITE.since),
    address: { '@type': 'PostalAddress', streetAddress: 'ул. Кабардинская, 152', addressLocality: 'Нальчик', addressRegion: 'Кабардино-Балкарская Республика', addressCountry: 'RU' },
    openingHours: config.venue.hoursOpen && config.venue.hoursClose ? `Mo-Su ${config.venue.hoursOpen}-${config.venue.hoursClose}` : undefined,
    sameAs: SOCIALS.map((s) => s.href),
  }
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }} />
}
