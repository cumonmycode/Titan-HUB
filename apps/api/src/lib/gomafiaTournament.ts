// ─────────────────────────────────────────────────────────────────────────────
// Публичная страница турнира GoMafia (/_next/data/{buildId}/tournament/{id}.json):
// рассадка по играм и столам, судья каждого стола, схема (сколько игр в каждом туре).
// Вход не нужен. Если у турнира скрыты результаты (`is_hidden_result`), роли и баллы
// приходят пустыми, а рассадка видна.
// ─────────────────────────────────────────────────────────────────────────────

export interface TournamentScheme {
  qualifyingGames: number
  semiFinalGames: number
  finalGames: number
}

export interface TournamentSeat {
  place: number
  /** GoMafia id игрока. */
  playerId: number
  login: string
  elo: number | null
  role: string | null
  points: number | null
}

export interface TournamentTable {
  /** id стола на сайте (не совпадает с id стола в АИМ). */
  tableId: number
  number: number
  refereeId: number | null
  refereeName: string | null
  win: 'city' | 'mafia' | 'draw' | null
  seats: TournamentSeat[]
}

export interface TournamentGame {
  number: number
  stage: 'qualifying' | 'semiFinal' | 'final'
  tables: TournamentTable[]
}

export interface TournamentSeating {
  id: number
  title: string
  status: string
  dateStart: string | null
  dateEnd: string | null
  city: string | null
  mainRefereeId: number | null
  hiddenResults: boolean
  scheme: TournamentScheme
  games: TournamentGame[]
}

type Json = Record<string, unknown>

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])

function int(value: unknown): number | null {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(parsed) ? parsed : null
}

function float(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

const WINS: ReadonlySet<string> = new Set(['city', 'mafia', 'draw'])

/** Тур по номеру игры: сначала отбор, затем полуфинал, затем финал — как в схеме турнира. */
export function stageOf(gameNumber: number, scheme: TournamentScheme): TournamentGame['stage'] {
  if (gameNumber <= scheme.qualifyingGames) return 'qualifying'
  if (gameNumber <= scheme.qualifyingGames + scheme.semiFinalGames) return 'semiFinal'
  return 'final'
}

function parseSeat(raw: unknown): TournamentSeat | null {
  if (!isObject(raw)) return null
  const place = int(raw['place'])
  const playerId = int(raw['id'])
  if (place === null || playerId === null) return null
  return {
    place,
    playerId,
    login: text(raw['login']) ?? '',
    elo: float(raw['elo']),
    role: text(raw['role']),
    points: float(raw['points']),
  }
}

function parseTable(raw: unknown): TournamentTable | null {
  if (!isObject(raw)) return null
  const number = int(raw['tableNum'])
  if (number === null) return null
  const win = text(raw['win'])
  return {
    tableId: int(raw['table_id']) ?? 0,
    number,
    refereeId: int(raw['referee_id']),
    refereeName: text(raw['referee']),
    win: win && WINS.has(win) ? (win as TournamentTable['win']) : null,
    seats: list(raw['table'])
      .map(parseSeat)
      .filter((seat): seat is TournamentSeat => seat !== null)
      .sort((a, b) => a.place - b.place),
  }
}

/** null — это не страница турнира (сайт вернул что-то другое или турнира нет). */
export function parseTournamentSeating(serverData: unknown): TournamentSeating | null {
  if (!isObject(serverData) || !isObject(serverData['tournament'])) return null
  const tournament = serverData['tournament']
  const id = int(tournament['id'])
  if (id === null) return null
  const rawScheme = isObject(serverData['scheme']) ? serverData['scheme'] : {}
  const scheme: TournamentScheme = {
    qualifyingGames: int(rawScheme['number_of_games_qualifying']) ?? 0,
    semiFinalGames: int(rawScheme['number_of_games_semi_final']) ?? 0,
    finalGames: int(rawScheme['number_of_games_final']) ?? 0,
  }
  const games = list(serverData['games'])
    .filter(isObject)
    .map((game): TournamentGame | null => {
      const number = int(game['gameNum'])
      if (number === null) return null
      return {
        number,
        stage: stageOf(number, scheme),
        tables: list(game['game'])
          .map(parseTable)
          .filter((table): table is TournamentTable => table !== null)
          .sort((a, b) => a.number - b.number),
      }
    })
    .filter((game): game is TournamentGame => game !== null)
    .sort((a, b) => a.number - b.number)

  return {
    id,
    title: text(tournament['title']) ?? '',
    status: text(tournament['status']) ?? 'unknown',
    dateStart: text(tournament['date_start']),
    dateEnd: text(tournament['date_end']),
    city: text(tournament['city_translate']) ?? text(tournament['city']),
    mainRefereeId: int(tournament['main_referee_id']),
    hiddenResults: String(tournament['is_hidden_result'] ?? '0') === '1',
    scheme,
    games,
  }
}
