import type { PlayersPayload, SiteConfig, StorySummary } from '@/lib/types'

export interface HomeProps { config: SiteConfig; stories: StorySummary[]; players: PlayersPayload }
