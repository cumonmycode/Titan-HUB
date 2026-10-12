import { getPlayers, getSiteConfig, getStories } from '@/lib/hub'
import { Home } from '@/themes'

export const revalidate = 60

export default async function HomePage() {
  const [config, stories, players] = await Promise.all([getSiteConfig(), getStories(), getPlayers()])
  return <Home theme={config.theme} config={config} stories={stories} players={players} />
}
