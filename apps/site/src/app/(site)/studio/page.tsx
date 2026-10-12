import type { Metadata } from 'next'
import { SITE } from '@/content/site'
import { getStories } from '@/lib/hub'
import { CtaBand, PageHead, Section } from '@/components/sections/blocks'
import { Reviews, StoriesGrid, Team, Values } from '@/components/sections/community'

export const revalidate = 60
export const metadata: Metadata = {
  title: 'О клубе',
  description: `TITAN KBR (ex ${SITE.formerName}) — с ${SITE.since} года лидер интеллектуального досуга в Кабардино-Балкарии: турниры и вечера спортивной, городской, детской и корпоративной мафии.`,
}

export default async function AboutPage() {
  const stories = await getStories()
  return (
    <>
      <PageHead title="Мафия — наше призвание" photoName="team-studio"
        lead={`TITAN KBR (ex ${SITE.formerName}) создан в ${SITE.since} году. Мы проводим турниры и вечера мафии — спортивной, городской, детской и корпоративной — и создаём атмосферу азарта, общения и эмоций.`} />
      <Section title="Что для нас важно">
        <Values />
      </Section>
      <Section title="Команда" lead="Всё началось с двух людей, которые очень любили играть в мафию — и играют в неё каждый день.">
        <Team />
      </Section>
      <Section title="Нам доверяют">
        <Reviews />
      </Section>
      <Section title="Наши события">
        <StoriesGrid stories={stories} limit={3} />
      </Section>
      <CtaBand title="Приходите знакомиться" text="Лучший способ узнать клуб — сыграть один вечер." preset={{ kind: 'game' }} label="Записаться на игру" />
    </>
  )
}
