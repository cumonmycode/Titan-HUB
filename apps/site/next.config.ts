import type { NextConfig } from 'next'

// Сайт клуба: Node-сервер (standalone) — тема, цены и расписание приходят из HUB
// при рендере и кэшируются (ISR, revalidate 60 с). Картинки уже оптимизированы
// (webp двух размеров в public/media), поэтому next/image не нужен.
const nextConfig: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  images: { unoptimized: true },
  async redirects() {
    return [
      // Страницы-заглушки шаблона Wix: кабинет участника и заявление о доступности.
      { source: '/members', destination: '/residents', permanent: true },
      { source: '/accessibility-statement', destination: '/', permanent: true },
      // PDF со старого сайта (ссылки разошлись по чатам резидентов).
      { source: '/_files/ugd/ebde67_c09c4ac728c4427d8f6c32bceb5c5435.pdf', destination: '/docs/pravila-fsm.pdf', permanent: true },
      { source: '/_files/ugd/ebde67_3479bcb06de442b2b21c64fa52f22b29.pdf', destination: '/docs/50-ottenkov-krasnogo.pdf', permanent: true },
      { source: '/_files/ugd/ebde67_ebd263eecd5147fcadbefbfa81edc759.pdf', destination: '/docs/mafia-v-stile-dzen.pdf', permanent: true },
    ]
  },
}

export default nextConfig
