import { LEGAL_UPDATED, OPERATOR_DETAILS, type LegalSection } from '@/content/legal'
import { PageHead } from './blocks'

export function Legal({ title, lead, sections }: { title: string; lead: string; sections: LegalSection[] }) {
  return (
    <>
      <PageHead title={title} lead={lead} />
      <section className="sec">
        <div className="prose legal">
          {sections.map((s) => (
            <div key={s.title}>
              <h2>{s.title}</h2>
              {s.paragraphs.map((p) => <p key={p.slice(0, 40)}>{p}</p>)}
            </div>
          ))}
          {OPERATOR_DETAILS && <p className="legal-meta">{OPERATOR_DETAILS}</p>}
          <p className="legal-meta">Редакция от {LEGAL_UPDATED}</p>
        </div>
      </section>
    </>
  )
}
