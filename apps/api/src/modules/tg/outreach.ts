/**
 * Tai пишет первым — по поводу и без спама:
 *  • напоминание: человек сказал «сегодня не могу» — зовём в день следующей игры;
 *  • игровой день: опрос выложен, а человек (играет в этот вид) не отметился;
 *  • новичок замолчал — одно мягкое «ну что, получится заглянуть?»;
 *  • по просьбе администратора (опрос клиенту) — composeInvite из tai.router.
 *
 * Ограничения: только тем, кто сам писал Tai (Telegram не даёт боту писать
 * первым), не тем, кто просил не писать, не сотрудникам, не чаще раза в 3 дня,
 * после трёх сообщений без ответа — пауза на месяц, и только днём (11:00–21:30 МСК).
 */
import { taiContacts, profiles, eq, and, or, lt, lte, isNull, isNotNull, inArray, type Database, type Profile, type TaiContact } from '@titan/database'
import { voteMapOfPoll } from '../../lib/pollState.js'
import { resolveClubByHost } from '../../lib/clubResolver.js'
import { aiAllowed } from '../../middleware/module.js'
import { isBlocked } from '../../lib/tgBot.js'
import { resolveApiKey, streamChat } from '../ai/tai/llm.js'
import { getTaiSettings } from '../ai/tai/settings.js'
import { clubForDb, type TgClub } from './club.js'
import { isStaffRole } from './identity.js'
import { forwardTodayPoll, gameConfigs, gamesFromChats, nextNight, nightFits, nightLabel, todaysPolls, upcomingNights } from './games.js'
import { appendMessage, markBlocked, markOutbound, recentTurns, updateContact } from './dialog/memory.js'

const MSK_MS = 3 * 3600_000
const DAY_MS = 86_400_000
const QUIET_FROM_MIN = 11 * 60
const QUIET_TO_MIN = 21 * 60 + 30
// Звать в игровой день — с полудня до семи вечера.
const INVITE_FROM_MIN = 12 * 60
const INVITE_TO_MIN = 19 * 60
const MIN_GAP_MS = 3 * DAY_MS
const ACTIVE_CHAT_MS = 2 * 3600_000
const MAX_UNANSWERED = 3
const RETRY_AFTER_SILENCE_MS = 30 * DAY_MS
const FOLLOWUP_AFTER_MS = 20 * 3600_000
const PER_TICK = 15
const SEND_PAUSE_MS = 1_500

export type InviteReason = 'staff' | 'reminder' | 'game_day' | 'followup'

function mskMinutes(): number {
  const d = new Date(Date.now() + MSK_MS)
  return d.getUTCHours() * 60 + d.getUTCMinutes()
}

const REASON: Record<InviteReason, (o: { title: string; time: string; note: string | null }) => string> = {
  staff: (o) => `Администратор клуба попросил отправить ему опрос записи на сегодня — «${o.title}»${o.time ? ` в ${o.time}` : ''}. Опрос придёт следующим сообщением.${o.note ? ` Администратор просил передать: «${o.note}».` : ''}`,
  reminder: (o) => `В прошлый раз он не смог прийти, и ты обещал напомнить. Сегодня «${o.title}»${o.time ? ` в ${o.time}` : ''}. Позови, опрос придёт следующим сообщением.`,
  game_day: (o) => `Сегодня «${o.title}»${o.time ? ` в ${o.time}` : ''}, а он ещё не отметился в опросе. Позови легко, без давления; опрос придёт следующим сообщением.`,
  followup: (o) => `Недавно вы общались, он новенький и замолчал. Мягко спроси, получится ли заглянуть — ближайшая игра: ${o.title}.`,
}

async function inviteText(club: TgClub, contact: TaiContact, profile: Profile | null, reason: InviteReason, o: { title: string; time: string; note: string | null }): Promise<string> {
  const name = profile?.nickname ?? contact.firstName ?? ''
  const fallback = reason === 'followup'
    ? `${name ? `${name}, ` : ''}привет! Ну что, получится заглянуть к нам? Ближайшая игра — ${o.title} 🙂`
    : `${name ? `${name}, ` : ''}привет! Сегодня ${o.title}${o.time ? ` в ${o.time}` : ''} — ждём тебя 🙂 Отметься в опросе ниже.`
  try {
    const history = (await recentTurns(club.db, contact.tgId, 8)).map((t) => `${t.role === 'user' ? 'Он' : 'Ты'}: ${t.content}`).join('\n').slice(-1_500)
    const system = [
      `Ты — Tai, администратор клуба «${club.name}» (спортивная и городская мафия). Пишешь человеку в Telegram первым.`,
      'Напиши ОДНО короткое сообщение: 1–2 предложения, на «ты», дружелюбно, с лёгким юмором, без мата, без давления и без канцелярита. Максимум один вопрос. Не здоровайся длинно.',
      `Кому: ${name || 'человек без имени'}${profile ? ' (клиент клуба)' : ' (новичок)'}.`,
      contact.notes ? `Что ты о нём помнишь: ${contact.notes}` : '',
      history ? `Последние сообщения:\n${history}` : '',
      `Повод: ${REASON[reason](o)}`,
      'Не выдумывай фактов о клубе. Ответь только текстом сообщения.',
    ].filter(Boolean).join('\n')
    let text = ''
    for await (const chunk of streamChat({ apiKey: await resolveApiKey(club.db), messages: [{ role: 'system', content: system }, { role: 'user', content: 'Напиши сообщение.' }], tools: [], maxTokens: 200, temperature: 0.8, signal: AbortSignal.timeout(30_000) })) {
      if (chunk.type === 'text') text += chunk.text
    }
    return text.trim().replace(/^["«]|["»]$/g, '') || fallback
  } catch {
    return fallback
  }
}

/** Написать человеку первым. Возвращает, дошло ли. */
export async function composeInvite(
  club: TgClub,
  contact: TaiContact,
  profile: Profile | null,
  o: { kind: string; title: string; note: string | null; reason: InviteReason; time?: string },
): Promise<'sent' | 'blocked' | 'failed'> {
  const night = upcomingNights(await gameConfigs(club.db), 1).find((n) => n.kind === o.kind)
  const text = await inviteText(club, contact, profile, o.reason, { title: o.title, time: o.time ?? night?.time ?? '', note: o.note })
  const r = await club.bot.send(contact.tgId, text)
  if (!r.ok) return isBlocked(r) ? 'blocked' : 'failed'
  await appendMessage(club.db, { chatId: contact.tgId, role: 'assistant', content: text })
  await markOutbound(club.db, contact.tgId, true)
  return 'sent'
}

async function profilesOf(db: Database, contacts: TaiContact[]): Promise<Map<string, Profile>> {
  const ids = contacts.map((c) => c.profileId).filter((id): id is string => !!id)
  if (!ids.length) return new Map()
  const rows = await db.select().from(profiles).where(and(inArray(profiles.id, ids), isNull(profiles.deletedAt)))
  return new Map(rows.map((p) => [p.id, p]))
}

/** Можно ли сейчас писать человеку первым (частота, молчание, активный разговор). */
function mayWrite(c: TaiContact, now: number): boolean {
  if (!c.dmOpen || c.optedOut) return false
  if (c.lastProactiveAt && now - c.lastProactiveAt.getTime() < MIN_GAP_MS) return false
  if (c.lastInboundAt && now - c.lastInboundAt.getTime() < ACTIVE_CHAT_MS) return false
  if (c.followups >= MAX_UNANSWERED && c.lastProactiveAt && now - c.lastProactiveAt.getTime() < RETRY_AFTER_SILENCE_MS) return false
  return true
}

async function send(club: TgClub, c: TaiContact, p: Profile | null, kind: string, title: string, reason: InviteReason, withPoll: boolean): Promise<boolean> {
  const r = await composeInvite(club, c, p, { kind, title, note: null, reason })
  if (r === 'blocked') await markBlocked(club.db, c.tgId)
  if (r !== 'sent') return false
  if (withPoll) await forwardTodayPoll(club.db, club.bot, c.tgId, kind)
  await new Promise((resolve) => setTimeout(resolve, SEND_PAUSE_MS))
  return true
}

export async function runOutreach(db: Database, clubId: string | null): Promise<void> {
  const minutes = mskMinutes()
  if (minutes < QUIET_FROM_MIN || minutes > QUIET_TO_MIN) return
  const club = await clubForDb(db, clubId)
  if (!club) return
  if (!(await getTaiSettings(db)).outreach) return
  if (club.id && !aiAllowed(await resolveClubByHost(club.host).catch(() => null))) return

  const now = Date.now()
  const done = new Set<string>()
  let budget = PER_TICK
  const configs = await gameConfigs(db)
  const polls = await todaysPolls(db)
  const tonight = upcomingNights(configs, 1)

  // 1) Обещанные напоминания.
  const due = await db.select().from(taiContacts).where(and(isNotNull(taiContacts.remindAt), lte(taiContacts.remindAt, new Date())))
  const dueProfiles = await profilesOf(db, due)
  for (const c of due) {
    if (budget <= 0) break
    await updateContact(db, c.tgId, { remindAt: null, remindKind: null })
    const night = tonight.find((n) => !c.remindKind || c.remindKind === 'any' || n.kind === c.remindKind)
    if (!night || !c.dmOpen || c.optedOut) continue
    const p = c.profileId ? dueProfiles.get(c.profileId) ?? null : null
    if (await send(club, c, p, night.kind, night.title, 'reminder', polls.some((x) => x.kind === night.kind))) {
      done.add(c.tgId)
      budget -= 1
    }
  }

  // 2) Новичок замолчал — одно мягкое напоминание о себе.
  const silent = await db.select().from(taiContacts).where(and(
    isNull(taiContacts.profileId),
    eq(taiContacts.followups, 0),
    isNotNull(taiContacts.lastOutboundAt),
    lt(taiContacts.lastOutboundAt, new Date(now - FOLLOWUP_AFTER_MS)),
    or(isNull(taiContacts.lastInboundAt), lt(taiContacts.lastInboundAt, taiContacts.lastOutboundAt)),
  ))
  for (const c of silent) {
    if (budget <= 0) break
    if (done.has(c.tgId) || !mayWrite(c, now)) continue
    const night = nextNight(configs, c.games === 'sport' || c.games === 'city' ? c.games : 'any') ?? tonight[0]
    if (!night) continue
    if (await send(club, c, null, night.kind, nightLabel(night), 'followup', false)) {
      done.add(c.tgId)
      budget -= 1
    }
  }

  // 3) Игровой день: опрос выложен, а человек не отметился.
  if (minutes < INVITE_FROM_MIN || minutes > INVITE_TO_MIN || !polls.length) return
  const candidates = (await db.select().from(taiContacts).where(and(eq(taiContacts.dmOpen, true), eq(taiContacts.optedOut, false))))
    .filter((c) => !done.has(c.tgId) && mayWrite(c, now))
  const candProfiles = await profilesOf(db, candidates)
  for (const poll of polls) {
    const night = tonight.find((n) => n.kind === poll.kind)
    if (!night) continue
    const voted = new Set(Object.keys(await voteMapOfPoll(db, poll.pollId)))
    for (const c of candidates) {
      if (budget <= 0) return
      if (done.has(c.tgId) || voted.has(c.tgId)) continue
      const p = c.profileId ? candProfiles.get(c.profileId) ?? null : null
      // Сотрудникам про игры не напоминаем — они и так в клубе.
      if (p && isStaffRole(p.role)) continue
      const games = c.games ?? (await gamesFromChats(db, c.tgId))
      if (!nightFits(games, poll.kind)) continue
      if (await send(club, c, p, poll.kind, poll.title, 'game_day', true)) {
        done.add(c.tgId)
        budget -= 1
      }
    }
  }
}
