import type { Metadata } from 'next'
import { SITE } from '@/content/site'
import { getSiteConfig, getStories } from '@/lib/hub'
import { CtaBand, PageHead, Section } from '@/components/sections/blocks'
import { Reviews, StoriesGrid, Team, Values } from '@/components/sections/community'

export const revalidate = 60
export const metadata: Metadata = {
  title: 'О клубе',
  description: `TITAN KBR (ex ${SITE.formerName}) — с ${SITE.since} года лидер интеллектуального досуга в Кабардино-Балкарии: турниры и вечера спортивной, городской, детской и корпоративной мафии.`,
}

export default async function AboutPage() {
  const [stories, config] = await Promise.all([getStories(), getSiteConfig()])
  const { content } = config
  const page = content.pages.studio
  return (
    <>
      <PageHead title={page.title} photoName="team-studio" lead={page.lead} />
      {page.text.length > 0 && (
        <Section>
          <div className="prose">{page.text.map((p) => <p key={p}>{p}</p>)}</div>
        </Section>
      )}
      <Section title="Что для нас важно">
        <Values values={content.values} />
      </Section>
      <Section title="Команда" lead="Всё началось с двух людей, которые очень любили играть в мафию — и играют в неё каждый день.">
        <Team team={content.team} />
      </Section>
      <Section title="Нам доверяют">
        <Reviews reviews={content.reviews} />
      </Section>
      <Section title="Наши события">
        <StoriesGrid stories={stories} limit={3} />
      </Section>
      <CtaBand title="Приходите знакомиться" text="Лучший способ узнать клуб — сыграть один вечер." preset={{ kind: 'game' }} label="Записаться на игру" />
    </>
  )
}
