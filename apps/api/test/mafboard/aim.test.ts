import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { AimClient, AimError, AimSession, mergeCookies } from '../../src/lib/gomafiaAim.js'
import { parseGameData, parseTournamentList, saveProtocolFields, type AimGame } from '../../src/lib/gomafiaAimParse.js'
import { parseTournamentSeating, type TournamentSeating } from '../../src/lib/gomafiaTournament.js'
import { call, createTestContext, signIn, type TestContext } from './helpers.js'

// ─── Разметка АИМ (повторяет ответ get_game_data, ники вымышленные) ──────────

interface CardSpec {
  id: number
  place: number
  login: string
  role: 'sheriff' | 'red' | 'mafia' | 'don'
  firstKill?: '1-ka' | '2-ka' | '3-ka' | 'guessed_wrong'
  selfKill?: boolean
  sheriffOpen?: boolean
  extra?: string
  fine?: string
  fineDiscipline?: string
  replacement?: boolean
}

function card(spec: CardSpec): string {
  const role = (value: string, title: string) =>
    `<div data-value="${value}" class="user-card__type-item game-data-user-role${spec.role === value ? ' active' : ''}">${title}</div>`
  const checked = (on: boolean | undefined) => (on ? ' checked' : '')
  const firstKillOn = spec.firstKill !== undefined
  const value = (v: string) =>
    `<div data-value="${v}" class="user-card__select-item_line game-data-user-first-kill-value${firstKillOn ? ' available' : ''}${spec.firstKill === v ? ' active' : ''}">${v.replace('-ka', '-ка')}</div>`
  const sheriffOpen = `<div class="user-card__stats"><div>Вскр. шер.</div><div class="checkbox-block"><div><input class="game-data-user-sheriff-open-checkbox" type="checkbox" id="so${spec.id}"${checked(spec.sheriffOpen)}><label for="so${spec.id}"></label></div></div></div>`
  return `<tr class="" rownumber="${spec.place - 1}"><td>
  <div class="user-card game-data-user" data-id="${spec.id}" data-block-id="block.1">
    <div class="user-card__header game-data-user-user${spec.replacement ? ' replacement' : ''}">${spec.place} ${spec.login}</div>
    <div class="user-card__type">${role('sheriff', 'Ш')}${role('red', 'К')}${role('mafia', 'М')}${role('don', 'Д')}</div>
    <div class="user-card__select">
      <div class="user-card__select-item"><div class="checkbox-block"><div><input class="game-data-user-first-kill-checkbox" type="checkbox" id="fk${spec.id}"${checked(firstKillOn)}><label for="fk${spec.id}">ПУ</label></div></div>
      <div class="checkbox-block"><div><input class="game-data-user-self-kill-checkbox" type="checkbox" id="sk${spec.id}"${checked(spec.selfKill)}><label for="sk${spec.id}">СС</label></div></div></div>
      ${value('1-ka')}${value('2-ka')}${value('3-ka')}
    </div>
    <div class="user-card__stats"><div>Доп. баллы</div><input decimal="1" min="0" max="10" step="0.1" value="${spec.extra ?? '0.0'}" class="number game-data-user-extra-point"></div>
    <div class="user-card__stats"><div>Штраф игра</div><input decimal="1" value="${spec.fine ?? '0.0'}" class="number game-data-user-fine"></div>
    <div class="user-card__stats"><div>Штраф дисц.</div><input decimal="1" value="${spec.fineDiscipline ?? '0.0'}" class="number game-data-user-fine-discipline"></div>
    ${sheriffOpen}
  </div></td></tr>`
}

function tableBlock(tableId: number, number: number, referee: string, cards: CardSpec[], win: 'city' | 'mafia' | 'draw' | null): string {
  const winButton = (value: string, title: string) =>
    `<div data-value="${value}" class="user-card-action__item game-data-win${win === value ? ' active' : ''}" data-block-id="block.1">${title}</div>`
  return `<tr class="" rownumber="0" value="${tableId}"><td class="w-10"><button class="btn no-btn open-close-sub active-action" type="button" onclick="TableData.prototype.toggleSubTable($(this), undefined)" data-row-id="rownumber-${tableId}"><i class="far fa-chevron-right"></i></button></td><td>${number}</td><td>${referee}</td></tr>
  <tr class="subtable" rownumber="1"><td class="w-10 t-a-t"></td><td colspan="2"><div id="table-data"><table class="general-table header-hide user-card-tr">
  <thead><tr><td><a>0</a></td><td><a>1</a></td></tr></thead><tbody>${cards.map(card).join('')}</tbody></table></div>
  <div class="user-card-action" data-block-id="block.1">${winButton('city', 'Победа города')}${winButton('mafia', 'Победа мафии')}${winButton('draw', 'Ничья')}
  <div class="checkbox-block"><input class="game-data-miss" type="checkbox" id="miss${tableId}"${cards.some((c) => c.firstKill) ? '' : ' checked'}><label>«Промах»</label></div>
  <button class="btn warning game-data-reset-btn m-r-x2" type="button">Очистить игру</button><div class="btn primary game-data-save-btn">Сохранить</div></div></td></tr>`
}

function gameBlock(gameId: number, number: number, stage: string, tables: string[]): string {
  return `<tr class="" rownumber="0" value="${gameId}"><td class="w-10"><button class="btn no-btn open-close-sub active-action" type="button" data-row-id="rownumber-${gameId}"></button></td><td>${number}</td><td>${stage}</td></tr>
  <tr class="subtable" rownumber="1"><td class="w-10 t-a-t"></td><td colspan="2"><div id="table-data"><table class="general-table "><tbody>${tables.join('')}</tbody></table></div></td></tr>`
}

const ROLES: CardSpec['role'][] = ['don', 'red', 'red', 'red', 'sheriff', 'mafia', 'red', 'red', 'red', 'mafia']

function cards(base: number, overrides: Record<number, Partial<CardSpec>> = {}): CardSpec[] {
  return ROLES.map((role, index) => ({ id: base + index, place: index + 1, login: `Игрок ${index + 1}`, role, ...overrides[index + 1] }))
}

const GAME_DATA_HTML = `<div class="input-block column c-1-2"><a href="/download-tournament-games/2920" target="_blank"><button class="btn secondary" type="button">Скачать игры турнира</button></a></div>
<div class="whole-table block white shadow"><div id="table-data"><table class="general-table  small"><thead><tr><td></td><td><a>Номер</a></td><td><a>Тип</a></td></tr></thead><tbody>
${gameBlock(44270, 1, 'Отборочный тур', [
  tableBlock(78520, 1, 'Судья Первый', cards(1000, { 1: { sheriffOpen: true, extra: '0.6' }, 2: { firstKill: '1-ka', fine: '0.4' }, 8: { fineDiscipline: '0.2' } }), 'mafia'),
  tableBlock(78521, 2, 'Судья Второй', cards(1010, { 3: { firstKill: 'guessed_wrong' }, 4: { replacement: true } }), 'city'),
])}
${gameBlock(44271, 2, 'Финал', [tableBlock(78530, 1, 'Судья Первый', cards(1020), null)])}
${gameBlock(44272, 3, 'Финал', [])}
</tbody></table></div></div>`

const LIST_HTML = `<table class="general-table"><thead><tr><td><a>id</a></td><td><a>Название</a></td><td><a>Дата начала</a></td><td><a>Дата окончания</a></td><td><a>Страна</a></td><td><a>Город</a></td><td><a>ГС</a></td><td><a>Статус</a></td></tr></thead><tbody>
<tr class="" rownumber="0" value="2920"><td>2920</td><td><a href="/tournament-edit/2920">ALIN &amp; CUP</a></td><td>05.04.2026</td><td>05.04.2026</td><td>Россия</td><td>Нальчик</td><td>Судья Первый</td>
<td><div class="select-progress-container"><select class="table-editable-field" name="status" objectid="2920"><option disabled value="-1">Не выбрано</option><option value="registration open" selected>Регистрация открыта</option><option value="completed">Завершён</option></select></div></td></tr>
<tr class="" rownumber="1" value="2735"><td>2735</td><td>Society Cup</td><td>06.06.2026</td><td>07.06.2026</td><td>Россия</td><td>Нальчик</td><td>Судья Второй</td><td>Завершён</td></tr>
</tbody></table>`

describe('разбор АИМ', () => {
  it('протокол: игры, столы, карточки и итог стола', () => {
    const games = parseGameData(GAME_DATA_HTML)
    assert.deepEqual(
      games.map((g) => [g.aimGameId, g.number, g.stage, g.tables.map((t) => [t.aimTableId, t.number, t.refereeName, t.win, t.miss, t.seats.length])]),
      [
        [44270, 1, 'Отборочный тур', [[78520, 1, 'Судья Первый', 'mafia', false, 10], [78521, 2, 'Судья Второй', 'city', false, 10]]],
        [44271, 2, 'Финал', [[78530, 1, 'Судья Первый', null, true, 10]]],
        [44272, 3, 'Финал', []],
      ],
    )
    const [first, second] = games[0]!.tables
    assert.deepEqual(first!.seats[0], {
      aimSeatId: 1000, place: 1, login: 'Игрок 1', role: 'don', firstKill: 'no', selfKill: false,
      sheriffOpen: true, extraPoint: 0.6, fine: 0, fineDiscipline: 0, replacement: false,
    })
    assert.equal(first!.seats[1]!.firstKill, '1-ka')
    assert.equal(first!.seats[1]!.fine, 0.4)
    assert.equal(first!.seats[7]!.fineDiscipline, 0.2)
    assert.equal(second!.seats[2]!.firstKill, 'guessed_wrong')
    assert.equal(second!.seats[3]!.replacement, true)
    assert.deepEqual(first!.seats.map((s) => s.role), ROLES)
  })

  it('список турниров: столбцы по заголовкам, статус из выпадающего списка или текста', () => {
    assert.deepEqual(parseTournamentList(LIST_HTML), [
      { id: 2920, title: 'ALIN & CUP', dateStart: '2026-04-05', dateEnd: '2026-04-05', city: 'Нальчик', mainReferee: 'Судья Первый', status: 'registration open' },
      { id: 2735, title: 'Society Cup', dateStart: '2026-06-06', dateEnd: '2026-06-07', city: 'Нальчик', mainReferee: 'Судья Второй', status: 'completed' },
    ])
  })

  it('форма сохранения — поля как у gameData.js АИМ', () => {
    const table = parseGameData(GAME_DATA_HTML)[0]!.tables[0]!
    const fields = saveProtocolFields(2920, table.aimTableId, { win: 'mafia', seats: table.seats })
    const map = new Map(fields)
    assert.equal(map.get('action'), 'save_game_result')
    assert.equal(map.get('id'), '2920')
    assert.equal(map.get('table_id'), '78520')
    assert.equal(map.get('win'), 'mafia')
    assert.equal(map.get('view_sc'), '0')
    assert.equal(map.get('user[0][id]'), '1000')
    assert.equal(map.get('user[0][role]'), 'don')
    assert.equal(map.get('user[0][first_kill]'), 'no')
    assert.equal(map.get('user[0][sheriff_open]'), '1')
    assert.equal(map.get('user[0][extra_point]'), '0.6')
    assert.equal(map.get('user[1][first_kill]'), '1-ka')
    assert.equal(map.get('user[9][replacement]'), '0')
    assert.equal(fields.filter(([key]) => key.endsWith('[id]')).length, 10)
  })
})

// ─── Публичная рассадка gomafia.pro ──────────────────────────────────────────

const SERVER_DATA = {
  tournament: { id: '2920', title: 'ALINCUP', status: 'registration closed', date_start: '2026-04-05', date_end: '2026-04-05', city: 'RU', city_translate: 'Нальчик', main_referee_id: '42', is_hidden_result: '1' },
  scheme: { number_of_games_qualifying: '1', number_of_games_semi_final: '0', number_of_games_final: '2' },
  games: [
    {
      gameNum: 1,
      game: [
        { table_id: 501, tableNum: 2, win: '', referee: 'Судья Второй', referee_id: '7', table: ROLES.map((_, i) => ({ id: 3000 + i, place: i + 1, login: `Б${i + 1}`, role: null, elo: 1500 })) },
        { table_id: 500, tableNum: 1, win: 'mafia', referee: 'Судья Первый', referee_id: '42', table: ROLES.map((_, i) => ({ id: 2000 + i, place: i + 1, login: `А${i + 1}`, role: null, elo: '1600.5' })) },
      ],
    },
    { gameNum: 2, game: [{ table_id: 510, tableNum: 1, win: '', referee: 'Судья Первый', referee_id: '42', table: [] }] },
  ],
}

describe('рассадка турнира', () => {
  it('игры по порядку, столы по номеру, тур по схеме', () => {
    const seating = parseTournamentSeating(SERVER_DATA)!
    assert.equal(seating.id, 2920)
    assert.equal(seating.city, 'Нальчик')
    assert.equal(seating.mainRefereeId, 42)
    assert.equal(seating.hiddenResults, true)
    assert.deepEqual(seating.games.map((g) => [g.number, g.stage, g.tables.map((t) => t.number)]), [[1, 'qualifying', [1, 2]], [2, 'final', [1]]])
    assert.deepEqual(seating.games[0]!.tables[0]!.seats[0], { place: 1, playerId: 2000, login: 'А1', elo: 1600.5, role: null, points: null })
    assert.equal(seating.games[0]!.tables[0]!.win, 'mafia')
    assert.equal(seating.games[0]!.tables[1]!.win, null)
  })

  it('не страница турнира — null', () => {
    assert.equal(parseTournamentSeating(null), null)
    assert.equal(parseTournamentSeating({ tournaments: [] }), null)
  })
})

// ─── Сетевой клиент АИМ ──────────────────────────────────────────────────────

function fakeFetch(handler: (url: string, init: RequestInit) => Response): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => handler(String(input), init ?? {})) as typeof fetch
}

const json = (body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json', ...headers } })

describe('клиент АИМ', () => {
  it('вход: cookie сессии и csrf; неверный пароль — bad_credentials', async () => {
    const client = new AimClient(fakeFetch((url, init) => {
      assert.equal(url, 'https://admin.gomafia.pro/login/')
      const form = init.body as FormData
      assert.equal(form.get('action'), 'form_action_login')
      return form.get('password') === 'right'
        ? json({ result: 'success', csrf_token: 'csrf-1' }, { 'set-cookie': 'go-mafia-dev=abc; path=/; HttpOnly' })
        : json({ result: 'fail', notification: 'Неверный логин или пароль' })
    }))
    const session = await client.login('judge', 'right')
    assert.equal(session.cookie, 'go-mafia-dev=abc')
    assert.equal(session.csrf, 'csrf-1')
    await assert.rejects(client.login('judge', 'wrong'), (error: unknown) => error instanceof AimError && error.code === 'bad_credentials')
  })

  it('протокол: csrf уходит в форме и обновляется из ответа; истёкшая сессия и отказ в доступе различаются', async () => {
    let reply: unknown = { result: 'success', csrf_token: 'csrf-2', params: { game_data_container: GAME_DATA_HTML } }
    const client = new AimClient(fakeFetch((url, init) => {
      assert.equal(url, 'https://admin.gomafia.pro/controller-tournament-edit/')
      const form = init.body as FormData
      assert.equal(form.get('csrf_token'), 'csrf-1')
      assert.equal((init.headers as Record<string, string>)['Cookie'], 'go-mafia-dev=abc')
      return json(reply)
    }))
    const session = new AimSession('go-mafia-dev=abc', 'csrf-1')
    const games = await client.gameData(session, 2920)
    assert.equal(games.length, 3)
    assert.equal(session.csrf, 'csrf-2')

    reply = { result: 'fail', notification: 'Время сессии истекло. Пожалуйста авторизуйтесь снова.' }
    await assert.rejects(client.gameData(new AimSession('go-mafia-dev=abc', 'csrf-1'), 2920), (e: unknown) => e instanceof AimError && e.code === 'session_expired')
    reply = { result: 'fail', data: { error: 'get_access_denied' } }
    await assert.rejects(client.gameData(new AimSession('go-mafia-dev=abc', 'csrf-1'), 2920), (e: unknown) => e instanceof AimError && e.code === 'access_denied')
  })

  it('список турниров: редирект на вход — session_expired', async () => {
    const client = new AimClient(fakeFetch(() => new Response(null, { status: 302, headers: { location: 'https://admin.gomafia.pro/login' } })))
    await assert.rejects(client.tournaments(new AimSession('a=b', null)), (e: unknown) => e instanceof AimError && e.code === 'session_expired')
  })

  it('cookie: новое значение побеждает, deleted удаляет', () => {
    assert.equal(mergeCookies('a=1; b=2', ['b=3; path=/', 'c=4', 'a=deleted; Max-Age=0']), 'b=3; c=4')
  })
})

// ─── Ручки ───────────────────────────────────────────────────────────────────

const AIM_GAMES: AimGame[] = parseGameData(GAME_DATA_HTML)

function seatingFor(id: number, myId: number): TournamentSeating {
  const seats = (base: number) => ROLES.map((_, i) => ({ place: i + 1, playerId: base + i, login: `И${base + i}`, elo: 1500, role: null, points: null }))
  return {
    id, title: 'ALINCUP', status: 'registration closed', dateStart: '2026-04-05', dateEnd: '2026-04-05', city: 'Нальчик',
    mainRefereeId: 1, hiddenResults: false, scheme: { qualifyingGames: 1, semiFinalGames: 0, finalGames: 2 },
    games: [
      { number: 1, stage: 'qualifying', tables: [
        { tableId: 500, number: 1, refereeId: myId, refereeName: 'Я', win: null, seats: seats(2000) },
        { tableId: 501, number: 2, refereeId: 999, refereeName: 'Другой', win: null, seats: seats(3000) },
      ] },
      { number: 2, stage: 'final', tables: [{ tableId: 510, number: 1, refereeId: 999, refereeName: 'Другой', win: null, seats: seats(4000) }] },
    ],
  }
}

async function linkedJudge(ctx: TestContext, aimPassword = 'secret') {
  ctx.aim.password = aimPassword
  const session = await signIn(ctx)
  const linked = await call(ctx, 'POST', '/v1/me/gomafia', { token: session.accessToken, body: { login: 'host', password: 'secret' } })
  assert.equal(linked.status, 200)
  return session.accessToken
}

function withTournaments(ctx: TestContext) {
  ctx.aim.tournamentsByLogin.set('host', [
    { id: 2920, title: 'ALINCUP', dateStart: '2026-04-05', dateEnd: '2026-04-05', city: 'Нальчик', mainReferee: 'Я', status: 'registration open' },
    { id: 3001, title: 'Чужой кубок', dateStart: '2026-05-01', dateEnd: '2026-05-02', city: 'Москва', mainReferee: 'Другой', status: 'registration closed' },
    { id: 2735, title: 'Старый', dateStart: '2026-01-01', dateEnd: '2026-01-01', city: null, mainReferee: null, status: 'completed' },
  ])
  ctx.aim.editors.set(2920, new Set(['host']))
  ctx.aim.games.set(2920, AIM_GAMES)
  ctx.tournaments.seatings.set(2920, seatingFor(2920, 4242))
  ctx.tournaments.seatings.set(3001, seatingFor(3001, 4242))
}

describe('ручки турниров', () => {
  it('привязка GoMafia подключает АИМ тем же паролем; пароль хранится шифротекстом', async () => {
    const ctx = createTestContext()
    const token = await linkedJudge(ctx)
    const status = await call(ctx, 'GET', '/v1/me/gomafia/aim', { token })
    assert.deepEqual(status.json, { connected: true })
    const sealed = [...ctx.repo.aim.values()][0]!
    assert.ok(sealed.startsWith('v1.'))
    assert.ok(!sealed.includes('secret'))
  })

  it('пароль АИМ другой — привязка проходит, АИМ подключается отдельно', async () => {
    const ctx = createTestContext()
    const token = await linkedJudge(ctx, 'aim-other')
    assert.deepEqual((await call(ctx, 'GET', '/v1/me/gomafia/aim', { token })).json, { connected: false })
    assert.equal((await call(ctx, 'GET', '/v1/tournaments', { token })).json.error.code, 'aim_not_connected')

    const bad = await call(ctx, 'POST', '/v1/me/gomafia/aim', { token, body: { login: 'host', password: 'nope' } })
    assert.equal(bad.status, 422)
    const ok = await call(ctx, 'POST', '/v1/me/gomafia/aim', { token, body: { login: 'host', password: 'aim-other' } })
    assert.deepEqual(ok.json, { connected: true })
  })

  it('список: только незавершённые, роль редактора — по доступу к «Данным игр»', async () => {
    const ctx = createTestContext()
    const token = await linkedJudge(ctx)
    withTournaments(ctx)
    const list = await call(ctx, 'GET', '/v1/tournaments', { token })
    assert.equal(list.status, 200)
    assert.deepEqual(list.json.tournaments.map((t: any) => [t.id, t.role, t.status]), [[2920, 'editor', 'registration open'], [3001, 'referee', 'registration closed']])
  })

  it('редактор видит все столы и внесённые протоколы', async () => {
    const ctx = createTestContext()
    const token = await linkedJudge(ctx)
    withTournaments(ctx)
    const res = await call(ctx, 'GET', '/v1/tournaments/2920', { token })
    assert.equal(res.status, 200)
    assert.equal(res.json.role, 'editor')
    assert.deepEqual(res.json.games.map((g: any) => [g.number, g.stage, g.tables.map((t: any) => [t.number, t.isMine, !!t.protocol])]), [
      [1, 'qualifying', [[1, true, true], [2, false, true]]],
      [2, 'final', [[1, false, true]]],
    ])
    const protocol = res.json.games[0].tables[0].protocol
    assert.equal(protocol.win, 'mafia')
    assert.equal(protocol.seats[1].firstKill, '1-ka')
    assert.equal(protocol.seats[0].aimSeatId, undefined)
  })

  it('судья видит только свои столы и без протоколов', async () => {
    const ctx = createTestContext()
    const token = await linkedJudge(ctx)
    withTournaments(ctx)
    const res = await call(ctx, 'GET', '/v1/tournaments/3001', { token })
    assert.equal(res.status, 200)
    assert.equal(res.json.role, 'referee')
    assert.deepEqual(res.json.games.map((g: any) => [g.number, g.tables.map((t: any) => [t.number, t.isMine, !!t.protocol])]), [[1, [[1, true, false]]]])
    assert.equal(res.json.games[0].tables[0].seats[0].playerId, 2000)
  })

  it('турнира нет в АИМ пользователя — 404', async () => {
    const ctx = createTestContext()
    const token = await linkedJudge(ctx)
    withTournaments(ctx)
    assert.equal((await call(ctx, 'GET', '/v1/tournaments/9999', { token })).status, 404)
  })

  it('истекшая сессия АИМ — сервер входит заново сохранённым паролем', async () => {
    const ctx = createTestContext()
    const token = await linkedJudge(ctx)
    withTournaments(ctx)
    const before = ctx.aim.logins.length
    ctx.aim.expireNext = true
    const list = await call(ctx, 'GET', '/v1/tournaments', { token })
    assert.equal(list.status, 200)
    assert.equal(ctx.aim.logins.length, before + 1)
  })

  it('пароль в АИМ сменили — просим войти заново; АИМ лежит — 502', async () => {
    const ctx = createTestContext()
    const token = await linkedJudge(ctx)
    withTournaments(ctx)
    ctx.aim.password = 'changed'
    ctx.aim.expireNext = true
    assert.equal((await call(ctx, 'GET', '/v1/tournaments', { token })).json.error.code, 'aim_relogin_required')
    ctx.aim.down = true
    assert.equal((await call(ctx, 'GET', '/v1/tournaments', { token })).status, 502)
  })

  it('отвязка GoMafia стирает пароль АИМ', async () => {
    const ctx = createTestContext()
    const token = await linkedJudge(ctx)
    assert.equal(ctx.repo.aim.size, 1)
    await call(ctx, 'DELETE', '/v1/me/gomafia', { token })
    assert.equal(ctx.repo.aim.size, 0)
    assert.equal((await call(ctx, 'GET', '/v1/tournaments', { token })).json.error.code, 'gomafia_required')
  })
})

describe('отправка протокола', () => {
  const ROLE_TO_AIM: Record<string, string> = { don: 'don', mafia: 'mafia', sheriff: 'sheriff', red: 'red' }
  const protocol = (gameNumber = 1, tableNumber = 1) => ({
    gameNumber,
    tableNumber,
    win: 'city',
    // Места в обратном порядке: сервер сопоставляет их по номеру, а не по порядку.
    seats: ROLES.map((role, i) => ({
      place: i + 1,
      role: ROLE_TO_AIM[role === 'red' ? 'red' : role],
      firstKill: i === 1 ? '2-ka' : 'no',
      selfKill: false,
      sheriffOpen: role === 'sheriff',
      extraPoint: i === 4 ? 0.5 : 0,
      fine: 0,
      fineDiscipline: i === 9 ? 0.3 : 0,
      replacement: false,
    })).reverse(),
  })

  it('ГС вносит протокол: стол и места АИМ по номерам', async () => {
    const ctx = createTestContext()
    const token = await linkedJudge(ctx)
    withTournaments(ctx)
    const res = await call(ctx, 'POST', '/v1/tournaments/2920/protocols', { token, body: protocol(1, 2) })
    assert.equal(res.status, 200)
    assert.deepEqual(res.json, { status: 'saved' })
    const saved = ctx.aim.saved.at(-1)!
    assert.equal(saved.tournamentId, 2920)
    assert.equal(saved.aimTableId, 78521)
    assert.equal(saved.protocol.win, 'city')
    assert.deepEqual(saved.protocol.seats.map((s) => s.aimSeatId), Array.from({ length: 10 }, (_, i) => 1010 + i))
    assert.equal(saved.protocol.seats[1]!.firstKill, '2-ka')
    assert.equal(saved.protocol.seats[4]!.extraPoint, 0.5)
    assert.equal(saved.protocol.seats[9]!.fineDiscipline, 0.3)
  })

  it('нет стола — table_mismatch; кривой протокол — 422', async () => {
    const ctx = createTestContext()
    const token = await linkedJudge(ctx)
    withTournaments(ctx)
    const missing = await call(ctx, 'POST', '/v1/tournaments/2920/protocols', { token, body: protocol(7, 1) })
    assert.equal(missing.json.error.code, 'table_mismatch')
    const short = { ...protocol(), seats: protocol().seats.slice(1) }
    assert.equal((await call(ctx, 'POST', '/v1/tournaments/2920/protocols', { token, body: short })).status, 422)
    assert.equal(ctx.aim.saved.length, 0)
  })
})

describe('очередь протоколов ГС', () => {
  const protocolBody = (gameNumber = 1, tableNumber = 1) => ({
    gameNumber,
    tableNumber,
    win: 'mafia',
    seats: ROLES.map((role, i) => ({
      place: i + 1, role, firstKill: 'no', selfKill: false, sheriffOpen: role === 'sheriff',
      extraPoint: 0, fine: 0, fineDiscipline: 0, replacement: false,
    })),
  })

  /** Судья (host, GoMafia 4242) и ГС (второй пользователь, GoMafia 5001) турнира 3001. */
  async function judgeAndReviewer() {
    const ctx = createTestContext()
    const judge = await linkedJudge(ctx)
    withTournaments(ctx)
    const reviewerSession = await signIn(ctx, { id: 2002, is_bot: false, first_name: 'ГС', username: 'gs' })
    ctx.gomafia.players.set('5001', { ...ctx.gomafia.players.get('5001')!, login: 'gs' })
    const { id: reviewerId } = (await ctx.repo.userByTgId(2002))!
    await ctx.repo.setGomafiaLink(reviewerId, { player: { id: 5001, nickname: 'gs', fullName: null, avatarURL: null, elo: null, clubID: null, clubTitle: null, city: null, tournamentsPlayed: null, isInHostClub: false, isVerified: false } as any, club: null }, ctx.clock.now)
    await ctx.deps.aimAccounts.connect(reviewerId, 'gs', 'secret')
    ctx.aim.tournamentsByLogin.set('gs', ctx.aim.tournamentsByLogin.get('host')!)
    ctx.aim.editors.set(3001, new Set(['gs']))
    ctx.aim.games.set(3001, AIM_GAMES)
    const seating = ctx.tournaments.seatings.get(3001)!
    ctx.tournaments.seatings.set(3001, { ...seating, mainRefereeId: 5001 })
    return { ctx, judge, reviewer: reviewerSession.accessToken }
  }

  it('судья стола отправляет протокол ГС; ГС получает уведомление в боте', async () => {
    const { ctx, judge } = await judgeAndReviewer()
    const res = await call(ctx, 'POST', '/v1/tournaments/3001/protocols', { token: judge, body: protocolBody() })
    assert.equal(res.status, 200)
    assert.equal(res.json.status, 'pending')
    assert.equal(res.json.reviewerUsesMafBoard, true)
    await ctx.flush()
    assert.ok(ctx.messenger.sent.some((m) => m.chatId === 2002 && m.text.includes('прислал протокол')))
    assert.equal(ctx.aim.saved.length, 0)
    const mine = await call(ctx, 'GET', '/v1/tournaments/3001/protocols/mine', { token: judge })
    assert.deepEqual(mine.json.protocols.map((p: any) => [p.gameNumber, p.tableNumber, p.status]), [[1, 1, 'pending']])
  })

  it('чужой стол — not_your_table', async () => {
    const { ctx, judge } = await judgeAndReviewer()
    const res = await call(ctx, 'POST', '/v1/tournaments/3001/protocols', { token: judge, body: protocolBody(1, 2) })
    assert.equal(res.json.error.code, 'not_your_table')
  })

  it('ГС видит очередь и подтверждает с правкой — протокол уходит в АИМ от имени ГС', async () => {
    const { ctx, judge, reviewer } = await judgeAndReviewer()
    await call(ctx, 'POST', '/v1/tournaments/3001/protocols', { token: judge, body: protocolBody() })
    const list = await call(ctx, 'GET', '/v1/tournaments', { token: reviewer })
    assert.equal(list.json.tournaments.find((t: any) => t.id === 3001).pendingProtocols, 1)
    const queue = await call(ctx, 'GET', '/v1/tournaments/3001/protocols', { token: reviewer })
    assert.equal(queue.json.protocols.length, 1)
    const pid = queue.json.protocols[0].id
    // Судья не видит чужую очередь.
    assert.equal((await call(ctx, 'GET', '/v1/tournaments/3001/protocols', { token: judge })).json.error.code, 'editor_required')

    const edited = { ...protocolBody(9, 9), win: 'city' }
    const approved = await call(ctx, 'POST', `/v1/tournaments/3001/protocols/${pid}/approve`, { token: reviewer, body: { protocol: edited } })
    assert.equal(approved.status, 200)
    assert.equal(approved.json.submission.status, 'saved')
    const saved = ctx.aim.saved.at(-1)!
    assert.equal(saved.login, 'gs')
    assert.equal(saved.aimTableId, 78520)
    assert.equal(saved.protocol.win, 'city')
    await ctx.flush()
    assert.ok(ctx.messenger.sent.some((m) => m.text.includes('ГС внёс ваш протокол')))
    const again = await call(ctx, 'POST', `/v1/tournaments/3001/protocols/${pid}/approve`, { token: reviewer, body: {} })
    assert.equal(again.json.error.code, 'already_decided')
  })

  it('ГС отклоняет с причиной; судья видит причину и отправляет заново', async () => {
    const { ctx, judge, reviewer } = await judgeAndReviewer()
    const first = await call(ctx, 'POST', '/v1/tournaments/3001/protocols', { token: judge, body: protocolBody() })
    const pid = first.json.submission.id
    const rejected = await call(ctx, 'POST', `/v1/tournaments/3001/protocols/${pid}/reject`, { token: reviewer, body: { reason: 'Не тот ПУ' } })
    assert.equal(rejected.json.submission.status, 'rejected')
    const mine = await call(ctx, 'GET', '/v1/tournaments/3001/protocols/mine', { token: judge })
    assert.equal(mine.json.protocols[0].reason, 'Не тот ПУ')
    const resent = await call(ctx, 'POST', '/v1/tournaments/3001/protocols', { token: judge, body: protocolBody() })
    assert.equal(resent.json.submission.id, pid)
    assert.equal(resent.json.submission.status, 'pending')
  })
})

describe('открытая ссылка на итоги', () => {
  const snapshot = {
    title: 'Турнир «ALIN <CUP>» · Игра 1 · стол 1',
    subtitle: 'Судья: host',
    winner: 'black',
    winnerText: 'Победа мафии',
    reason: 'Мафия сравнялась с городом',
    finishedAt: '16 нояб. 2026, 21:40',
    seats: ROLES.map((role, i) => ({ place: i + 1, nickname: `Игрок ${i + 1}`, role, team: role === 'don' || role === 'mafia' ? 'black' : 'red', points: i === 0 ? 1.4 : 0, details: i === 1 ? 'ПУ 2-ка' : null })),
  }
  const gameID = '6F1C2E3A-0000-4000-8000-000000000042'

  it('ссылка открывается без входа; повтор для той же игры — тот же адрес; текст экранирован', async () => {
    const ctx = createTestContext()
    const token = await linkedJudge(ctx)
    const first = await call(ctx, 'POST', '/v1/shares', { token, body: { gameID, snapshot }, headers: { host: 'api.mafboard.test' } })
    assert.equal(first.status, 200)
    assert.match(first.json.url, /^https:\/\/api\.mafboard\.test\/api\/mafboard\/s\/[A-Za-z0-9_-]{16}$/)
    const second = await call(ctx, 'POST', '/v1/shares', { token, body: { gameID, snapshot: { ...snapshot, winnerText: 'Победа мафии!' } }, headers: { host: 'api.mafboard.test' } })
    assert.equal(second.json.url, first.json.url)

    const path = new URL(first.json.url).pathname
    const page = await ctx.app.request(path)
    assert.equal(page.status, 200)
    const html = await page.text()
    assert.ok(html.includes('ALIN &lt;CUP&gt;'))
    assert.ok(html.includes('Победа мафии!'))
    assert.ok(html.includes('ПУ 2-ка'))
    assert.equal(page.headers.get('x-robots-tag'), 'noindex')
    assert.equal((await ctx.app.request('/api/mafboard/s/nope-nope-nope')).status, 404)
  })

  it('без входа ссылку не создать; кривой снимок — 422', async () => {
    const ctx = createTestContext()
    assert.equal((await call(ctx, 'POST', '/v1/shares', { body: { gameID, snapshot } })).status, 401)
    const token = await linkedJudge(ctx)
    assert.equal((await call(ctx, 'POST', '/v1/shares', { token, body: { gameID, snapshot: { ...snapshot, seats: [] } } })).status, 422)
  })
})
