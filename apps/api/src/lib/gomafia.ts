// ─────────────────────────────────────────────────────────────────────────────
// Клиент GoMafia.pro — сопоставление игроков клуба и поиск по всем игрокам сайта.
//
// API сайта (реверс-инжиниринг, всё подтверждено):
//  • POST /api/user/login   {login,password}            → вход (sessionToken)
//  • POST /api/user/logout  {sessionToken}
//  • POST /api/user/getTop  {search,limit,offset,sortType,sortOrder,...}
//        → {result:'success', data:[{id,login,elo,avatar_link,title,...}]}  (ПУБЛИЧНО)
//  • GET  /_next/data/{buildId}/club/{id}.json?page=N
//        → serverData.{club, residents[], residentsTotal}                   (ПУБЛИЧНО)
//  • GET  /_next/data/{buildId}/stats/{id}.json
//        → serverData.user{first_name,last_name,login,club_id,elo,avatar}   (ПУБЛИЧНО)
//
// Поиск/составы/карточки игроков — ПУБЛИЧНЫ (вход не нужен). Логин нужен лишь
// чтобы при подключении подтвердить владельца и определить id его клуба.
// ─────────────────────────────────────────────────────────────────────────────

const BASE = 'https://gomafia.pro'
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
const TIMEOUT_MS = 12000

// buildId меняется при каждом деплое gomafia → кэшируем коротко и обновляем при 404.
let buildIdCache: { id: string; at: number } | null = null
const BUILDID_TTL_MS = 10 * 60 * 1000

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: ctrl.signal, headers: { 'User-Agent': UA, ...(init?.headers ?? {}) } })
  } finally {
    clearTimeout(t)
  }
}

async function getBuildId(force = false): Promise<string | null> {
  if (!force && buildIdCache && Date.now() - buildIdCache.at < BUILDID_TTL_MS) return buildIdCache.id
  try {
    const r = await fetchWithTimeout(`${BASE}/`)
    const html = await r.text()
    const m = html.match(/"buildId":"([^"]+)"/)
    if (m?.[1]) {
      buildIdCache = { id: m[1], at: Date.now() }
      return m[1]
    }
  } catch {
    /* сеть недоступна — вернём текущий кэш ниже */
  }
  return buildIdCache?.id ?? null
}

// ─── Вход (с 2026-11-17 GoMafia отдаёт профили, клубы, турниры и поиск только после входа) ──
//
// Сайт хранит сессию в своей cookie (её шифрует сам сайт): вход — POST /api/user/login, cookie
// из ответа уходит во все следующие запросы. Вызовы с `auth` получают GomafiaAuthRequired, если
// сайт просит войти (сессии нет или она истекла); без `auth` — как раньше, пустой результат.

export interface GomafiaAuth {
  /** Cookie сессии GoMafia; null — входа нет. */
  cookie: string | null
}

export class GomafiaAuthRequired extends Error {
  constructor() {
    super('gomafia_need_auth')
  }
}

function authHeaders(auth?: GomafiaAuth): Record<string, string> {
  return auth?.cookie ? { Cookie: auth.cookie } : {}
}

/** Cookie из Set-Cookie ответа в виде заголовка Cookie (без атрибутов). */
function cookieHeader(response: Response): string | null {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] }
  const all = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [response.headers.get('set-cookie') ?? '']
  const pairs = all.map((line) => line.split(';')[0]?.trim() ?? '').filter((pair) => pair.includes('=') && !pair.endsWith('=deleted'))
  return pairs.length ? pairs.join('; ') : null
}

// POST /api/{action}. Возвращает распарсенный JSON или {result:'fail'} при ошибке.
async function apiPost(action: string, body: Record<string, unknown>, auth?: GomafiaAuth): Promise<any> {
  let res: any
  try {
    const r = await fetchWithTimeout(`${BASE}/api/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: BASE, Referer: `${BASE}/`, ...authHeaders(auth) },
      body: JSON.stringify(body),
    })
    res = await r.json().catch(() => ({ result: 'fail', error: 'bad_json' }))
  } catch {
    return { result: 'fail', error: 'network' }
  }
  if (auth && res?.error === 'need_auth') throw new GomafiaAuthRequired()
  return res
}

// GET /_next/data/{buildId}/{path}. При 404 (сменился buildId) — один повтор со свежим.
async function nextData(path: string, auth?: GomafiaAuth): Promise<any | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const bid = await getBuildId(attempt === 1)
    if (!bid) return null
    try {
      const r = await fetchWithTimeout(`${BASE}/_next/data/${bid}/${path}`, { headers: { 'x-nextjs-data': '1', ...authHeaders(auth) } })
      if (r.status === 404) { buildIdCache = null; continue } // buildId устарел → повтор
      if (!r.ok) return null
      const j = (await r.json().catch(() => null)) as any
      // Страница только для вошедших: сайт отвечает переходом на /login.
      if (auth && typeof j?.pageProps?.__N_REDIRECT === 'string' && j.pageProps.__N_REDIRECT.startsWith('/login')) {
        throw new GomafiaAuthRequired()
      }
      return j?.pageProps?.serverData ?? null
    } catch (error) {
      if (error instanceof GomafiaAuthRequired) throw error
      return null
    }
  }
  return null
}

// ─── Нормализация ────────────────────────────────────────────────────────────

export interface GomafiaPlayer {
  gomafiaId: string
  login: string
  fullName: string | null
  firstName: string | null
  lastName: string | null
  elo: number | null
  avatar: string | null
  clubId: string | null
  clubTitle: string | null
  city: string | null
  tournaments: number | null
}

function num(v: unknown): number | null {
  const n = parseFloat(String(v ?? ''))
  return Number.isFinite(n) ? n : null
}

function normalize(raw: any): GomafiaPlayer | null {
  if (!raw || raw.id == null) return null
  const first = raw.first_name ?? null
  const last = raw.last_name ?? null
  const full = [first, last].filter(Boolean).join(' ').trim() || null
  return {
    gomafiaId: String(raw.id),
    login: raw.login ?? '',
    fullName: full,
    firstName: first,
    lastName: last,
    elo: num(raw.elo),
    avatar: raw.avatar_link ?? null,
    clubId: raw.club_id != null ? String(raw.club_id) : null,
    clubTitle: raw.title ?? raw.club_title ?? null,
    city: raw.city ?? null,
    tournaments: raw.tournaments_played != null ? num(raw.tournaments_played) : null,
  }
}

// ─── Публичные операции ──────────────────────────────────────────────────────

// Поиск по ВСЕМ игрокам сайта (подстрочно по нику). Публично.
export async function searchPlayers(query: string, opts: { limit?: number; offset?: number } = {}, auth?: GomafiaAuth): Promise<{ players: GomafiaPlayer[]; total: number }> {
  const q = query.trim()
  if (!q) return { players: [], total: 0 }
  const res = await apiPost('user/getTop', {
    search: q,
    limit: opts.limit ?? 20,
    offset: opts.offset ?? 0,
    sortType: 'elo',
    sortOrder: 'DESC',
  }, auth)
  if (res?.result !== 'success' || !Array.isArray(res.data)) return { players: [], total: 0 }
  const players = res.data.map(normalize).filter(Boolean) as GomafiaPlayer[]
  const total = res.data[0]?.total_rows != null ? Number(res.data[0].total_rows) : players.length
  return { players, total }
}

/** `president_id` клуба: строка с номером игрока; пусто или «0» — президента нет. */
function presidentId(raw: unknown): string | null {
  const id = String(raw ?? '').trim()
  return /^[1-9]\d*$/.test(id) ? id : null
}

// Состав клуба по id (представители). Постранично; `club.president_id` — президент клуба.
/** Клуб GoMafia. `presidentId` — id игрока-президента (null — у клуба его нет). */
export interface GomafiaClub {
  id: string
  title: string | null
  city: string | null
  description: string | null
  rank: number | null
  presidentId: string | null
}

export async function clubResidents(clubId: string, opts: { page?: number } = {}, auth?: GomafiaAuth): Promise<{ club: GomafiaClub | null; residents: GomafiaPlayer[]; total: number }> {
  const sd = await nextData(`club/${encodeURIComponent(clubId)}.json?page=${opts.page ?? 1}`, auth)
  if (!sd) return { club: null, residents: [], total: 0 }
  const club = sd.club
    ? {
        id: String(sd.club.id ?? clubId),
        title: sd.club.title ?? null,
        city: sd.club.city ?? null,
        description: sd.club.description ?? null,
        rank: num(sd.club.rank),
        presidentId: presidentId(sd.club.president_id),
      }
    : null
  const residents = (Array.isArray(sd.residents) ? sd.residents : []).map(normalize).filter(Boolean) as GomafiaPlayer[]
  const total = Number(sd.residentsTotal ?? residents.length) || residents.length
  return { club, residents, total }
}

// Полная карточка игрока (с именем/фамилией). Публично.
export async function playerDetail(id: string, auth?: GomafiaAuth): Promise<GomafiaPlayer | null> {
  const sd = await nextData(`stats/${encodeURIComponent(id)}.json`, auth)
  if (!sd?.user) return null
  return normalize(sd.user)
}

// Страница турнира: рассадка, судьи столов, схема. Публично; разбор — gomafiaTournament.ts.
export async function tournamentServerData(id: number, auth?: GomafiaAuth): Promise<unknown | null> {
  return nextData(`tournament/${id}.json`, auth)
}

// ─── Вход (только для подтверждения владельца и определения его клуба) ─────────

export interface GomafiaLoginResult {
  ok: boolean
  error?: string
  sessionToken?: string
  userId?: string
  clubId?: string | null
  /** Cookie сессии сайта — для запросов, которые GoMafia отдаёт только после входа. */
  cookie?: string | null
}

// Логин. Возвращает sessionToken (+ id пользователя/клуба, если отдаёт API).
// Парсим защитно — точную форму ответа знаем неполно (поле sessionToken
// подтверждено по logout). При неуспехе — текст ошибки от сайта.
export async function gomafiaLogin(login: string, password: string): Promise<GomafiaLoginResult> {
  let res: any
  let cookie: string | null = null
  try {
    const r = await fetchWithTimeout(`${BASE}/api/user/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: BASE, Referer: `${BASE}/login` },
      body: JSON.stringify({ login, password }),
    })
    cookie = cookieHeader(r)
    res = await r.json().catch(() => ({ result: 'fail', error: 'bad_json' }))
  } catch {
    res = { result: 'fail', error: 'network' }
  }
  if (res?.result !== 'success') {
    return { ok: false, error: res?.errorDesc ?? res?.error ?? 'login_failed' }
  }
  const u = res.user ?? res.data ?? res
  const sessionToken = res.sessionToken ?? u?.sessionToken ?? res.data?.sessionToken
  const userId = u?.id != null ? String(u.id) : res.id != null ? String(res.id) : undefined
  const clubId = u?.club_id != null ? String(u.club_id) : undefined
  if (!userId) {
    // Только имена полей, без значений: в ответе есть sessionToken.
    console.warn('[gomafia] вход без id игрока, поля ответа:', Object.keys(res ?? {}), u && u !== res ? Object.keys(u) : [])
  }
  if (!cookie) console.warn('[gomafia] вход без cookie сессии — закрытые страницы GoMafia будут недоступны')
  return { ok: true, sessionToken, userId, clubId: clubId ?? null, cookie }
}

// Извлечь club id из ссылки/строки: «https://gomafia.pro/club/49», «club/49», «49».
export function parseClubId(input: string): string | null {
  const s = input.trim()
  if (!s) return null
  const m = s.match(/club\/(\d+)/) ?? s.match(/^(\d+)$/)
  return m?.[1] ?? null
}
