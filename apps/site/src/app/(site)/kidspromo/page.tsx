import type { Metadata } from 'next'
import { RequestButton } from '@/components/request/RequestButton'
import { CtaBand, PageHead, Section, Steps } from '@/components/sections/blocks'

export const metadata: Metadata = {
  title: 'Детская мафия',
  description: 'Детская мафия в Нальчике: дни рождения, школьные праздники и выходные. Логика, речь и уверенность в весёлом игровом шоу с ведущим TITAN KBR.',
}

export default function KidsPage() {
  return (
    <>
      <PageHead
        title="Детская мафия"
        lead="Игра, где логика встречается с весельем. Каждый ребёнок пробует себя детективом, мирным жителем или хитрым мафиози."
        photoName="kid-mask"
        actions={<RequestButton preset={{ kind: 'event', format: 'kids' }} className="btn btn-primary btn-lg">Оставить заявку</RequestButton>}
      />
      <Section title="Почему детям нравится">
        <div className="prose">
          <p>В TITAN KBR мафия становится настоящим приключением. Мы проводим адаптированные игры для ребят разных возрастов — в формате игрового шоу.</p>
          <p>Дети учатся мыслить стратегически, развивают внимание, речь и уверенность в себе — в увлекательной, безопасной и позитивной атмосфере.</p>
          <p>Детская мафия идеальна для дней рождения, школьных мероприятий и весёлых выходных: море эмоций, добрый смех и впечатления, о которых говорят ещё долго.</p>
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
