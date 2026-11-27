import type { Metadata } from 'next'
import { RequestButton } from '@/components/request/RequestButton'
import { getSiteConfig } from '@/lib/hub'
import { CtaBand, PageHead, Section, Steps } from '@/components/sections/blocks'

export const metadata: Metadata = {
  title: 'Детская мафия',
  description: 'Детская мафия в Нальчике: дни рождения, школьные праздники и выходные. Логика, речь и уверенность в весёлом игровом шоу с ведущим TITAN KBR.',
}

export const revalidate = 60

export default async function KidsPage() {
  const page = (await getSiteConfig()).content.pages.kids
  return (
    <>
      <PageHead
        title={page.title}
        lead={page.lead}
        photoName="kid-mask"
        actions={<RequestButton preset={{ kind: 'event', format: 'kids' }} className="btn btn-primary btn-lg">Оставить заявку</RequestButton>}
      />
      <Section title="Почему детям нравится">
        <div className="prose">
          {page.text.map((p) => <p key={p}>{p}</p>)}
        </div>
      </Section>
      <Section title="Что развивает игра">
        <Steps items={[
          { title: 'Логика', text: 'Сопоставлять факты и делать выводы.' },
          { title: 'Речь', text: 'Убедительно говорить перед группой.' },
          { title: 'Внимание', text: 'Замечать детали, взгляды и жесты.' },
          { title: 'Уверенность', text: 'Отстаивать своё мнение по правилам игры.' },
        ]} />
      </Section>
      <CtaBand title="Праздник для детей" text="Оставьте телефон — перезвоним, подберём формат под возраст и количество гостей." preset={{ kind: 'event', format: 'kids' }} label="Оставить заявку" />
    </>
  )
}
