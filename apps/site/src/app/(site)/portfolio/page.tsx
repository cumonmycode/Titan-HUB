import type { Metadata } from 'next'
import { getStories } from '@/lib/hub'
import { PageHead, Section } from '@/components/sections/blocks'
import { StoriesGrid } from '@/components/sections/community'

export const revalidate = 60
export const metadata: Metadata = {
  title: 'Турниры и события',
  description: 'Society Mafia Cup, миникапы и вечеринки клуба TITAN KBR: цифры, фото и результаты на GoMafia.',
}

export default async function PortfolioPage() {
  const stories = await getStories()
  return (
    <>
      <PageHead title="Турниры и события" lead="Большие турниры по спортивной мафии, миникапы и вечеринки клуба — с цифрами, фото и результатами." />
      <Section>
        <StoriesGrid stories={stories} />
      </Section>
    </>
  )
}
