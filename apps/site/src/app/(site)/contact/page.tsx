import type { Metadata } from 'next'
import { MapPin, Phone } from 'lucide-react'
import { SITE } from '@/content/site'
import { InlineRequest } from '@/components/InlineRequest'
import { PageHead, Section } from '@/components/sections/blocks'
import { ContactList } from '@/components/sections/community'
import { getSiteConfig } from '@/lib/hub'
import { contactsOf } from '@/lib/contacts'

export async function generateMetadata(): Promise<Metadata> {
  const { phone } = contactsOf((await getSiteConfig()).contacts)
  return { title: 'Контакты', description: `Клуб мафии TITAN KBR: ${SITE.address}, телефон и WhatsApp ${phone}, Telegram, ВКонтакте, Instagram.` }
}

export default async function ContactPage() {
  const contacts = contactsOf((await getSiteConfig()).contacts)
  return (
    <>
      <PageHead
        title="Контакты"
        lead="Клуб открыт для всех, кто любит мафию, общение и яркие эмоции. Турниры, миникапы, корпоративы и праздники в формате мафии."
        actions={<>
          <a className="btn btn-primary btn-lg" href={contacts.phoneHref}><Phone size={18} aria-hidden="true" /> Позвонить</a>
          <a className="btn btn-ghost btn-lg" href={SITE.mapUrl} target="_blank" rel="noopener noreferrer"><MapPin size={18} aria-hidden="true" /> Как добраться</a>
        </>}
      />
      <div className="split">
        <Section title="Где нас найти">
          <ContactList contacts={contacts} />
        </Section>
        <Section title="Готовы сотрудничать?" lead="Опишите предложение или задайте вопрос — свяжемся с вами." className="form-card">
          <InlineRequest preset={{ kind: 'message', topic: 'partnership' }} />
        </Section>
      </div>
    </>
  )
}
