/**
 * Инструменты Tai в разговоре с клиентом: клуб, игры, свой кошелёк, память о
 * человеке, напоминания, опрос, запись на игру и передача администратору.
 *
 * Кассовых действий и чужих данных здесь нет: клиент видит только свой профиль.
 */
import {
  profiles, clientTiers, checks, transactions, eq, and, desc, sql, count, max, gt,
  type Database, type TaiContact, type TaiGames,
} from '@titan/database'
import type { ToolDef, ToolResult } from '../../ai/tai/tools/types.js'
import { createApiCaller } from '../../ai/tai/internal.js'
import { getStringSetting } from '../../../lib/appSettings.js'
import { notify } from '../../notifications/push.js'
import type { TgClub } from '../club.js'
import type { TgPerson } from '../identity.js'
import { forwardTodayPoll, gameConfigs, gamesFromChats, nextNight, nightLabel, todaysPolls, upcomingNights } from '../games.js'
import { markBlocked, rememberNote, updateContact } from './memory.js'

export interface ClientSession {
  club: TgClub
  person: TgPerson
  contact: TaiContact
  /** Чат лички (совпадает с tg_id). */
  chatId: string
}

/** Что Tai рассказывает о форматах клуба, если владелец не написал своё. */
export const DEFAULT_CLUB_BRIEF = [
  'Городская мафия — психологическая игра для всех, с ведущим; новичкам правила объясняют прямо перед игрой, подготовка не нужна.',
  'Спортивная мафия — строгие правила, турниры и рейтинг на GoMafia; для тех, кто хочет играть всерьёз, есть школа мафии.',
  'Ещё клуб проводит дни рождения, корпоративы, детскую мафию и тематические вечеринки; можно прийти компанией на настольные игры.',
].join('\n')

const KIND_PARAM = { type: 'string', enum: ['sport', 'city', 'any'], description: 'sport — спортивная мафия, city — городская, any — любая' }
const GAMES_LABEL: Record<string, string> = { sport: 'спортивная', city: 'городская', both: 'обе' }
const REMIND_HOUR_MSK = 12
const MSK_MS = 3 * 3600_000
const VISITS_SINCE_DAYS = 365

function rub(n: number): string {
  return `${Math.round(n).toLocaleString('ru-RU')} ₽`
}

const clubInfo = (s: ClientSession): ToolDef => ({
  name: 'club_info',
  description: 'Информация о клубе: адрес, часы работы, цены входа на вечер, аренда зала и кабинок, форматы игр и мероприятий.',
  parameters: { type: 'object', properties: {} },
  status: () => 'Смотрю информацию о клубе…',
  async run(): Promise<ToolResult> {
    const api = createApiCaller({ host: s.club.host })
    type SiteConfig = {
      venue: { name: string; address: string; hoursOpen: string; hoursClose: string }
      eveningPrices: { name: string; price: number }[]
      eventRates: { hours: number; price: number }[]
      zones: { name: string; hourlyRate: number }[]
    }
    const [config, brief] = await Promise.all([
      api.get<SiteConfig>('/api/site/config').catch(() => null),
      getStringSetting('tai_club_brief', '', s.club.db).catch(() => ''),
    ])
    return {
      data: {
        name: config?.venue.name ?? s.club.name,
        address: config?.venue.address || null,
        hours: config?.venue.hoursOpen ? `${config.venue.hoursOpen}–${config.venue.hoursClose}` : null,
        eveningPrices: config?.eveningPrices.map((p) => `${p.name}: ${rub(p.price)}`) ?? [],
        eventRental: config?.eventRates.map((r) => `${r.hours} ч — ${rub(r.price)}`) ?? [],
        zones: config?.zones.map((z) => `${z.name}: ${rub(z.hourlyRate)}/ч`) ?? [],
        about: brief.trim() || DEFAULT_CLUB_BRIEF,
      },
      memo: 'рассказал о клубе',
    }
  },
})

const gameNights = (s: ClientSession): ToolDef => ({
  name: 'game_nights',
  description: 'Ближайшие игровые вечера (спортивная и городская мафия) с датой и временем, и открыт ли сегодня опрос записи.',
  parameters: { type: 'object', properties: {} },
  status: () => 'Смотрю расписание…',
  async run(): Promise<ToolResult> {
    const configs = await gameConfigs(s.club.db)
    const polls = await todaysPolls(s.club.db)
    const nights = upcomingNights(configs, 8).map((n) => ({
      ...n,
      pollOpen: n.today && polls.some((p) => p.kind === n.kind),
    }))
    return { data: { nights: nights.slice(0, 6), note: 'Время — начало игры. Записаться — проголосовать «Да» в опросе.' }, memo: 'показал расписание игр' }
  },
})

const myAccount = (s: ClientSession): ToolDef => ({
  name: 'my_account',
  description: 'Свой профиль в клубе: статус, депозит/долг, бонусы, сколько раз был и когда последний раз, последние операции.',
  parameters: { type: 'object', properties: {} },
  status: () => 'Смотрю твой профиль…',
  async run(): Promise<ToolResult> {
    const p = s.person.profile
    if (!p) return { data: { error: 'Telegram не привязан к профилю клуба. Привязка — через вход в приложение My Titan или у администратора.' } }
    const db = s.club.db
    const since = new Date(Date.now() - VISITS_SINCE_DAYS * 86_400_000)
    const [[tier], [visits], recent] = await Promise.all([
      db.select({ label: clientTiers.label }).from(clientTiers).where(eq(clientTiers.key, p.clientTier)).limit(1),
      db.select({ n: count(), last: max(checks.closedAt) }).from(checks)
        .where(and(eq(checks.playerId, p.id), eq(checks.status, 'closed'), gt(checks.closedAt, since))),
      db.select({ type: transactions.type, amount: transactions.amount, description: transactions.description, at: transactions.createdAt })
        .from(transactions).where(eq(transactions.playerId, p.id)).orderBy(desc(transactions.createdAt)).limit(5),
    ])
    const balance = Number(p.balance) || 0
    return {
      data: {
        nickname: p.nickname,
        status: tier?.label ?? p.clientTier,
        deposit: balance > 0 ? rub(balance) : null,
        debt: balance < 0 ? rub(-balance) : null,
        bonus: Math.round(Number(p.bonusPoints) || 0),
        visitsLastYear: Number(visits?.n ?? 0),
        lastVisit: visits?.last ? new Date(visits.last).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', day: 'numeric', month: 'long' }) : null,
        pendingRegistration: p.registrationStatus === 'pending',
        recent: recent.map((t) => `${t.type}: ${rub(Number(t.amount))}${t.description ? ` — ${t.description}` : ''}`),
        notificationsOn: p.walletNotifyEnabled !== false,
      },
      memo: 'показал профиль клиента',
    }
  },
})

const remember = (s: ClientSession): ToolDef => ({
  name: 'remember',
  description:
    'Запомнить о человеке: во что играет (sport/city/both), факт из разговора (имя, когда удобно, предпочтения), ' +
    'просьбу больше не писать первым (stop_messages) или снова писать (resume_messages). Вызывай, как только узнал что-то полезное.',
  parameters: {
    type: 'object',
    properties: {
      games: { type: 'string', enum: ['sport', 'city', 'both'] },
      note: { type: 'string', description: 'Короткий факт, до 150 знаков' },
      stop_messages: { type: 'boolean', description: 'Человек просит не писать ему / жёстко отказался' },
      resume_messages: { type: 'boolean' },
    },
  },
  status: () => '',
  async run(args): Promise<ToolResult> {
    const games = args['games']
    const patch: Parameters<typeof updateContact>[2] = {}
    if (games === 'sport' || games === 'city' || games === 'both') patch.games = games as TaiGames
    if (args['stop_messages'] === true) Object.assign(patch, { optedOut: true, remindAt: null, remindKind: null })
    if (args['resume_messages'] === true) patch.optedOut = false
    await updateContact(s.club.db, s.person.tgId, patch)
    if (typeof args['note'] === 'string') await rememberNote(s.club.db, s.person.tgId, args['note'])
    return { data: { ok: true } }
  },
})

const remindNextGame = (s: ClientSession): ToolDef => ({
  name: 'remind_next_game',
  description: 'Человек сегодня не может, но не против прийти в другой раз — напомнить ему в день следующей игры.',
  parameters: { type: 'object', properties: { kind: KIND_PARAM }, required: ['kind'] },
  status: () => '',
  async run(args): Promise<ToolResult> {
    const kind = typeof args['kind'] === 'string' ? args['kind'] : 'any'
    const night = nextNight(await gameConfigs(s.club.db), kind)
    if (!night) return { data: { error: 'Следующая игра не найдена в расписании' } }
    const remindAt = new Date(`${night.date}T${String(REMIND_HOUR_MSK).padStart(2, '0')}:00:00+03:00`)
    await updateContact(s.club.db, s.person.tgId, { remindAt, remindKind: night.kind })
    return { data: { ok: true, remindOn: nightLabel(night) }, memo: `напомню: ${nightLabel(night)}` }
  },
})

const sendPoll = (s: ClientSession): ToolDef => ({
  name: 'send_poll',
  description: 'Прислать сюда сегодняшний опрос записи на игру — человек отметится прямо в личке.',
  parameters: { type: 'object', properties: { kind: KIND_PARAM } },
  status: () => 'Достаю опрос…',
  async run(args): Promise<ToolResult> {
    const kind = typeof args['kind'] === 'string' ? args['kind'] : null
    const r = await forwardTodayPoll(s.club.db, s.club.bot, s.chatId, kind)
    if (r.status === 'sent') return { data: { ok: true, poll: r.poll.title, hint: 'Опрос уже в чате выше — пусть отметится «Да».' }, memo: `прислал опрос «${r.poll.title}»` }
    if (r.status === 'blocked') await markBlocked(s.club.db, s.person.tgId)
    if (r.status === 'no_poll') {
      const night = upcomingNights(await gameConfigs(s.club.db), 8).find((n) => !kind || kind === 'any' || n.kind === kind)
      return { data: { error: 'Сегодня опроса нет', nextGame: night ? nightLabel(night) : null } }
    }
    return { data: { error: 'Не удалось переслать опрос' } }
  },
})

async function createSignup(db: Database, s: ClientSession, night: { title: string; kind: string; date: string; time: string }, guests: number, comment: string | null): Promise<'created' | 'duplicate'> {
  const startsAt = `${night.date}T${night.time || '20:00'}:00+03:00`
  const name = s.person.profile?.fullName || s.person.profile?.nickname || [s.person.user.first_name, s.person.user.last_name].filter(Boolean).join(' ') || 'Гость из Telegram'
  const meta = { source: 'tai', evening: night.kind, tgId: s.person.tgId, telegram: s.person.user.username ? `@${s.person.user.username}` : null, profileId: s.person.profile?.id ?? null }
  const dup = await db.execute(sql`
    SELECT id FROM bookings
    WHERE source = 'tai' AND kind = 'game' AND status = 'new' AND meta->>'tgId' = ${s.person.tgId}
      AND starts_at = ${startsAt}::timestamptz
    LIMIT 1
  `)
  const rows = (Array.isArray(dup) ? dup : (dup as { rows?: unknown[] }).rows ?? []) as unknown[]
  if (rows.length) return 'duplicate'
  const lines = [s.person.profile ? `Клиент: ${s.person.profile.nickname}` : 'Новичок из Telegram', meta.telegram ? `Telegram: ${meta.telegram}` : '', comment ?? ''].filter(Boolean).join('\n')
  await db.execute(sql`
    INSERT INTO bookings (name, phone, guests, starts_at, comment, status, source, location, title, kind, meta)
    VALUES (${name}, ${s.person.profile?.phone ?? ''}, ${guests}, ${startsAt}::timestamptz, ${lines}, 'new', 'tai', 'titan',
            ${`Запись на игру · ${night.title}`}, 'game', ${JSON.stringify(meta)}::jsonb)
  `)
  return 'created'
}

const signUp = (s: ClientSession): ToolDef => ({
  name: 'sign_up',
  description: 'Записать человека на игру (сегодня или на ближайший вечер нужного вида) — администраторы увидят заявку.',
  parameters: {
    type: 'object',
    properties: {
      kind: KIND_PARAM,
      guests: { type: 'number', description: 'Сколько человек придёт вместе с ним, включая его' },
      comment: { type: 'string', description: 'Что важно знать администратору (новичок, придёт позже и т.п.)' },
    },
    required: ['kind'],
  },
  status: () => 'Записываю…',
  async run(args): Promise<ToolResult> {
    const kind = typeof args['kind'] === 'string' ? args['kind'] : 'any'
    const night = upcomingNights(await gameConfigs(s.club.db), 8).find((n) => kind === 'any' || n.kind === kind)
    if (!night) return { data: { error: 'Ближайшей игры такого вида нет в расписании' } }
    const guests = Math.min(Math.max(Math.round(Number(args['guests']) || 1), 1), 20)
    const comment = typeof args['comment'] === 'string' ? args['comment'].slice(0, 300) : null
    const result = await createSignup(s.club.db, s, night, guests, comment)
    if (result === 'created') {
      const who = s.person.profile?.nickname ?? (s.person.user.first_name || 'Новичок')
      void notify({
        type: 'site_request',
        title: '🎲 Запись через Tai',
        body: `${who}${s.person.profile ? '' : ' (новичок)'} · ${nightLabel(night)}${guests > 1 ? ` · ${guests} чел.` : ''}`,
        meta: { url: '/events' },
      }, s.club.db, s.club.id).catch(() => {})
    }
    const polls = await todaysPolls(s.club.db)
    return {
      data: { ok: true, night: nightLabel(night), already: result === 'duplicate', pollToday: night.today && polls.some((p) => p.kind === night.kind) },
      memo: `записал на ${nightLabel(night)}`,
    }
  },
})

const callAdmin = (s: ClientSession): ToolDef => ({
  name: 'call_admin',
  description: 'Передать вопрос живому администратору: бронь мероприятия, жалоба, оплата, всё, что ты сам не решишь.',
  parameters: { type: 'object', properties: { summary: { type: 'string', description: 'Суть вопроса одной-двумя фразами' } }, required: ['summary'] },
  status: () => 'Передаю администратору…',
  async run(args): Promise<ToolResult> {
    const summary = String(args['summary'] ?? '').slice(0, 400)
    const who = s.person.profile?.nickname ?? (s.person.user.first_name || 'Гость')
    const contact = s.person.user.username ? `@${s.person.user.username}` : s.person.profile?.phone ?? ''
    await notify({
      type: 'site_request',
      title: '💬 Вопрос клиента через Tai',
      body: `${who}${contact ? ` (${contact})` : ''}: ${summary}`,
      meta: { url: '/events', ...(s.person.profile ? { playerId: s.person.profile.id } : {}) },
    }, s.club.db, s.club.id).catch(() => {})
    return { data: { ok: true, hint: 'Администратор свяжется в Telegram или по телефону.' }, memo: 'передал вопрос администратору' }
  },
})

const notificationsToggle = (s: ClientSession): ToolDef => ({
  name: 'notifications',
  description: 'Включить или выключить уведомления о бонусах, депозите и долге в Telegram.',
  parameters: { type: 'object', properties: { on: { type: 'boolean' } }, required: ['on'] },
  status: () => '',
  async run(args): Promise<ToolResult> {
    const p = s.person.profile
    if (!p) return { data: { error: 'Нет профиля клуба' } }
    await s.club.db.update(profiles).set({ walletNotifyEnabled: args['on'] === true }).where(eq(profiles.id, p.id))
    return { data: { ok: true, on: args['on'] === true } }
  },
})

/** Инструменты разговора с клиентом. */
export function clientTools(s: ClientSession): ToolDef[] {
  return [clubInfo(s), gameNights(s), myAccount(s), remember(s), remindNextGame(s), sendPoll(s), signUp(s), callAdmin(s), notificationsToggle(s)]
}

/** То, что сотрудник может спросить о себе как игрок. */
export function selfTools(s: ClientSession): ToolDef[] {
  return [gameNights(s), myAccount(s)]
}

/** Во что играет человек: сказал сам, иначе — по чатам клуба, где его видел бот. */
export async function knownGames(s: Pick<ClientSession, 'club' | 'person' | 'contact'>): Promise<TaiGames | null> {
  return s.contact.games ?? (await gamesFromChats(s.club.db, s.person.tgId))
}

export const gamesLabel = (games: TaiGames | null): string => (games ? GAMES_LABEL[games] ?? games : 'неизвестно')

/** «Сегодня» по МСК — для промпта. */
export function mskToday(): string {
  return new Date(Date.now() + MSK_MS).toISOString().slice(0, 10)
}
