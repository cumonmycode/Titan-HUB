import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import '@fontsource-variable/onest/index.css'
import '@/styles/base.css'
import '@/styles/glass.css'
import '@/styles/holiday.css'
import { SITE, VERIFICATION } from '@/content/site'

const DESCRIPTION = 'Клуб мафии TITAN KBR в Нальчике: городская и спортивная мафия каждый вечер, турниры с рейтингом, дни рождения, корпоративы, детская мафия и выезд. Кабардинская, 152.'

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: { default: 'TITAN KBR — поиграть в мафию в Нальчике', template: '%s — TITAN KBR' },
  description: DESCRIPTION,
  applicationName: SITE.name,
  verification: { google: VERIFICATION.google, yandex: VERIFICATION.yandex, other: { 'msvalidate.01': VERIFICATION.bing } },
  openGraph: {
    type: 'website', locale: 'ru_RU', siteName: SITE.name, url: SITE.url,
    title: 'TITAN KBR — клуб мафии в Нальчике', description: DESCRIPTION,
    images: [{ url: '/media/table-night-1600.webp', width: 1600, height: 1067, alt: 'Игра в мафию в штабе TITAN KBR' }],
  },
  twitter: { card: 'summary_large_image' },
  icons: { icon: '/media/logo-512.png', apple: '/media/logo-512.png' },
  formatDetection: { telephone: false },
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  )
}
