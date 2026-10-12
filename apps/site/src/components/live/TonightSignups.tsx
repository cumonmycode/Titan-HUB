'use client'
/**
 * Запись на сегодняшний вечер из опроса клуба в Telegram: сколько отметили «Да»
 * (с базой от владельца) и клубные ники. API пересчитывает раз в полчаса, страница
 * спрашивает так же; в фоновой вкладке — пауза. Нет опроса сегодня — блока нет.
 */
import { useEffect, useState } from 'react'

const POLL_MS = 30 * 60_000
const FACES = 4
const NAMES = 3

interface Signups { poll: boolean; evening: string | null; going: number; names: string[] }

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}

export function TonightSignups() {
  const [data, setData] = useState<Signups | null>(null)

  useEffect(() => {
    let stopped = false
    const load = async () => {
      if (document.hidden) return
      try {
        const res = await fetch('/api/site/tonight')
        if (!res.ok) return
        const next = (await res.json()) as Signups
        if (!stopped) setData(next)
      } catch {
        // Нет сети — блок просто не показывается, следующий опрос попробует снова.
      }
    }
    void load()
    const timer = window.setInterval(load, POLL_MS)
    const onVisible = () => { if (!document.hidden) void load() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stopped = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  if (!data?.poll || data.going <= 0) return null
  const shown = data.names.slice(0, NAMES)
  const rest = data.going - shown.length
  return (
    <div className="g-signups" role="status">
      {data.names.length > 0 && (
        <span className="g-signups-faces" aria-hidden="true">
          {data.names.slice(0, FACES).map((n) => <span key={n}>{n.slice(0, 1).toUpperCase()}</span>)}
        </span>
      )}
      <p>
        <b>{data.going} {plural(data.going, 'игрок', 'игрока', 'игроков')}</b> {plural(data.going, 'записался', 'записались', 'записались')} на сегодня
        {shown.length > 0 && <small>{shown.join(', ')}{rest > 0 ? ` и ещё ${rest}` : ''}</small>}
      </p>
    </div>
  )
}
