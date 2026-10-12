/** Базовые блоки страниц: заголовок страницы, призыв, шаги, вопросы, цифры, фото. */
import type { ReactNode } from 'react'
import type { RequestPreset, StoryStat } from '@/lib/types'
import { media, photo } from '@/lib/format'
import { RequestButton } from '@/components/request/RequestButton'

export function Photo({ name, url, alt, className, eager, sizes }: { name?: string; url?: string; alt: string; className?: string; eager?: boolean; sizes?: string }) {
  const p = name ? media(name) : photo(url ?? '')
  return (
    <img
      className={className} src={p.src} srcSet={p.srcSet} sizes={p.srcSet ? (sizes ?? '(max-width: 720px) 100vw, 50vw') : undefined}
      alt={alt} loading={eager ? 'eager' : 'lazy'} decoding="async" fetchPriority={eager ? 'high' : undefined}
    />
  )
}

export function PageHead({ title, lead, photoName, photoUrl, actions, aside }: {
  title: ReactNode; lead?: ReactNode; photoName?: string; photoUrl?: string; actions?: ReactNode; aside?: ReactNode
}) {
  const hasMedia = Boolean(photoName || photoUrl || aside)
  return (
    <section className={`page-head${hasMedia ? ' has-media' : ''}`}>
      <div className="page-head-copy">
        <h1>{title}</h1>
        {lead && <p className="lead">{lead}</p>}
        {actions && <div className="actions">{actions}</div>}
      </div>
      {aside ?? ((photoName || photoUrl) && (
        <figure className="page-head-media"><Photo name={photoName} url={photoUrl} alt="" eager /></figure>
      ))}
    </section>
  )
}

export function Section({ title, lead, id, className, children }: { title?: ReactNode; lead?: ReactNode; id?: string; className?: string; children: ReactNode }) {
  return (
    <section className={`sec${className ? ` ${className}` : ''}`} id={id}>
      {(title || lead) && (
        <div className="sec-head">
          {title && <h2>{title}</h2>}
          {lead && <p className="sec-lead">{lead}</p>}
        </div>
      )}
      {children}
    </section>
  )
}

export function CtaBand({ title, text, preset, label, secondary }: { title: ReactNode; text?: ReactNode; preset: RequestPreset; label: string; secondary?: ReactNode }) {
  return (
    <section className="cta-band">
      <div>
        <h2>{title}</h2>
        {text && <p>{text}</p>}
      </div>
      <div className="actions">
        <RequestButton preset={preset} className="btn btn-primary btn-lg">{label}</RequestButton>
        {secondary}
      </div>
    </section>
  )
}

export function Steps({ items }: { items: { title: string; text: string }[] }) {
  return (
    <ol className="steps">
      {items.map((s) => <li key={s.title}><h3>{s.title}</h3><p>{s.text}</p></li>)}
    </ol>
  )
}

export function Faq({ items }: { items: { q: string; a: ReactNode }[] }) {
  return (
    <div className="faq">
      {items.map((f) => (
        <details key={f.q}>
          <summary>{f.q}</summary>
          <div className="faq-a">{f.a}</div>
        </details>
      ))}
    </div>
  )
}

export function Stats({ items }: { items: StoryStat[] }) {
  return (
    <dl className="stats">
      {items.map((s) => <div key={s.label} className="stat"><dt>{s.label}</dt><dd>{s.value}</dd></div>)}
    </dl>
  )
}

export function Gallery({ photos, title }: { photos: string[]; title: string }) {
  if (!photos.length) return null
  return (
    <div className="gallery">
      {photos.map((u, i) => <figure key={u}><Photo url={u} alt={`${title} — фото ${i + 1}`} sizes="(max-width: 720px) 100vw, 33vw" /></figure>)}
    </div>
  )
}
