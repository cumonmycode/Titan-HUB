// ─────────────────────────────────────────────────────────────────────────────
// Разбор страниц АИМ (admin.gomafia.pro) — судейской админки GoMafia.
//
// Публичного API у АИМ нет: список турниров — HTML страницы /tournament, протокол —
// HTML из ответа `get_game_data` (params.game_data_container). Разметка генерируется
// шаблоном, поэтому хватает простого разбора тегов без DOM. Классы и поля сверены
// с /project/js/gameData.js и /project/js/crm/tournament-edit.js самой АИМ (2026-11-16).
// ─────────────────────────────────────────────────────────────────────────────

export type AimRole = 'sheriff' | 'red' | 'mafia' | 'don'
export type AimWin = 'city' | 'mafia' | 'draw'
/** Лучший ход ПУ: сколько чёрных он угадал; `guessed_wrong` — ПУ без угаданных, `no` — не ПУ. */
export type AimFirstKill = 'no' | 'guessed_wrong' | '1-ka' | '2-ka' | '3-ka'

export interface AimSeat {
  /** id места в АИМ (`data-id` карточки) — не GoMafia id игрока. */
  aimSeatId: number
  place: number
  login: string
  role: AimRole | null
  firstKill: AimFirstKill
  selfKill: boolean
  sheriffOpen: boolean
  extraPoint: number
  fine: number
  fineDiscipline: number
  /** Замена: игрок не получает баллов. */
  replacement: boolean
}

export interface AimTable {
  aimTableId: number
  number: number
  refereeName: string | null
  win: AimWin | null
  /** «Промах»: ПУ нет. АИМ ставит галочку сама и на сервер её не шлёт. */
  miss: boolean
  seats: AimSeat[]
}

export interface AimGame {
  aimGameId: number
  number: number
  /** «Отборочный тур», «Полуфинал», «Финал» — как в АИМ. */
  stage: string
  tables: AimTable[]
}

export type AimTournamentStatus =
  | 'awaiting verification'
  | 'awaiting registration'
  | 'registration open'
  | 'registration closed'
  | 'completed'
  | 'blocked'
  | 'unknown'

export interface AimTournament {
  id: number
  title: string
  dateStart: string | null
  dateEnd: string | null
  city: string | null
  mainReferee: string | null
  status: AimTournamentStatus
}

// ─── Токены HTML ─────────────────────────────────────────────────────────────

type Token =
  | { kind: 'open'; name: string; attrs: Map<string, string> }
  | { kind: 'close'; name: string }
  | { kind: 'text'; text: string }

const TAG = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*\/?>/g
const ATTR = /([^\s=>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === '#') {
      const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole
    }
    return ENTITIES[name.toLowerCase()] ?? whole
  })
}

function* tokenize(html: string): Generator<Token> {
  let last = 0
  for (const match of html.matchAll(TAG)) {
    const start = match.index ?? 0
    if (start < last) continue // внутри пропущенного <script>/<style>
    if (start > last) {
      const text = decodeEntities(html.slice(last, start)).replace(/\s+/g, ' ').trim()
      if (text) yield { kind: 'text', text }
    }
    last = start + match[0].length
    if (!match[2]) continue // комментарий
    const name = match[2].toLowerCase()
    if (match[1]) {
      yield { kind: 'close', name }
      continue
    }
    const attrs = new Map<string, string>()
    for (const attr of (match[3] ?? '').matchAll(ATTR)) {
      attrs.set(attr[1]!.toLowerCase(), decodeEntities(attr[2] ?? attr[3] ?? attr[4] ?? ''))
    }
    yield { kind: 'open', name, attrs }
    // Внутри скриптов и стилей нет разметки, которая нам нужна.
    if (name === 'script' || name === 'style') {
      const end = html.indexOf(`</${name}`, last)
      last = end < 0 ? html.length : end
    }
  }
  if (last < html.length) {
    const text = decodeEntities(html.slice(last)).replace(/\s+/g, ' ').trim()
    if (text) yield { kind: 'text', text }
  }
}

const classes = (attrs: Map<string, string>): Set<string> => new Set((attrs.get('class') ?? '').split(/\s+/).filter(Boolean))

function decimalValue(value: string | undefined): number {
  const parsed = Number((value ?? '').replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : 0
}

function integer(value: string | undefined): number | null {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) ? parsed : null
}

// ─── Протокол: get_game_data ─────────────────────────────────────────────────

const ROLES: ReadonlySet<string> = new Set(['sheriff', 'red', 'mafia', 'don'])
const WINS: ReadonlySet<string> = new Set(['city', 'mafia', 'draw'])
const BEST_MOVES: ReadonlySet<string> = new Set(['1-ka', '2-ka', '3-ka'])

interface Row {
  id: number
  texts: string[]
  kind: 'unknown' | 'game' | 'table'
}

interface SeatDraft extends Omit<AimSeat, 'firstKill'> {
  firstKillChecked: boolean
  bestMove: AimFirstKill | null
}

function newSeat(attrs: Map<string, string>, place: number): SeatDraft {
  return {
    aimSeatId: integer(attrs.get('data-id')) ?? 0,
    place,
    login: '',
    role: null,
    firstKillChecked: false,
    bestMove: null,
    selfKill: false,
    sheriffOpen: false,
    extraPoint: 0,
    fine: 0,
    fineDiscipline: 0,
    replacement: false,
  }
}

/** Поля карточки места. true — тег относился к карточке. */
function applySeatTag(seat: SeatDraft, cls: Set<string>, attrs: Map<string, string>): 'header' | boolean {
  if (cls.has('game-data-user-user')) {
    seat.replacement = cls.has('replacement')
    return 'header'
  }
  if (cls.has('game-data-user-role')) {
    const role = attrs.get('data-value') ?? ''
    if (cls.has('active') && ROLES.has(role)) seat.role = role as AimRole
  } else if (cls.has('game-data-user-first-kill-checkbox')) {
    seat.firstKillChecked = attrs.has('checked')
  } else if (cls.has('game-data-user-self-kill-checkbox')) {
    seat.selfKill = attrs.has('checked')
  } else if (cls.has('game-data-user-first-kill-value')) {
    const value = attrs.get('data-value') ?? ''
    if (cls.has('active') && BEST_MOVES.has(value)) seat.bestMove = value as AimFirstKill
  } else if (cls.has('game-data-user-sheriff-open-checkbox')) {
    seat.sheriffOpen = attrs.has('checked')
  } else if (cls.has('game-data-user-extra-point')) {
    seat.extraPoint = decimalValue(attrs.get('value'))
  } else if (cls.has('game-data-user-fine-discipline')) {
    seat.fineDiscipline = decimalValue(attrs.get('value'))
  } else if (cls.has('game-data-user-fine')) {
    seat.fine = decimalValue(attrs.get('value'))
  } else {
    return false
  }
  return true
}

/**
 * Игры, столы и карточки мест из `params.game_data_container`.
 *
 * Строки с `value` бывают двух видов: игра (номер, тур) и стол внутри неё (номер, судья).
 * Порядок в разметке — игра, затем её столы, у каждого стола 10 карточек. Поэтому строка,
 * за которой сразу идут карточки, — стол, а строка, за которой идёт другая строка, — игра.
 */
export function parseGameData(html: string): AimGame[] {
  const games: AimGame[] = []
  let row: Row | null = null
  let collectingRow = false
  // Присваиваются и в замыканиях ниже — без `as` TypeScript сузил бы их до null.
  let table = null as AimTable | null
  let seat = null as SeatDraft | null
  let expectHeader = false

  const finishSeat = () => {
    if (seat && table) {
      const { firstKillChecked, bestMove, ...rest } = seat
      table.seats.push({ ...rest, firstKill: firstKillChecked ? (bestMove ?? 'guessed_wrong') : 'no' })
    }
    seat = null
    expectHeader = false
  }

  const startGame = (source: Row) => {
    source.kind = 'game'
    games.push({ aimGameId: source.id, number: integer(source.texts[0]) ?? games.length + 1, stage: source.texts[1] ?? '', tables: [] })
  }

  const startTable = (source: Row) => {
    source.kind = 'table'
    if (games.length === 0) games.push({ aimGameId: 0, number: 1, stage: '', tables: [] })
    const game = games.at(-1)!
    table = {
      aimTableId: source.id,
      number: integer(source.texts[0]) ?? game.tables.length + 1,
      refereeName: source.texts.slice(1).join(' ').trim() || null,
      win: null,
      miss: false,
      seats: [],
    }
    game.tables.push(table)
  }

  for (const token of tokenize(html)) {
    if (token.kind === 'close') continue
    if (token.kind === 'text') {
      if (expectHeader && seat) {
        const header = /^(\d+)\s+(.*)$/.exec(token.text)
        const current: SeatDraft = seat
        current.place = integer(header?.[1]) ?? current.place
        current.login = (header?.[2] ?? token.text).trim()
        expectHeader = false
      } else if (collectingRow && row) {
        row.texts.push(token.text)
      }
      continue
    }

    const { name, attrs } = token
    const cls = classes(attrs)

    if (name === 'tr') {
      collectingRow = false
      const id = integer(attrs.get('value'))
      if (id === null) continue
      finishSeat()
      if (row && row.kind === 'unknown') startGame(row)
      row = { id, texts: [], kind: 'unknown' }
      collectingRow = true
      continue
    }

    if (cls.has('game-data-user')) {
      collectingRow = false
      finishSeat()
      if (row && row.kind === 'unknown') startTable(row)
      const currentTable: AimTable | null = table
      if (currentTable) seat = newSeat(attrs, currentTable.seats.length + 1)
      continue
    }

    if (seat && applySeatTag(seat, cls, attrs) === 'header') {
      expectHeader = true
      continue
    }

    const currentTable: AimTable | null = table
    if (!currentTable) continue
    if (cls.has('game-data-win')) {
      finishSeat()
      const win = attrs.get('data-value') ?? ''
      if (cls.has('active') && WINS.has(win)) currentTable.win = win as AimWin
    } else if (cls.has('game-data-miss')) {
      finishSeat()
      currentTable.miss = attrs.has('checked')
    }
  }
  finishSeat()
  if (row && row.kind === 'unknown') startGame(row)
  return games
}

// ─── Список турниров: /tournament ────────────────────────────────────────────

const STATUS_BY_TITLE: ReadonlyArray<[string, AimTournamentStatus]> = [
  ['ожидает проверки', 'awaiting verification'],
  ['ожидает регистрации', 'awaiting registration'],
  ['регистрация открыта', 'registration open'],
  ['регистрация закрыта', 'registration closed'],
  ['завершён', 'completed'],
  ['завершен', 'completed'],
  ['заблокирован', 'blocked'],
]
const STATUS_CODES: ReadonlySet<string> = new Set(STATUS_BY_TITLE.map(([, code]) => code))

function statusFrom(selected: string | null, text: string): AimTournamentStatus {
  if (selected && STATUS_CODES.has(selected)) return selected as AimTournamentStatus
  const title = text.trim().toLowerCase()
  return STATUS_BY_TITLE.find(([name]) => title.startsWith(name))?.[1] ?? 'unknown'
}

/** dd.mm.yyyy → yyyy-mm-dd. */
function isoDate(text: string): string | null {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(text.trim())
  return match ? `${match[3]}-${match[2]}-${match[1]}` : null
}

interface Cell {
  texts: string[]
  selected: string | null
}

interface ListRow {
  id: number
  cells: Cell[]
}

/** Заголовки таблицы и строки с `value` (id турнира). Текст вариантов выпадающего списка не попадает в ячейку. */
function readListTable(html: string): { headers: string[]; rows: ListRow[] } {
  const headers: string[] = []
  const rows: ListRow[] = []
  let inHead = false
  let headerCell = false
  let current: ListRow | null = null
  let cell: Cell | null = null
  let inOption = false

  for (const token of tokenize(html)) {
    if (token.kind === 'text') {
      if (inHead && headerCell) headers[headers.length - 1] = `${headers.at(-1)} ${token.text}`.trim()
      else if (cell && !inOption) cell.texts.push(token.text)
      continue
    }
    if (token.kind === 'close') {
      if (token.name === 'thead') inHead = false
      else if (token.name === 'option') inOption = false
      else if (token.name === 'td' || token.name === 'th') headerCell = false
      continue
    }
    const { name, attrs } = token
    if (name === 'thead') {
      inHead = true
      headers.length = 0
    } else if ((name === 'td' || name === 'th') && inHead) {
      headers.push('')
      headerCell = true
    } else if (name === 'tr' && !inHead) {
      const id = integer(attrs.get('value'))
      current = id === null ? null : { id, cells: [] }
      if (current) rows.push(current)
      cell = null
    } else if (name === 'td' && current) {
      cell = { texts: [], selected: null }
      current.cells.push(cell)
    } else if (name === 'option' && cell) {
      inOption = true
      if (attrs.has('selected')) cell.selected = attrs.get('value') ?? null
    }
  }
  return { headers, rows }
}

/**
 * Турниры пользователя из таблицы /tournament. Столбцы находятся по заголовкам, а не по
 * номерам: у админа и у судьи набор столбцов может отличаться. Статус у админа — выпадающий
 * список (берётся выбранный вариант), у судьи — текст.
 */
export function parseTournamentList(html: string): AimTournament[] {
  const { headers, rows } = readListTable(html)
  const column = (title: string) => headers.findIndex((header) => header.toLowerCase() === title)
  const cellText = (row: ListRow, index: number) =>
    index >= 0 ? (row.cells[index]?.texts.join(' ').replace(/\s+/g, ' ').trim() ?? '') : ''
  const columns = {
    title: column('название'),
    start: column('дата начала'),
    end: column('дата окончания'),
    city: column('город'),
    referee: column('гс'),
    status: column('статус'),
  }
  return rows.map((row) => ({
    id: row.id,
    title: cellText(row, columns.title),
    dateStart: isoDate(cellText(row, columns.start)),
    dateEnd: isoDate(cellText(row, columns.end)),
    city: cellText(row, columns.city) || null,
    mainReferee: cellText(row, columns.referee) || null,
    status: statusFrom(columns.status >= 0 ? (row.cells[columns.status]?.selected ?? null) : null, cellText(row, columns.status)),
  }))
}

// ─── Сохранение протокола: save_game_result ──────────────────────────────────

export interface AimProtocol {
  win: AimWin
  seats: Array<Omit<AimSeat, 'place' | 'login'>>
}

function decimalField(value: number): string {
  return (Math.round(value * 100) / 100).toString()
}

/** Поля формы точно как у getGameData() в gameData.js АИМ. Без csrf_token — его добавляет клиент. */
export function saveProtocolFields(tournamentId: number, aimTableId: number, protocol: AimProtocol): Array<[string, string]> {
  const fields: Array<[string, string]> = [
    ['win', protocol.win],
    ['view_sc', '0'],
  ]
  protocol.seats.forEach((seat, index) => {
    const key = `user[${index}]`
    fields.push(
      [`${key}[id]`, String(seat.aimSeatId)],
      [`${key}[role]`, seat.role ?? 'red'],
      [`${key}[first_kill]`, seat.firstKill],
      [`${key}[self_kill]`, seat.selfKill ? '1' : '0'],
      [`${key}[sheriff_open]`, seat.sheriffOpen ? '1' : '0'],
      [`${key}[extra_point]`, decimalField(seat.extraPoint)],
      [`${key}[fine]`, decimalField(seat.fine)],
      [`${key}[fine_discipline]`, decimalField(seat.fineDiscipline)],
      [`${key}[replacement]`, seat.replacement ? '1' : '0'],
    )
  })
  fields.push(['action', 'save_game_result'], ['id', String(tournamentId)], ['table_id', String(aimTableId)])
  return fields
}
