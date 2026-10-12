import type { Metadata } from 'next'
import { ArrowUpRight } from 'lucide-react'
import { GOMAFIA } from '@/content/site'
import { AppPromo } from '@/components/app/AppPromo'
import { getPlayers } from '@/lib/hub'
import { PageHead, Section } from '@/components/sections/blocks'
import { Docs, Players } from '@/components/sections/community'

export const revalidate = 600
export const metadata: Metadata = {
  title: 'Резидентам',
  description: 'Всё для резидентов клуба TITAN KBR: правила спортивной мафии ФСМ, книги по стратегии, рейтинг GoMafia и приложение клуба My Titan.',
}

export default async function ResidentsPage() {
  const players = await getPlayers()
  return (
    <>
      <PageHead title="Резидентам" lead="Правила, книги, рейтинг и приложение клуба — всё, что нужно, чтобы расти в спортивной мафии." photoName="duo-violet" />
      <Section title="Важная литература">
        <Docs />
      </Section>
      <Section title="GoMafia" lead="Единая платформа Федерации спортивной мафии: ближайшие турниры и заявки на участие. Нужен аккаунт и заявка на вступление в клуб.">
        <div className="actions">
          <a className="btn btn-primary" href={GOMAFIA.register} target="_blank" rel="noopener noreferrer">Регистрация <ArrowUpRight size={16} aria-hidden="true" /></a>
          <a className="btn btn-ghost" href={GOMAFIA.club} target="_blank" rel="noopener noreferrer">Вступить в клуб <ArrowUpRight size={16} aria-hidden="true" /></a>
        </div>
        <Players data={players} limit={20} />
      </Section>
      <AppPromo title="Стань частью семьи" />
    </>
  )
}
