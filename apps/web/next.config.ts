import path from 'path'
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: path.join(__dirname, '../../'),
  transpilePackages: ['@titan/ui', '@titan/types'],
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'titanpos.ru' },
    ],
  },
  experimental: {
    optimizePackageImports: ['lucide-react', 'framer-motion'],
  },
  // Меню для экрана ТВ (AbleSign) — самодостаточная статическая страница без
  // оболочки PWA: плееры вывесок открывают её во встроенном WebView, где приложение
  // на React падало («Application error»). Адрес для плеера остаётся /menu.
  async rewrites() {
    return {
      beforeFiles: [
        { source: '/menu', destination: '/tv-menu.html' },
        // Экран из раздела «Экраны» (приставка Titan Menu открывает /screen/<id>).
        { source: '/screen/:id', destination: '/tv-menu.html' },
        // Кнопка «Открыть приложение» из бота My Titan: https-страница → titanresident://.
        { source: '/my-titan', destination: '/my-titan.html' },
      ],
    }
  },
}

export default nextConfig
