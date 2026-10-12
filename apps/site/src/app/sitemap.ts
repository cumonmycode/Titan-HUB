import type { MetadataRoute } from 'next'
import { SITE } from '@/content/site'
import { getStories } from '@/lib/hub'

export const revalidate = 3600

const PAGES = ['', '/games', '/events', '/kidspromo', '/portfolio', '/residents', '/studio', '/contact', '/promoinfo', '/privacy-policy', '/terms-and-conditions', '/refund-policy']

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const stories = await getStories()
  return [
    ...PAGES.map((p) => ({ url: `${SITE.url}${p}`, changeFrequency: 'weekly' as const, priority: p === '' ? 1 : 0.7 })),
    ...stories.map((s) => ({ url: `${SITE.url}/${s.slug}`, changeFrequency: 'monthly' as const, priority: 0.6 })),
  ]
}
