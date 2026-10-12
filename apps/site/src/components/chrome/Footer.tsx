import Link from 'next/link'
import { FOOTER_LINKS, NAV, SITE, SOCIALS } from '@/content/site'
import type { SiteConfig } from '@/lib/types'

/** Подвал: адрес, часы из HUB, контакты, соцсети, документы. */
export function Footer({ config }: { config: SiteConfig }) {
  const hours = config.venue.hoursOpen && config.venue.hoursClose ? `Каждый день ${config.venue.hoursOpen}–${config.venue.hoursClose}` : 'Каждый вечер'
  return (
    <footer className="ftr">
      <div className="ftr-main">
        <div className="ftr-brand">
          <img src="/media/logo.webp" alt="" width={44} height={44} />
          <p className="ftr-name">{SITE.name}</p>
          <p className="ftr-note">Клуб спортивной и городской мафии с {SITE.since} года.</p>
        </div>
        <address className="ftr-contacts">
          <a href={SITE.mapUrl} target="_blank" rel="noopener noreferrer">{SITE.address}</a>
          <span>{hours}</span>
          <a href={SITE.phoneHref}>{SITE.phone}</a>
          <a href={`mailto:${SITE.email}`}>{SITE.email}</a>
        </address>
        <nav className="ftr-nav" aria-label="Разделы сайта">
          {NAV.map((n) => <Link key={n.href} href={n.href}>{n.label}</Link>)}
        </nav>
        <nav className="ftr-nav" aria-label="Соцсети и документы">
          {SOCIALS.map((s) => <a key={s.id} href={s.href} target="_blank" rel="noopener noreferrer">{s.label}</a>)}
          {FOOTER_LINKS.map((n) => <Link key={n.href} href={n.href}>{n.label}</Link>)}
        </nav>
      </div>
      <p className="ftr-copy">© {SITE.since}–{new Date().getFullYear()} {SITE.name}.</p>
    </footer>
  )
}
