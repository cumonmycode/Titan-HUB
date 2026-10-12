import { notFound } from 'next/navigation'
import { getPlayers, getSiteConfig, getStories } from '@/lib/hub'
import { HOLIDAYS, isHoliday } from '@/content/holidays'
import { GlassHome } from '@/themes/GlassHome'

export const revalidate = 60
export function generateStaticParams() { return [...HOLIDAYS, 'none'].map((holiday) => ({ holiday })) }

export default async function PreviewPage({ params }: { params: Promise<{ holiday: string }> }) {
  const { holiday } = await params
  if (holiday !== 'none' && !isHoliday(holiday)) notFound()
  const [config, stories, players] = await Promise.all([getSiteConfig(), getStories(), getPlayers()])
  return <GlassHome config={config} stories={stories} players={players} />
}
