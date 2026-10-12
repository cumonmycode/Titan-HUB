'use client'
/** Поиск себя в рейтинге клуба: место, ELO и ссылка на профиль GoMafia. */
import { useId, useMemo, useState } from 'react'
import { ArrowUpRight, Search } from 'lucide-react'
import { GOMAFIA } from '@/content/site'
import type { Player } from '@/lib/types'

const MAX_RESULTS = 6

export function PlayerSearch({ players }: { players: Player[] }) {
  const id = useId()
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const found = useMemo(
    () => (q ? players.map((p, i) => ({ p, rank: i + 1 })).filter(({ p }) => p.nickname.toLowerCase().includes(q)).slice(0, MAX_RESULTS) : []),
    [players, q],
  )

  return (
    <div className="pl-search glass">
      <label htmlFor={id} className="pl-search-label">Найдите себя в рейтинге клуба</label>
      <div className="pl-search-field">
        <Search size={18} aria-hidden="true" />
        <input id={id} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Ник на GoMafia" autoComplete="off" spellCheck={false} />
      </div>
      {q && (
        <ul className="pl-search-list" aria-live="polite">
          {found.length === 0 && (
            <li className="pl-search-empty">
              Среди {players.length} лучших не нашли — проверьте ник или откройте <a href={GOMAFIA.club} target="_blank" rel="noopener noreferrer">весь клуб на GoMafia</a>.
            </li>
          )}
          {found.map(({ p, rank }) => (
            <li key={p.id ?? p.nickname}>
              <span className="pl-rank">{rank}</span>
              <span className="pl-name">{p.avatar ? <img src={p.avatar} alt="" width={28} height={28} loading="lazy" /> : <span className="pl-dot" aria-hidden="true" />}{p.nickname}</span>
              <span className="pl-elo">{p.elo}</span>
              {p.id && <a className="pl-profile" href={GOMAFIA.player(p.id)} target="_blank" rel="noopener noreferrer" aria-label={`Профиль ${p.nickname} на GoMafia`}><ArrowUpRight size={16} aria-hidden="true" /></a>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
