/**
 * Карточки Tai в личке — HTML-виджеты Telegram (lib/tgWidget):
 *  • games — ближайшие игры: «Иду» записывает, видно, сколько уже идёт;
 *  • account — карта клиента: бонусы, депозит или долг, визиты;
 *  • club — адрес, часы, цены;
 *  • shift — смена и касса (только сотрудникам).
 * Карточку присылает команда (/games, /me, /club, /shift) или сам Tai (show_card).
 * Нажатия приходят апдейтом widget_query (виджет) или callback_query «w:…» (кнопки
 * под текстовой карточкой, пока Telegram не пускает виджеты) — действие одно.
 */
import { sql, type Database } from '@titan/database'
import { notify } from '../notifications/push.js'
import { createApiCaller } from '../ai/tai/internal.js'
import type { ToolDef, ToolResult } from '../ai/tai/tools/types.js'
import { voteMapOfPoll } from '../../lib/pollState.js'
import { answerWidget, CARD_CALLBACK_PREFIX, sendCard, updateCard, updateCardText, type Card, type CardRow } from '../../lib/tgWidget.js'
import type { TgClub } from './club.js'
import { gameConfigs, nightLabel, todaysPolls, upcomingNights, type GameNight } from './games.js'
import { staffHeaders, whoIs, type TgPerson } from './identity.js'
import type { TgUser } from './types.js'
import { accountSummary, clubSummary, createSignup, NO_PROFILE } from './dialog/client-tools.js'

export type CardKind = 'games' | 'account' | 'club' | 'shift'
const NIGHTS_IN_CARD = 5
const MSK_TZ = 'Europe/Moscow'
const rub = (n: number) => `${Math.round(n).toLocaleString('ru-RU')} ₽`
const hhmm = (d: Date | string) => new Date(d).toLocaleTimeString('ru-RU', { timeZone: MSK_TZ, hour: '2-digit', minute: '2-digit' })

const CAPTION: Record<CardKind, string> = {
  games: '🎲 Ближайшие игры',
  account: '💳 Карта клиента',
  club: '🏛 О клубе',
  shift: '🧾 Смена',
}

// ─── Игры ────────────────────────────────────────────────────────────────────

const startsAtOf = (n: Pick<GameNight, 'date' | 'time'>) => `${n.date}T${n.time || '20:00'}:00+03:00`
const rowsOf = <T>(res: unknown): T[] => (Array.isArray(res) ? (res as T[]) : ((res as { rows?: T[] }).rows ?? []))

/** Сколько идёт на вечер (записи + «Да» в сегодняшнем опросе) и идёт ли сам человек. */
async function nightCount(db: Database, night: GameNight, tgId: string): Promise<{ count: number; me: boolean }> {
  const res = await db.execute(sql`
    SELECT COALESCE(SUM(guests), 0)::int AS guests, ARRAY_REMOVE(ARRAY_AGG(meta->>'tgId'), NULL) AS tg
    FROM bookings
    WHERE kind = 'game' AND status IN ('new', 'confirmed') AND starts_at = ${startsAtOf(night)}::timestamptz
  `)
  const row = rowsOf<{ guests: number; tg: string[] | null }>(res)[0]
  const booked = new Set(row?.tg ?? [])
  let count = Number(row?.guests ?? 0)
  let me = booked.has(tgId)
  if (night.today) {
    for (const poll of (await todaysPolls(db)).filter((p) => p.kind === night.kind)) {
      const yes = poll.options.findIndex((o) => o.trim().toLowerCase() === 'да')
      if (yes < 0) continue
      const votes = await voteMapOfPoll(db, poll.pollId)
      for (const [voter, ids] of Object.entries(votes)) {
        if (!ids.includes(yes) || booked.has(voter)) continue
        count += 1
        if (voter === tgId) me = true
      }
    }
  }
  return { count, me }
}

async function gamesCard(club: TgClub, person: TgPerson): Promise<Card> {
  const nights = upcomingNights(await gameConfigs(club.db), 8).slice(0, NIGHTS_IN_CARD)
  if (!nights.length) return { i: '🎲', t: 'Ближайшие игры', s: 'В расписании пока пусто — загляни позже.' }
  const rows: CardRow[] = []
  for (const night of nights) {
    const { count, me } = await nightCount(club.db, night, person.tgId)
    const going = count ? `идут ${count}` : 'пока никого'
    rows.push({
      l: `${night.title} · ${night.weekday}${night.time ? ` в ${night.time}` : ''}`,
      v: me ? `Ты записан · ${going}` : going,
      ...(me ? { a: 1 as const } : {}),
      b: me ? { l: 'Не пойду', d: `no:${night.kind}:${night.date}`, o: 1 } : { l: 'Иду', d: `go:${night.kind}:${night.date}` },
    })
  }
  return { i: '🎲', t: 'Ближайшие игры', s: 'Нажми «Иду» — запишу и предупрежу администратора', r: rows, b: [{ l: 'Обновить', d: 'r:games', o: 1 }] }
}

async function cancelSignup(db: Database, tgId: string, night: GameNight): Promise<boolean> {
  const res = await db.execute(sql`
    UPDATE bookings SET status = 'cancelled'
    WHERE source = 'tai' AND kind = 'game' AND status = 'new' AND meta->>'tgId' = ${tgId} AND starts_at = ${startsAtOf(night)}::timestamptz
    RETURNING id
  `)
  return rowsOf(res).length > 0
}

/** «Иду» / «Не пойду» с карточки игр. Возвращает подпись для кнопки. */
async function toggleSignup(club: TgClub, person: TgPerson, going: boolean, kind: string, date: string): Promise<string> {
  const night = upcomingNights(await gameConfigs(club.db), 15).find((n) => n.kind === kind && n.date === date)
  if (!night) return 'Этой игры уже нет в расписании'
  if (!going) return (await cancelSignup(club.db, person.tgId, night)) ? 'Запись отменена' : 'Голос в опросе можно поменять в самом опросе'
  const result = await createSignup(club.db, { person }, night, 1, 'Записался с карточки в Telegram')
  if (result === 'created') {
    const who = person.profile?.nickname ?? (person.user.first_name || 'Новичок')
    void notify({ type: 'site_request', title: '🎲 Запись через Tai', body: `${who}${person.profile ? '' : ' (новичок)'} · ${nightLabel(night)}`, meta: { url: '/events' } }, club.db, club.id).catch(() => {})
  }
  return result === 'created' ? `Записал: ${nightLabel(night)} ✅` : 'Ты уже записан'
}

// ─── Карта клиента, клуб, смена ──────────────────────────────────────────────

async function accountCard(club: TgClub, person: TgPerson): Promise<Card> {
  const p = person.profile
  if (!p) return { i: '💳', t: 'Карта клиента', s: NO_PROFILE }
  const a = await accountSummary(club.db, p)
  const rows: CardRow[] = [
    a.debt ? { l: 'Долг', v: a.debt } : { l: 'Депозит', v: a.deposit ?? '0 ₽' },
    { l: 'Визитов за год', v: String(a.visitsLastYear) },
    ...(a.lastVisit ? [{ l: 'Последний визит', v: a.lastVisit }] : []),
  ]
  return {
    i: '💳',
    t: a.nickname,
    s: a.status,
    n: `${a.bonus.toLocaleString('ru-RU')} бонусов`,
    r: rows,
    b: [{ l: 'Обновить', d: 'r:account', o: 1 }],
    f: a.pendingRegistration ? 'Анкета ждёт подтверждения администратора' : undefined,
  }
}

async function clubCard(club: TgClub): Promise<Card> {
  const c = await clubSummary(club)
  const rows: CardRow[] = [
    ...(c.hours ? [{ l: 'Часы работы', v: c.hours }] : []),
    ...c.eveningPrices.slice(0, 4).map((line) => ({ l: line })),
    ...c.zones.slice(0, 3).map((line) => ({ l: line })),
  ]
  return { i: '🏛', t: c.name, s: c.address ?? undefined, r: rows, b: [{ l: 'Ближайшие игры', d: 'show:games' }] }
}

interface ShiftSummary {
  shift: { openedAt: string } | null
  openChecks?: { count: number; total: number }
  cashInRegister?: number
  forecast?: { amount: number } | null
  staff?: { nickname: string }[]
}

async function shiftCard(club: TgClub, person: TgPerson): Promise<Card> {
  if (!person.staff || !person.profile) return { i: '🧾', t: 'Смена', s: 'Только для сотрудников клуба' }
  const api = createApiCaller(await staffHeaders(club, person.profile))
  const s = await api.get<ShiftSummary>('/api/pos/shift-summary').catch(() => null)
  const refresh = [{ l: 'Обновить', d: 'r:shift', o: 1 as const }]
  const updated = `обновлено в ${hhmm(new Date())}`
  if (!s) return { i: '🧾', t: 'Смена', s: 'Касса не ответила', b: refresh }
  if (!s.shift) return { i: '🧾', t: 'Смена закрыта', s: 'Открыть смену можно в Titan HUB', b: refresh, f: updated }
  const checks = s.openChecks ?? { count: 0, total: 0 }
  const rows: CardRow[] = [
    ...(s.forecast ? [{ l: 'Прогноз вечера от Tai', v: 'по открытым чекам и среднему чеку', a: 1 as const }] : []),
    { l: 'Открытые чеки', v: checks.count ? `${checks.count} на ${rub(checks.total)}` : 'нет' },
    { l: 'В кассе', v: rub(s.cashInRegister ?? 0) },
    ...(s.staff?.length ? [{ l: 'На смене', v: s.staff.map((m) => m.nickname).join(', ') }] : []),
  ]
  return { i: '🧾', t: 'Смена', s: `открыта в ${hhmm(s.shift.openedAt)}`, ...(s.forecast ? { n: `≈ ${rub(s.forecast.amount)}` } : {}), r: rows, b: refresh, f: updated }
}

async function buildCard(club: TgClub, person: TgPerson, kind: CardKind): Promise<Card> {
  if (kind === 'games') return gamesCard(club, person)
  if (kind === 'account') return accountCard(club, person)
  if (kind === 'club') return clubCard(club)
  return shiftCard(club, person)
}

/** Прислать карточку в чат (в личке — виджетом, в группе — текстом). */
export async function showCard(club: TgClub, person: TgPerson, chatId: string | number, kind: CardKind, opts: { threadId?: number | null; group?: boolean } = {}): Promise<boolean> {
  const card = await buildCard(club, person, kind)
  const sent = await sendCard(club.bot, chatId, card, { caption: CAPTION[kind], threadId: opts.threadId, textOnly: opts.group })
  return sent.ok
}

// ─── Команды лички и нажатия ─────────────────────────────────────────────────

const COMMANDS: Record<string, CardKind> = { '/games': 'games', '/me': 'account', '/club': 'club', '/shift': 'shift' }

/** Команды лички с карточками. true — обработано. */
export async function handleCardCommand(club: TgClub, from: TgUser, chatId: number, text: string): Promise<boolean> {
  const word = text.trim().split(/\s+/)[0]?.toLowerCase().split('@')[0] ?? ''
  const kind = COMMANDS[word]
  if (!kind) return false
  await showCard(club, await whoIs(club.db, from), chatId, kind)
  return true
}

export interface WidgetQuery {
  id: string
  from: TgUser
  data?: string
  chat?: { id: number }
  message_id?: number
}

type CardAction = { reply: string; refresh: CardKind | null; show: CardKind | null }

/** Что делает кнопка карточки (данные одинаковы у виджета и у кнопки под текстом). */
async function runCardAction(club: TgClub, person: TgPerson, data: string): Promise<CardAction> {
  const [action, kind, date] = data.split(':')
  if (action === 'show' && kind === 'games') return { reply: 'Присылаю ↓', refresh: null, show: 'games' }
  if ((action === 'go' || action === 'no') && kind && date) {
    return { reply: await toggleSignup(club, person, action === 'go', kind, date), refresh: 'games', show: null }
  }
  if (action === 'r' && (kind === 'games' || kind === 'account' || kind === 'shift' || kind === 'club')) return { reply: 'Обновлено', refresh: kind, show: null }
  return { reply: 'Эта кнопка устарела', refresh: null, show: null }
}

/** Нажатие кнопки в виджете. Отвечаем за 15 с, затем обновляем карточку. */
export async function onWidgetQuery(club: TgClub, q: WidgetQuery): Promise<void> {
  const person = await whoIs(club.db, q.from)
  const result = await runCardAction(club, person, String(q.data ?? ''))
  await answerWidget(club.bot, q.id, result.reply)
  const chatId = q.chat?.id
  if (!chatId) return
  if (result.show) await showCard(club, person, chatId, result.show)
  if (result.refresh && q.message_id) await updateCard(club.bot, chatId, q.message_id, await buildCard(club, person, result.refresh))
}

/** Нажатие кнопки под текстовой карточкой (callback_data «w:…»). */
export async function onCardCallback(club: TgClub, cq: { id: string; from: TgUser; data?: string; message?: { message_id: number; chat: { id: number } } }): Promise<void> {
  const person = await whoIs(club.db, cq.from)
  const result = await runCardAction(club, person, String(cq.data ?? '').slice(CARD_CALLBACK_PREFIX.length))
  await club.bot.answerCallback(cq.id, result.reply)
  const msg = cq.message
  if (!msg) return
  if (result.show) await showCard(club, person, msg.chat.id, result.show)
  if (result.refresh) await updateCardText(club.bot, msg.chat.id, msg.message_id, await buildCard(club, person, result.refresh))
}

// ─── Инструмент Tai ──────────────────────────────────────────────────────────

/** Tai показывает карточку вместо длинного текста. */
export function showCardTool(club: TgClub, person: TgPerson, chatId: string): ToolDef {
  const kinds: CardKind[] = person.staff ? ['games', 'account', 'club', 'shift'] : ['games', 'account', 'club']
  return {
    name: 'show_card',
    description:
      'Показать в чате живую карточку (мини-приложение прямо в сообщении). games — ближайшие игры с кнопкой «Иду»; ' +
      'account — бонусы, депозит или долг, визиты; club — адрес, часы, цены' +
      (person.staff ? '; shift — смена, открытые чеки, касса, прогноз' : '') +
      '. Вызывай, когда спрашивают расписание, «сколько у меня бонусов», адрес и цены' +
      (person.staff ? ', как идёт смена' : '') +
      '. После карточки ответь одной короткой фразой, не пересказывай её.',
    parameters: { type: 'object', properties: { kind: { type: 'string', enum: kinds } }, required: ['kind'] },
    status: () => 'Готовлю карточку…',
    async run(args): Promise<ToolResult> {
      const kind = String(args['kind'] ?? '') as CardKind
      if (!kinds.includes(kind)) return { data: { error: 'Такой карточки нет' } }
      const ok = await showCard(club, person, chatId, kind)
      return ok ? { data: { ok: true, shown: kind, hint: 'Карточка уже в чате выше.' }, memo: `показал карточку ${kind}` } : { data: { error: 'Карточка не отправилась' } }
    },
  }
}
