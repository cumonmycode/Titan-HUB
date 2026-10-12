import type { Viewport } from 'next'
import type { ReactNode } from 'react'
import { getSiteConfig } from '@/lib/hub'
import { ThemeFrame } from '@/components/chrome/ThemeFrame'
import { JsonLd } from '@/components/JsonLd'

export const viewport: Viewport = { themeColor: '#07060E', width: 'device-width', initialScale: 1, viewportFit: 'cover' }

export default async function SiteLayout({ children }: { children: ReactNode }) {
  const config = await getSiteConfig()
  return (
    <ThemeFrame config={config} holiday={config.holiday}>
      <JsonLd config={config} />
      {children}
    </ThemeFrame>
  )
}
