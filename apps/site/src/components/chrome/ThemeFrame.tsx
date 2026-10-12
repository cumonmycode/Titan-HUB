import type { ReactNode } from 'react'
import type { HolidayId } from '@/content/holidays'
import type { SiteConfig } from '@/lib/types'
import { RequestProvider } from '@/components/request/RequestProvider'
import { GlassSheen } from '@/components/motion/GlassSheen'
import { GlassBackdrop } from '@/components/glass/GlassBackdrop'
import { MobileDock } from '@/components/glass/MobileDock'
import { HolidayLayer } from '@/components/holiday/HolidayLayer'
import { contactsOf } from '@/lib/contacts'
import { ContactsProvider } from './ContactsContext'
import { Header } from './Header'
import { Footer } from './Footer'

const CTA = 'Записаться'

/**
 * Каркас сайта (Liquid Glass): подложка, шапка-капсула, контент, подвал, нижняя
 * панель на телефоне и шторка заявки; при включённом в HUB празднике — его слой.
 */
export function ThemeFrame({ config, holiday, children }: { config: SiteConfig; holiday: HolidayId | null; children: ReactNode }) {
  const contacts = contactsOf(config.contacts)
  return (
    <div className="site" data-theme="glass" data-holiday={holiday ?? undefined}>
      <ContactsProvider value={contacts}>
      <RequestProvider config={config}>
        <GlassBackdrop />
        <GlassSheen />
        <Header ctaLabel={CTA} />
        <main id="main">{children}</main>
        <Footer config={config} />
        <MobileDock ctaLabel={CTA} phone={contacts.phone} phoneHref={contacts.phoneHref} />
        {holiday && <HolidayLayer key={holiday} holiday={holiday} />}
      </RequestProvider>
      </ContactsProvider>
    </div>
  )
}
