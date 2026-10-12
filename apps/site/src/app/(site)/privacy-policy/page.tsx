import type { Metadata } from 'next'
import { PRIVACY } from '@/content/legal'
import { Legal } from '@/components/sections/Legal'

export const metadata: Metadata = { title: 'Политика конфиденциальности' }

export default function PrivacyPage() {
  return <Legal title="Политика конфиденциальности" lead="Как мы обращаемся с персональными данными гостей сайта и клуба." sections={PRIVACY} />
}
