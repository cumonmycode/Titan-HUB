/** Блок «Приложение My Titan»: телефоны с экранами, возможности, ссылки на загрузку. */
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { MY_TITAN } from '@/content/app'
import { PhoneStack } from './PhoneStack'

function AppleGlyph() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M16.37 12.62c-.03-2.6 2.12-3.85 2.22-3.91-1.21-1.77-3.09-2.01-3.76-2.04-1.6-.16-3.12.94-3.93.94-.81 0-2.06-.92-3.39-.89-1.74.03-3.35 1.01-4.25 2.57-1.81 3.14-.46 7.79 1.3 10.34.86 1.25 1.89 2.65 3.24 2.6 1.3-.05 1.79-.84 3.36-.84 1.57 0 2.01.84 3.38.81 1.4-.02 2.29-1.27 3.14-2.52.99-1.45 1.4-2.85 1.42-2.92-.03-.01-2.72-1.04-2.73-4.14ZM13.79 4.98c.72-.87 1.2-2.07 1.07-3.27-1.03.04-2.28.69-3.02 1.55-.66.77-1.24 1.99-1.09 3.17 1.15.09 2.32-.58 3.04-1.45Z" />
    </svg>
  )
}

function AndroidGlyph() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17.6 9.48 19.44 6.3a.38.38 0 0 0-.66-.38l-1.87 3.23A11.4 11.4 0 0 0 12 8.12c-1.77 0-3.42.37-4.91 1.03L5.22 5.92a.38.38 0 0 0-.66.38L6.4 9.48C3.24 11.2 1.08 14.4.75 18.13h22.5c-.33-3.73-2.49-6.93-5.65-8.65ZM7 15.25a1.12 1.12 0 1 1 0-2.25 1.12 1.12 0 0 1 0 2.25Zm10 0a1.12 1.12 0 1 1 0-2.25 1.12 1.12 0 0 1 0 2.25Z" />
    </svg>
  )
}

/** Кнопки загрузки: App Store и APK с сайта (через /app/android — всегда последняя версия). */
export function StoreBadges({ androidVersion }: { androidVersion?: string | null }) {
  return (
    <div className="store-badges">
      <a className="store-badge" href={MY_TITAN.appStoreUrl} target="_blank" rel="noopener noreferrer">
        <AppleGlyph />
        <span className="store-small">Загрузите в</span>
        <span className="store-name">App Store</span>
      </a>
      <a className="store-badge" href={MY_TITAN.androidUrl} download>
        <AndroidGlyph />
        <span className="store-small">{androidVersion ? `Версия ${androidVersion} · APK` : 'Файл APK с сайта'}</span>
        <span className="store-name">Для Android</span>
      </a>
    </div>
  )
}

export function AppPromo({ title = 'Клуб в вашем телефоне', more = true }: { title?: string; more?: boolean }) {
  return (
    <section className="app-promo" aria-labelledby="app-promo-title">
      <div className="app-promo-copy">
        <h2 id="app-promo-title">{title}</h2>
        <p className="lead">{MY_TITAN.name} — {MY_TITAN.lead}</p>
        <ul className="app-features">
          {MY_TITAN.features.map((f) => <li key={f.title}><h3>{f.title}</h3><p>{f.text}</p></li>)}
        </ul>
        <StoreBadges />
        <p className="app-note">{MY_TITAN.login}</p>
        {more && <p className="app-more"><Link href="/app" className="btn btn-ghost glass">Подробнее о приложении <ArrowRight size={16} aria-hidden="true" /></Link></p>}
      </div>
      <PhoneStack />
    </section>
  )
}
