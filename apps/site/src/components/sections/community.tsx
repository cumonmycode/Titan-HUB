/** Сообщество: публикации, отзывы, команда, ценности, книги, рейтинг GoMafia, контакты. */
import Link from 'next/link'
import { ArrowUpRight, Download } from 'lucide-react'
import type { Player, PlayersPayload, StorySummary } from '@/lib/types'
import { DOCS, REVIEWS, TEAM, VALUES } from '@/content/people'
import { GOMAFIA, SITE, SOCIALS } from '@/content/site'
import { Photo } from './blocks'
import { PlayerSearch } from './PlayerSearch'

const KIND_LABEL: Record<string, string> = { tournament: 'Турнир', party: 'Вечеринка', event: 'Событие' }

export function StoriesGrid({ stories, limit }: { stories: StorySummary[]; limit?: number }) {
  const list = limit ? stories.slice(0, limit) : stories
  if (!list.length) return <p className="empty">Скоро здесь появятся новые события клуба.</p>
  return (
    <ul className="stories">
      {list.map((s) => (
        <li key={s.slug} className="story">
          <Link href={`/${s.slug}`}>
            {s.coverUrl && <Photo url={s.coverUrl} alt={s.title} sizes="(max-width: 720px) 100vw, 33vw" />}
            <div className="story-body">
              <h3>{s.title}</h3>
              <p className="story-kind">{[KIND_LABEL[s.kind] ?? 'Событие', s.stats[0] ? `${s.stats[0].value} ${s.stats[0].label}` : null].filter(Boolean).join(' · ')}</p>
              {s.tagline && <p>{s.tagline}</p>}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  )
}

export function Reviews() {
  return (
    <ul className="reviews">
      {REVIEWS.map((r) => (
        <li key={r.author} className="review">
          <blockquote><p>{r.text}</p></blockquote>
          <cite>{r.author}</cite>
        </li>
      ))}
    </ul>
  )
}

export function Team() {
  return (
    <ul className="team">
      {TEAM.map((m) => <li key={m.name} className="member"><b>{m.name}</b><span>{m.role}</span></li>)}
    </ul>
  )
}

export function Values() {
  return (
    <ul className="values">
      {VALUES.map((v) => <li key={v.title} className="value"><h3>{v.title}</h3><p>{v.text}</p></li>)}
    </ul>
  )
}

export function Docs() {
  return (
    <ul className="docs">
      {DOCS.map((d) => (
        <li key={d.href} className="doc">
          <Photo name={d.cover} alt={`Обложка: ${d.title}`} sizes="160px" />
          <div>
            <h3>{d.title}</h3>
            <p>{d.text}</p>
            <a className="btn btn-ghost btn-sm" href={d.href} download><Download size={16} aria-hidden="true" /> Скачать PDF</a>
          </div>
        </li>
      ))}
    </ul>
  )
}

/** Рейтинг резидентов клуба на GoMafia (живые данные, кэш 30 мин). */
/** Ник со ссылкой на профиль GoMafia; ссылка растянута на всю строку/карточку. */
function PlayerName({ player }: { player: Player }) {
  if (!player.id) return <>{player.nickname}</>
  return <a className="pl-link" href={GOMAFIA.player(player.id)} target="_blank" rel="noopener noreferrer">{player.nickname}</a>
}

export function Players({ data, limit = 10 }: { data: PlayersPayload; limit?: number }) {
  if (!data.players.length) {
    return <p className="empty">Рейтинг клуба — на <a href={GOMAFIA.club} target="_blank" rel="noopener noreferrer">GoMafia</a>.</p>
  }
  return (
    <div className="players">
      <table>
        <caption>Резиденты клуба по рейтингу ELO{data.total ? ` · всего ${data.total}` : ''}</caption>
        <thead><tr><th scope="col">#</th><th scope="col">Игрок</th><th scope="col">ELO</th><th scope="col">Турниров</th></tr></thead>
        <tbody>
          {data.players.slice(0, limit).map((p, i) => (
            <tr key={p.nickname}>
              <td className="pl-rank">{i + 1}</td>
              <td className="pl-name">{p.avatar ? <img src={p.avatar} alt="" width={28} height={28} loading="lazy" /> : <span className="pl-dot" aria-hidden="true" />}<PlayerName player={p} /></td>
              <td className="pl-elo">{p.elo}</td>
              <td className="pl-t">{p.tournaments ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <a className="btn btn-link" href={GOMAFIA.club} target="_blank" rel="noopener noreferrer">Весь клуб на GoMafia <ArrowUpRight size={16} aria-hidden="true" /></a>
    </div>
  )
}

export function ContactList() {
  return (
    <ul className="contact-list">
      <li><span>Адрес</span><a href={SITE.mapUrl} target="_blank" rel="noopener noreferrer">{SITE.address}</a></li>
      <li><span>Телефон и WhatsApp</span><a href={SITE.phoneHref}>{SITE.phone}</a></li>
      <li><span>Почта</span><a href={`mailto:${SITE.email}`}>{SITE.email}</a></li>
      {SOCIALS.map((s) => <li key={s.id}><span>{s.label}</span><a href={s.href} target="_blank" rel="noopener noreferrer">{s.href.replace(/^https:\/\/(www\.)?/, '')}</a></li>)}
    </ul>
  )
}

/** Рейтинг пьедесталом: тройка лидеров крупно, дальше — список. */
export function PlayersPodium({ data, limit = 10 }: { data: PlayersPayload; limit?: number }) {
  if (data.players.length < 3) return <Players data={data} limit={limit} />
  const [first, second, third] = data.players
  const rest = data.players.slice(3, limit)
  const place = (p: typeof first, n: number) => (
    <li className={`podium-place podium-${n} glass`}>
      <span className="podium-n">{n}</span>
      {p!.avatar ? <img src={p!.avatar} alt="" width={84} height={84} loading="lazy" /> : <span className="podium-dot" aria-hidden="true" />}
      <b><PlayerName player={p!} /></b>
      <span className="podium-elo">ELO {p!.elo}</span>
    </li>
  )
  return (
    <div className="podium-wrap">
      <ol className="podium">{place(second, 2)}{place(first, 1)}{place(third, 3)}</ol>
      {rest.length > 0 && (
        <ol className="podium-rest glass" start={4}>
          {rest.map((p, i) => (
            <li key={p.nickname}>
              <span className="pl-rank">{i + 4}</span>
              <span className="pl-name">{p.avatar ? <img src={p.avatar} alt="" width={28} height={28} loading="lazy" /> : <span className="pl-dot" aria-hidden="true" />}<PlayerName player={p} /></span>
              <span className="pl-elo">{p.elo}</span>
            </li>
          ))}
        </ol>
      )}
      {data.players.length > limit && <PlayerSearch players={data.players} />}
      <a className="btn btn-link" href={GOMAFIA.club} target="_blank" rel="noopener noreferrer">Весь клуб на GoMafia <ArrowUpRight size={16} aria-hidden="true" /></a>
    </div>
  )
}

/** Отзывы бегущей лентой (останавливается под курсором). Дубль для бесшовной петли скрыт от чтения. */
export function ReviewsMarquee() {
  const card = (r: (typeof REVIEWS)[number], hidden?: boolean) => (
    <li key={`${r.author}${hidden ? '-2' : ''}`} className="review glass" aria-hidden={hidden || undefined}>
      <blockquote><p>{r.text}</p></blockquote>
      <cite>{r.author}</cite>
    </li>
  )
  return (
    <div className="marquee">
      <ul className="marquee-track">
        {REVIEWS.map((r) => card(r))}
        {REVIEWS.map((r) => card(r, true))}
      </ul>
    </div>
  )
}
