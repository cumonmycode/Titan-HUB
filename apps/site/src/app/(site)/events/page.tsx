import type { Metadata } from 'next'
import { FORMATS } from '@/content/formats'
import { getSiteConfig, getStories } from '@/lib/hub'
import { RequestButton } from '@/components/request/RequestButton'
import { CtaBand, PageHead, Section, Steps } from '@/components/sections/blocks'
import { EventRates, Formats, Zones } from '@/components/sections/offer'
import { StoriesGrid } from '@/components/sections/community'

export const revalidate = 60
export const metadata: Metadata = {
  title: 'Праздники и мероприятия с мафией',
  description: 'День рождения, корпоратив, детская мафия и тематические вечеринки в Нальчике: в штабе клуба или выездом со всем реквизитом. Тарифы и заявка онлайн.',
}

const STEPS = [
  { title: 'Заявка', text: 'Выберите повод, дату и место — в штабе или у вас. Это займёт минуту.' },
  { title: 'Созвон', text: 'Администратор уточнит детали, сценарий и смету.' },
  { title: 'Подготовка', text: 'Ведущий, реквизит и атмосфера — под ваш формат и возраст гостей.' },
  { title: 'Праздник', text: 'Вы отдыхаете, мы ведём игру и держим темп вечера.' },
]

export default async function EventsPage() {
  const [config, stories] = await Promise.all([getSiteConfig(), getStories()])
  const events = FORMATS.filter((f) => f.request.kind === 'event')
  return (
    <>
      <PageHead
        title="Праздник с мафией"
        lead="Дни рождения, корпоративы, детские праздники и тематические вечеринки. Проводим в штабе клуба или приезжаем к вам со всем реквизитом."
        photoName="5y-2"
        actions={<>
          <RequestButton preset={{ kind: 'event' }} className="btn btn-primary btn-lg">Заказать мероприятие</RequestButton>
          <RequestButton preset={{ kind: 'event', location: 'exit' }} className="btn btn-ghost btn-lg">Выезд к вам</RequestButton>
        </>}
      />
      <Section title="Форматы">
        <Formats formats={events} config={config} />
      </Section>
      <Section title="Тарифы" lead="Стоимость мероприятия по продолжительности.">
        <EventRates config={config} />
      </Section>
      {config.zones.length > 0 && (
        <Section title="Залы штаба" lead="Почасовая аренда зон клуба.">
          <Zones config={config} />
        </Section>
      )}
      <Section title="Как заказать">
        <Steps items={STEPS} />
      </Section>
      <Section title="Как это было" lead="Вечеринки и турниры, которые мы провели.">
        <StoriesGrid stories={stories} limit={3} />
      </Section>
      <CtaBand title="Обсудим ваш праздник" text="Оставьте заявку на дату — перезвоним и предложим сценарий." preset={{ kind: 'event' }} label="Заказать мероприятие" />
    </>
  )
}
