import type { Viewport } from 'next'
import type { ReactNode } from 'react'
import { getSiteConfig } from '@/lib/hub'
import { ThemeFrame } from '@/components/chrome/ThemeFrame'
import { THEME_COLOR } from '@/lib/theme-color'
import { JsonLd } from '@/components/JsonLd'

export async function generateViewport(): Promise<Viewport> {
  const config = await getSiteConfig()
  return { themeColor: THEME_COLOR[config.theme], width: 'device-width', initialScale: 1, viewportFit: 'cover' }
}

export default async function SiteLayout({ children }: { children: ReactNode }) {
  const config = await getSiteConfig()
  return (
    <ThemeFrame theme={config.theme} config={config}>
      <JsonLd config={config} />
      {children}
    </ThemeFrame>
  )
}
