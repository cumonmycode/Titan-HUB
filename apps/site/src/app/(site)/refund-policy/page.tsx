import type { Metadata } from 'next'
import { REFUND } from '@/content/legal'
import { Legal } from '@/components/sections/Legal'

export const metadata: Metadata = { title: 'Отмена и возврат' }

export default function RefundPage() {
  return <Legal title="Отмена и возврат" lead="Как перенести или отменить запись, мероприятие и сертификат." sections={REFUND} />
}
