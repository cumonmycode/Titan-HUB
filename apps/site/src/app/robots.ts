import type { MetadataRoute } from 'next'
import { getSiteConfig } from '@/lib/hub'
import { siteUrlOf } from '@/lib/contacts'

export default async function robots(): Promise<MetadataRoute.Robots> {
  const url = siteUrlOf((await getSiteConfig()).url)
  return { rules: [{ userAgent: '*', allow: '/', disallow: ['/preview/', '/api/'] }], sitemap: `${url}/sitemap.xml`, host: url }
}
