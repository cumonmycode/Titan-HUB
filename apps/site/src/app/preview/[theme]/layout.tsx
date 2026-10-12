import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { notFound } from 'next/navigation'
import { getSiteConfig } from '@/lib/hub'
import { isTheme } from '@/lib/types'
import { ThemeFrame } from '@/components/chrome/ThemeFrame'

export const metadata: Metadata = { robots: { index: false, follow: false } }

/** Превью темы для владельца: /preview/<тема> — главная в выбранной теме, не трогая сайт. */
export default async function PreviewLayout({ children, params }: { children: ReactNode; params: Promise<{ theme: string }> }) {
  const { theme } = await params
  if (!isTheme(theme)) notFound()
  const config = await getSiteConfig()
  return <ThemeFrame theme={theme} config={{ ...config, theme }}>{children}</ThemeFrame>
}
