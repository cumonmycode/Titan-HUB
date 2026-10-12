import type { Metadata } from 'next'
import { SITE } from '@/content/site'
import { InlineRequest } from '@/components/InlineRequest'
import { PageHead, Section, Steps } from '@/components/sections/blocks'

export const metadata: Metadata = {
  title: 'Активировать сертификат',
  description: 'Сертификат на вечер мафии с друзьями от TITAN KBR: выберите штаб клуба или свою локацию и оставьте данные — мы свяжемся.',
}

export default function CertificatePage() {
  return (
    <>
      <PageHead title="Вы получили сертификат на вечер мафии" photoName="noir-hats"
        lead="Гарантируем незабываемые эмоции и настоящую атмосферу игры. Ведущие проведут профессиональную мафию — выберите формат." />
      <Section title="Где играть">
        <Steps items={[
          { title: 'Штаб TITAN KBR', text: `Выберите дату и время, сообщите количество участников и приезжайте в клуб: ${SITE.address}. Для обладателей сертификата участие бесплатное.` },
          { title: 'Ваша локация', text: 'Предпочитаете играть у себя? Ведущие приедут с полным комплектом реквизита — домой, в офис или в любое другое место.' },
        ]} />
      </Section>
      <Section title="Осталось заполнить данные" lead="Сотрудник свяжется с вами, всё расскажет и ответит на вопросы." className="form-card">
        <InlineRequest preset={{ kind: 'certificate' }} />
      </Section>
    </>
  )
}
