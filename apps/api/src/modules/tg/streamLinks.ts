/**
 * Ссылки стрима (площадки для просмотра и донат) — чистые функции без БД, чтобы их можно
 * было проверять тестами. Используются tg/streams.ts и экраном площадок в HUB.
 */
export type StreamLinkKind = 'watch' | 'donate'
export interface StreamLink { kind: StreamLinkKind; label: string; url: string }

const MAX_LINKS = 6
const URL_MAX = 500

/** Только https — кнопки Telegram и так принимают лишь http(s)/tg. */
export function safeUrl(raw: string): string | null {
  try {
    const url = new URL(raw.trim())
    if (url.protocol !== 'https:' || url.username || url.password || raw.length > URL_MAX) return null
    return url.toString()
  } catch {
    return null
  }
}

export function normalizeLinks(links: StreamLink[]): StreamLink[] {
  const seen = new Set<string>()
  const out: StreamLink[] = []
  for (const l of links) {
    const url = safeUrl(l.url)
    if (!url || seen.has(url) || (l.kind !== 'watch' && l.kind !== 'donate')) continue
    seen.add(url)
    out.push({ kind: l.kind, label: String(l.label ?? '').trim().slice(0, 40) || (l.kind === 'donate' ? 'Донат' : 'Смотреть'), url })
  }
  return out.slice(0, MAX_LINKS)
}

