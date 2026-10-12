import type { Metadata } from 'next'
import type { RequestPreset } from '@/lib/types'
import { InlineRequest } from '@/components/InlineRequest'
import { PageHead, Section, Steps } from '@/components/sections/blocks'

export const metadata: Metadata = {
  title: 'Онлайн-запись',
  description: 'Запишитесь на игру, забронируйте зону в клубе TITAN KBR или закажите выезд ведущих — администратор подтвердит заявку, статус придёт в Telegram.',
}

/** ?loc=titan|exit — бронь в клубе или выезд (ссылки и QR бывшей формы HUB /book); ?kind=game|event|message. */
function presetOf(q: { loc?: string; kind?: string }): RequestPreset {
  if (q.loc === 'titan' || q.loc === 'exit') return { kind: 'event', location: q.loc }
  if (q.kind === 'event') return { kind: 'event' }
  if (q.kind === 'message') return { kind: 'message' }
  return { kind: 'game' }
}

export default async function BookPage({ searchParams }: { searchParams: Promise<{ loc?: string; kind?: string }> }) {
  const preset = presetOf(await searchParams)
  return (
    <>
      <PageHead title="Онлайн-запись"
        lead="Игровой вечер, бронь зоны в клубе или выезд ведущих к вам — выберите, что нужно, и оставьте контакты." />
      <div className="split">
        <Section title="Заявка" className="form-card">
          <InlineRequest preset={preset} lockKind={false} />
        </Section>
        <Section title="Как это работает">
          <Steps items={[
            { title: 'Заявка', text: 'Выберите вечер или дату, зону и продолжительность — цены считаются сразу.' },
            { title: 'Подтверждение', text: 'Администратор проверит время и подтвердит заявку, при необходимости перезвонит.' },
            { title: 'Статус в Telegram', text: 'После отправки нажмите «Получать статус в Telegram» — пришлём подтверждение и напомним в день визита.' },
          ]} />
        </Section>
      </div>
    </>
  )
}
