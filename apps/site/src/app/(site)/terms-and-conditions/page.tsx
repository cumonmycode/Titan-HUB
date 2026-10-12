import type { Metadata } from 'next'
import { TERMS } from '@/content/legal'
import { Legal } from '@/components/sections/Legal'

export const metadata: Metadata = { title: 'Пользовательское соглашение' }

export default function TermsPage() {
  return <Legal title="Пользовательское соглашение" lead="Условия использования сайта и приёма заявок." sections={TERMS} />
}
