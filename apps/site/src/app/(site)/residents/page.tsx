import type { Metadata } from 'next'
import { ArrowUpRight, Wallet } from 'lucide-react'
import { GOMAFIA, WALLET_CARD_URL } from '@/content/site'
import { getPlayers } from '@/lib/hub'
import { PageHead, Section } from '@/components/sections/blocks'
import { Docs, Players } from '@/components/sections/community'

export const revalidate = 600
export const metadata: Metadata = {
  title: 'Резидентам',
  description: 'Всё для резидентов клуба TITAN KBR: правила спортивной мафии ФСМ, книги по стратегии, рейтинг GoMafia и кэшбэк-карта клуба.',
}

export default async function ResidentsPage() {
  const players = await getPlayers()
  return (
    <>
      <PageHead title="Резидентам" lead="Правила, книги, рейтинг и карта клуба — всё, что нужно, чтобы расти в спортивной мафии." photoName="duo-violet" />
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
      <Section title="Стань частью семьи" lead="Кэшбэк-карта клуба: за каждый игровой вечер возвращаются баллы. Оплачивайте ими до 50 % счёта.">
        <div className="actions">
          <a className="btn btn-primary" href={WALLET_CARD_URL} target="_blank" rel="noopener noreferrer"><Wallet size={18} aria-hidden="true" /> Добавить карту в Wallet</a>
        </div>
      </Section>
    </>
  )
}
