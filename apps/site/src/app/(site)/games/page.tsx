import type { Metadata } from 'next'
import { FORMATS } from '@/content/formats'
import { getSiteConfig } from '@/lib/hub'
import { RequestButton } from '@/components/request/RequestButton'
import { CtaBand, Faq, PageHead, Section, Steps } from '@/components/sections/blocks'
import { EveningPrices, Formats, Schedule } from '@/components/sections/offer'

export const revalidate = 60
export const metadata: Metadata = {
  title: 'Игровые вечера — расписание и цены',
  description: 'Городская и спортивная мафия в Нальчике каждый вечер: расписание игр, цены для новичков, резидентов и студентов, запись онлайн.',
}

const STEPS = [
  { title: 'Записываетесь', text: 'Оставьте заявку на вечер — администратор подтвердит место звонком или в мессенджере.' },
  { title: 'Приходите к началу', text: 'Штаб на Кабардинской, 152. Новичкам ведущий объяснит правила перед первой игрой.' },
  { title: 'Получаете роль', text: 'Мирный житель, мафия, дон или шериф — карта роли решает, на чьей вы стороне.' },
  { title: 'Ночь и день', text: 'Ночью мафия действует, днём город спорит и голосует. Найдите мафию раньше, чем она найдёт вас.' },
]

export default async function GamesPage() {
  const config = await getSiteConfig()
  const games = FORMATS.filter((f) => f.request.kind === 'game')
  return (
    <>
      <PageHead
        title="Игровые вечера"
        lead="Городская мафия для всех, спортивная — по правилам ФСМ с рейтингом, и настольные игры компанией. Приходите один или с друзьями."
        photoName="players"
        actions={<RequestButton preset={{ kind: 'game' }} className="btn btn-primary btn-lg">Записаться на игру</RequestButton>}
      />
      <Section title="Расписание" lead="Ближайшие вечера по данным клуба.">
        <Schedule config={config} days={10} />
      </Section>
      <Section title="Сколько стоит вечер" lead="Цена зависит от статуса гостя. Баллы My Titan оплачивают до половины счёта.">
        <EveningPrices config={config} />
      </Section>
      <Section title="Как проходит игра">
        <Steps items={STEPS} />
      </Section>
      <Section title="Форматы">
        <Formats formats={games} config={config} />
      </Section>
      <Section title="Вопросы новичков">
        <Faq items={[
          { q: 'Нужно ли уметь играть?', a: 'Нет. Ведущий объяснит правила перед игрой, а первые партии помогут освоиться.' },
          { q: 'Можно прийти одному?', a: 'Да — за столом соберётся компания. Отметьте в заявке, что вы впервые.' },
          { q: 'Чем отличается спортивная мафия?', a: 'Строгими правилами Федерации спортивной мафии, судейством и рейтингом ELO на GoMafia. Подготовиться помогут материалы в разделе «Резидентам».' },
          { q: 'Как получить скидку?', a: 'Для студентов и резидентов клуба действуют отдельные цены, а в приложении My Titan копятся баллы за каждое посещение.' },
        ]} />
      </Section>
      <CtaBand title="Ваше место за столом" text="Запишитесь на ближайший вечер — подтвердим звонком." preset={{ kind: 'game' }} label="Записаться" />
    </>
  )
}
