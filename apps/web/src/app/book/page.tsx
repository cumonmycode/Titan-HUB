'use client'
/**
 * Бывшая форма брони HUB. Онлайн-запись теперь одна — на сайте клуба: старые
 * ссылки и QR (/book?loc=titan|exit) ведут на страницу записи сайта с тем же выбором.
 */
import { useEffect } from 'react'
import { api } from '@/lib/api'
import { SITE_URL } from '@/lib/site'

export default function BookRedirect() {
  useEffect(() => {
    const go = (base: string) => window.location.replace(`${base}/book${window.location.search}`)
    api.get<{ url?: string | null }>('/site/config')
      .then((c) => go(c.url && /^https:\/\//.test(c.url) ? c.url : SITE_URL))
      .catch(() => go(SITE_URL))
  }, [])
  return (
    <main style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 24, textAlign: 'center', color: 'var(--on-surface-variant)' }}>
      Открываем онлайн-запись на сайте клуба…
    </main>
  )
}
