import type { ReactNode } from 'react'
import type { HolidayId } from '@/content/holidays'
import type { SiteConfig } from '@/lib/types'
import { RequestProvider } from '@/components/request/RequestProvider'
import { GlassSheen } from '@/components/motion/GlassSheen'
import { GlassBackdrop } from '@/components/glass/GlassBackdrop'
import { MobileDock } from '@/components/glass/MobileDock'
import { HolidayLayer } from '@/components/holiday/HolidayLayer'
import { Header } from './Header'
import { Footer } from './Footer'

const CTA = 'Записаться'

/**
 * Каркас сайта (Liquid Glass): подложка, шапка-капсула, контент, подвал, нижняя
 * панель на телефоне и шторка заявки; при включённом в HUB празднике — его слой.
 */
export function ThemeFrame({ config, holiday, children }: { config: SiteConfig; holiday: HolidayId | null; children: ReactNode }) {
  return (
    <div className="site" data-theme="glass" data-holiday={holiday ?? undefined}>
      <RequestProvider config={config}>
        <GlassBackdrop />
        <GlassSheen />
        <Header ctaLabel={CTA} />
        <main id="main">{children}</main>
        <Footer config={config} />
        <MobileDock ctaLabel={CTA} />
        {holiday && <HolidayLayer key={holiday} holiday={holiday} />}
      </RequestProvider>
    </div>
  )
}
