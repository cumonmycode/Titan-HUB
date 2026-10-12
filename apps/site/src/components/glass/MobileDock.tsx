import { Phone } from 'lucide-react'
import { RequestButton } from '@/components/request/RequestButton'

/** Нижняя стеклянная панель на телефоне: позвонить и записаться — всегда под пальцем. */
export function MobileDock({ ctaLabel, phone, phoneHref }: { ctaLabel: string; phone: string; phoneHref: string }) {
  return (
    <div className="g-dock glass" role="navigation" aria-label="Быстрые действия">
      <a className="g-dock-call" href={phoneHref} aria-label={`Позвонить: ${phone}`}><Phone size={20} /></a>
      <RequestButton preset={{ kind: 'game' }} className="btn btn-primary g-dock-cta">{ctaLabel}</RequestButton>
    </div>
  )
}
