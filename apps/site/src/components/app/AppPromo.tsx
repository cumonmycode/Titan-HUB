/** Блок «Приложение My Titan»: телефоны с экранами, возможности, ссылки на магазины. */
import { Download, Smartphone } from 'lucide-react'
import { MY_TITAN } from '@/content/app'
import { PhoneStack } from './PhoneStack'

function StoreBadge({ store, url }: { store: 'App Store' | 'Google Play'; url: string | null }) {
  const label = <><span className="store-small">{url ? 'Скачать в' : 'Скоро в'}</span><span className="store-name">{store}</span></>
  if (url) return <a className="store-badge" href={url} target="_blank" rel="noopener noreferrer"><Download size={20} aria-hidden="true" />{label}</a>
  return <span className="store-badge is-soon" aria-disabled="true"><Smartphone size={20} aria-hidden="true" />{label}</span>
}

export function AppPromo({ title = 'Клуб в вашем телефоне' }: { title?: string }) {
  return (
    <section className="app-promo" aria-labelledby="app-promo-title">
      <div className="app-promo-copy">
        <h2 id="app-promo-title">{title}</h2>
        <p className="lead">{MY_TITAN.name} — {MY_TITAN.lead}</p>
        <ul className="app-features">
          {MY_TITAN.features.map((f) => <li key={f.title}><h3>{f.title}</h3><p>{f.text}</p></li>)}
        </ul>
        <div className="store-badges">
          <StoreBadge store="App Store" url={MY_TITAN.appStoreUrl} />
          <StoreBadge store="Google Play" url={MY_TITAN.googlePlayUrl} />
        </div>
        <p className="app-note">{MY_TITAN.login}</p>
      </div>
      <PhoneStack />
    </section>
  )
}
