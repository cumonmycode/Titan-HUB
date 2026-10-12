import { getPlayers, getSiteConfig, getStories } from '@/lib/hub'
import { GlassHome } from '@/themes/GlassHome'

export const revalidate = 60

export default async function HomePage() {
  const [config, stories, players] = await Promise.all([getSiteConfig(), getStories(), getPlayers()])
  return <GlassHome config={config} stories={stories} players={players} />
}
