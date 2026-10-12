import type { ReactNode } from 'react'
import type { SiteConfig, ThemeId } from '@/lib/types'
import { RequestProvider } from '@/components/request/RequestProvider'
import { Header } from './Header'
import { Footer } from './Footer'
import { NightSky } from './NightSky'

// Слова главной кнопки — в голосе темы.
const CTA: Record<ThemeId, string> = {
  case: 'Записаться',
  protocol: 'Занять место',
  night: 'Записаться',
  classic: 'Записаться',
}

/** Обёртка сайта в выбранной теме: шапка, контент, подвал и шторка заявки. */
export function ThemeFrame({ theme, config, children }: { theme: ThemeId; config: SiteConfig; children: ReactNode }) {
  return (
    <div className="site" data-theme={theme}>
      <RequestProvider config={config}>
        {theme === 'night' && <NightSky />}
        <Header ctaLabel={CTA[theme]} />
        <main id="main">{children}</main>
        <Footer config={config} />
      </RequestProvider>
    </div>
  )
}
