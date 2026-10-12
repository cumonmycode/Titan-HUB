import type { MetadataRoute } from 'next'
import { getSiteConfig, getStories } from '@/lib/hub'
import { siteUrlOf } from '@/lib/contacts'

export const revalidate = 3600

const PAGES = ['', '/book', '/games', '/events', '/kidspromo', '/portfolio', '/residents', '/studio', '/contact', '/promoinfo', '/privacy-policy', '/terms-and-conditions', '/refund-policy']

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [stories, config] = await Promise.all([getStories(), getSiteConfig()])
  const url = siteUrlOf(config.url)
  return [
    ...PAGES.map((p) => ({ url: `${url}${p}`, changeFrequency: 'weekly' as const, priority: p === '' ? 1 : 0.7 })),
    ...stories.map((s) => ({ url: `${url}/${s.slug}`, changeFrequency: 'monthly' as const, priority: 0.6 })),
  ]
}
