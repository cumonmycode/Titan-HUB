import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'
import { notFound } from 'next/navigation'
import { getSiteConfig } from '@/lib/hub'
import { isHoliday } from '@/content/holidays'
import { ThemeFrame } from '@/components/chrome/ThemeFrame'

export const metadata: Metadata = { robots: { index: false, follow: false } }
export const viewport: Viewport = { themeColor: '#07060E', width: 'device-width', initialScale: 1, viewportFit: 'cover' }

/** Превью праздника для владельца: /preview/<праздник> (или /preview/none) — сам сайт не меняется. */
export default async function PreviewLayout({ children, params }: { children: ReactNode; params: Promise<{ holiday: string }> }) {
  const { holiday } = await params
  if (holiday !== 'none' && !isHoliday(holiday)) notFound()
  const config = await getSiteConfig()
  return <ThemeFrame config={config} holiday={isHoliday(holiday) ? holiday : null}>{children}</ThemeFrame>
}
