import { notFound } from 'next/navigation'
import { getPlayers, getSiteConfig, getStories } from '@/lib/hub'
import { isTheme, THEMES } from '@/lib/types'
import { Home } from '@/themes'

export const revalidate = 60
export function generateStaticParams() { return THEMES.map((theme) => ({ theme })) }

export default async function PreviewPage({ params }: { params: Promise<{ theme: string }> }) {
  const { theme } = await params
  if (!isTheme(theme)) notFound()
  const [config, stories, players] = await Promise.all([getSiteConfig(), getStories(), getPlayers()])
  return <Home theme={theme} config={{ ...config, theme }} stories={stories} players={players} />
}
