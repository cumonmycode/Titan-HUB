/**
 * Tai ведёт заявки с сайта. Гость после формы сразу попадает к Tai (t.me/<бот>?start=r_…),
 * Tai знает, кто пишет и по какой заявке: консультирует, уточняет детали, сам подтверждает
 * запись (игра — «ждём», мероприятие — создаёт мероприятие, если время свободно) и
 * присылает отчёт в рабочий чат. Не знает ответа — спрашивает коллег в рабочем чате;
 * сотрудник отвечает реплаем, и Tai продолжает разговор с гостем уже с этим ответом.
 */
import { sql, profiles, spaces, taiContacts, eq, and, isNull, type Database, type TaiContact } from '@titan/database'
import type { ToolDef, ToolResult } from '../../ai/tai/tools/types.js'
import { decideBooking } from '../../bookings/bookings.router.js'
import { startError } from '../../bookings/publicGuards.js'
import { loadRequest, notifyRequestStatus, postToWorkChat, requestStaffText, whenOf, whereOf, type RequestRow } from '../../requests/notify.js'
import { notify } from '../../notifications/push.js'
import type { TgClub } from '../club.js'
import { displayName, whoIs, type TgPerson } from '../identity.js'
import type { TgMessage, TgUser } from '../types.js'
import type { ClientSession } from './client-tools.js'

const ACTIVE_DAYS = 60
const KIND_LABEL: Record<string, string> = { game: 'запись на игру', event: 'мероприятие', message: 'сообщение' }
const STATUS_LABEL: Record<string, string> = { new: 'новая, ждёт подтверждения', confirmed: 'подтверждена' }
export const SERVICE_PREFIX = '[Служебно]'

function rows<T>(res: unknown): T[] {
  return ((res as { rows?: unknown[] }).rows ?? (res as unknown[])) as T[]
}
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Открытые заявки гостя, привязанные к этому чату (новые и подтверждённые). */
export async function activeRequests(db: Database, chatId: string): Promise<RequestRow[]> {
  const res = await db.execute(sql`
    SELECT id FROM bookings
    WHERE guest_tg_chat = ${chatId} AND status IN ('new', 'confirmed')
      AND created_at > now() - make_interval(days => ${ACTIVE_DAYS}::int)
    ORDER BY created_at DESC LIMIT 3
  `)
  const out: RequestRow[] = []
  for (const r of rows<{ id: string }>(res)) {
    const row = await loadRequest(db, r.id)
    if (row) out.push(row)
  }
  return out
}

function requestLine(r: RequestRow, i: number): string {
  const parts = [
    `${i + 1}) [request_id: ${r.id}] «${r.title || 'Заявка'}» (${KIND_LABEL[r.kind] ?? r.kind})`,
    whenOf(r) ? `когда: ${whenOf(r)}${r.tariff_hours ? `, ${Number(r.tariff_hours)} ч` : ''}` : '',
    whereOf(r) ? `где: ${whereOf(r)}` : '',
    r.guests ? `гостей: ${r.guests}` : '',
    `имя в заявке: ${r.name}${r.phone ? `, телефон ${r.phone}` : ''}`,
    `статус: ${STATUS_LABEL[r.status] ?? r.status}`,
    r.comment ? `комментарий: ${r.comment.replace(/\s+/g, ' ').slice(0, 400)}` : '',
  ]
  return parts.filter(Boolean).join('; ')
}

/** Дополнение к промпту клиента, если у него есть заявка с сайта. */
export function requestPrompt(list: RequestRow[]): string {
  if (!list.length) return ''
  return [
    '',
    'Этот человек оставил заявку на сайте клуба и пришёл к тебе из неё — ты ведёшь её от начала до конца:',
    ...list.map(requestLine),
    'Как вести заявку:',
    '- Обращайся по имени из заявки. Покажи, что знаешь, о чём заявка, — не переспрашивай то, что уже указано.',
    '- Запись на игру: расскажи, как всё устроено и как найти клуб, уточни, сколько человек придёт; как только человек подтверждает, что придёт, — confirm_request.',
    '- Мероприятие: проконсультируй (форматы, длительность, цены и зоны — из club_info), уточни недостающее (дата, время, гостей, часы, зона, пожелания) и меняй заявку через update_request. Когда всё согласовано и человек согласен — confirm_request с коротким итогом. Если время занято — предложи другое.',
    '- Не знаешь ответа или нужна договорённость с клубом (особые условия, скидка, нестандартная просьба, точная цена под запрос) — ask_staff и скажи гостю, что уточняешь у коллег и вернёшься с ответом. Не выдумывай.',
    '- Человек передумал — cancel_request с причиной.',
    `- Сообщения, начинающиеся с «${SERVICE_PREFIX}», пишет не гость, а система (например, ответ коллеги на твой вопрос). Гость их не видит: используй сведения и сам напиши гостю.`,
  ].join('\n')
}

async function anyOwnerId(db: Database): Promise<string | null> {
  const [o] = await db.select({ id: profiles.id }).from(profiles).where(and(eq(profiles.role, 'owner'), isNull(profiles.deletedAt))).limit(1)
  return o?.id ?? null
}

function pick(list: RequestRow[], args: Record<string, unknown>): RequestRow | { error: string } {
  const id = typeof args['request_id'] === 'string' ? args['request_id'] : null
  // Без id: единственная заявка, иначе единственная ещё не подтверждённая (о ней и речь).
  const fresh = list.filter((r) => r.status === 'new')
  const found = id ? list.find((r) => r.id === id) : list.length === 1 ? list[0] : fresh.length === 1 ? fresh[0] : null
  return found ?? { error: list.length ? 'Укажи request_id одной из заявок гостя' : 'У гостя нет открытых заявок' }
}

const REQUEST_ID = { type: 'string', description: 'request_id заявки из списка (если заявка одна — можно не указывать)' }

function updateRequest(s: ClientSession, list: RequestRow[]): ToolDef {
  return {
    name: 'update_request',
    description: 'Изменить заявку гостя по итогам разговора: дату, время, число гостей, часы, зону в клубе, добавить заметку для администратора.',
    parameters: {
      type: 'object',
      properties: {
        request_id: REQUEST_ID,
        date: { type: 'string', description: 'YYYY-MM-DD' },
        time: { type: 'string', description: 'HH:MM по Москве' },
        guests: { type: 'number' },
        hours: { type: 'number', description: 'Сколько часов мероприятие' },
        zone: { type: 'string', description: 'Название зоны клуба (для мероприятия в клубе)' },
        note: { type: 'string', description: 'Что важно знать администратору (пожелания, детали)' },
      },
    },
    status: () => 'Обновляю заявку…',
    async run(args): Promise<ToolResult> {
      const r = pick(list, args)
      if ('error' in r) return { data: r }
      if (r.status !== 'new') return { data: { error: 'Заявка уже подтверждена — изменения согласуй через ask_staff' } }
      const db = s.club.db
      const sets = []
      const date = typeof args['date'] === 'string' ? args['date'] : null
      const time = typeof args['time'] === 'string' ? args['time'] : null
      if (date || time) {
        const cur = new Date(new Date(r.starts_at).getTime() + 3 * 3600_000).toISOString()
        const d = date ?? cur.slice(0, 10)
        const t = time ?? cur.slice(11, 16)
        const bad = startError(d, t)
        if (bad) return { data: { error: bad } }
        sets.push(sql`starts_at = ${`${d}T${t}:00+03:00`}::timestamptz`)
      }
      const guests = Number(args['guests'])
      if (Number.isFinite(guests) && guests >= 1 && guests <= 500) sets.push(sql`guests = ${Math.round(guests)}`)
      const hours = Number(args['hours'])
      if (Number.isFinite(hours) && hours >= 1 && hours <= 24) sets.push(sql`tariff_hours = ${Math.round(hours)}`)
      if (typeof args['zone'] === 'string' && args['zone'].trim()) {
        const want = args['zone'].trim().toLowerCase()
        const zones = await db.select({ id: spaces.id, name: spaces.name }).from(spaces).where(eq(spaces.isActive, true))
        const zone = zones.find((z) => z.name.toLowerCase() === want) ?? zones.find((z) => z.name.toLowerCase().includes(want))
        if (!zone) return { data: { error: `Зоны «${args['zone']}» нет`, zones: zones.map((z) => z.name) } }
        sets.push(sql`space_id = ${zone.id}, location = 'titan'`)
      }
      if (typeof args['note'] === 'string' && args['note'].trim()) {
        sets.push(sql`comment = concat_ws(E'\n', comment, ${`Tai: ${args['note'].trim().slice(0, 300)}`}::text)`)
      }
      if (!sets.length) return { data: { error: 'Нечего менять' } }
      await db.execute(sql`UPDATE bookings SET ${sql.join(sets, sql`, `)}, updated_at = now() WHERE id = ${r.id}`)
      const fresh = await loadRequest(db, r.id)
      return { data: { ok: true, request: fresh ? requestLine(fresh, 0) : null }, memo: 'обновил заявку' }
    },
  }
}

function confirmRequest(s: ClientSession, list: RequestRow[]): ToolDef {
  return {
    name: 'confirm_request',
    description: 'Подтвердить заявку, когда всё согласовано и гость согласен: игра — «ждём», мероприятие — бронь в календаре клуба. Отчёт уйдёт в рабочий чат.',
    parameters: {
      type: 'object',
      properties: { request_id: REQUEST_ID, summary: { type: 'string', description: 'Итог разговора для администратора: что договорились, пожелания' } },
      required: ['summary'],
    },
    status: () => 'Подтверждаю…',
    async run(args): Promise<ToolResult> {
      const r = pick(list, args)
      if ('error' in r) return { data: r }
      if (r.status === 'confirmed') return { data: { ok: true, already: true } }
      const db = s.club.db
      const actor = await anyOwnerId(db)
      if (!actor) return { data: { error: 'Не могу подтвердить — передай администратору (call_admin)' } }
      const result = await decideBooking(db, r.id, 'confirmed', actor)
      if (result.kind === 'conflict') {
        return { data: { error: `На это время зона занята: «${result.event.title}» ${result.event.startTime}–${result.event.endTime ?? ''}. Предложи гостю другое время или зону.` } }
      }
      if (result.kind !== 'ok') return { data: { error: result.kind === 'refused' ? result.error : 'Заявка не найдена' } }
      const hub = `https://${s.club.host}`
      await notifyRequestStatus(db, r.id, 'confirmed', 'Tai', hub, { guest: false })
      const fresh = (await loadRequest(db, r.id)) ?? r
      const summary = String(args['summary'] ?? '').slice(0, 800)
      await postToWorkChat(db, `🤖 <b>Tai подтвердил заявку</b>\n${requestStaffText(fresh)}${summary ? `\n\n📝 ${esc(summary)}` : ''}`, fresh.staff_tg_message_id ? Number(fresh.staff_tg_message_id) : null)
      void notify({ type: 'site_request', title: '🤖 Tai подтвердил заявку', body: [fresh.title, fresh.name, whenOf(fresh)].filter(Boolean).join(' · '), meta: { bookingId: r.id, url: '/events' } }, db, s.club.id).catch(() => {})
      return { data: { ok: true, when: whenOf(fresh), where: whereOf(fresh), eventCreated: !!result.eventId }, memo: `подтвердил заявку «${fresh.title}»` }
    },
  }
}

function askStaff(s: ClientSession, list: RequestRow[]): ToolDef {
  return {
    name: 'ask_staff',
    description: 'Спросить коллег в рабочем чате, когда не знаешь ответа гостю. Ответ придёт позже — ты продолжишь разговор, когда сотрудник ответит.',
    parameters: { type: 'object', properties: { request_id: REQUEST_ID, question: { type: 'string', description: 'Вопрос коллегам: коротко и с контекстом' } }, required: ['question'] },
    status: () => 'Уточняю у коллег…',
    async run(args): Promise<ToolResult> {
      const r = pick(list, args)
      const req = 'error' in r ? null : r
      const question = String(args['question'] ?? '').trim().slice(0, 600)
      if (!question) return { data: { error: 'Пустой вопрос' } }
      const who = req ? `${esc(req.name)}${req.phone ? ` · ${esc(req.phone)}` : ''}` : esc(displayName(s.person))
      const html = [
        `❓ <b>Tai уточняет</b>${req ? ` по заявке «${esc(req.title || 'Заявка')}»` : ''}`,
        `👤 ${who}`,
        '',
        esc(question),
        '',
        '<i>Ответьте реплаем на это сообщение — Tai передаст гостю.</i>',
      ].join('\n')
      const posted = await postToWorkChat(s.club.db, html, req?.staff_tg_message_id ? Number(req.staff_tg_message_id) : null)
      if (!posted) return { data: { error: 'Рабочий чат персонала не подключён — передай вопрос через call_admin' } }
      await s.club.db.execute(sql`
        INSERT INTO tai_request_questions (booking_id, guest_chat, guest_tg_id, question, staff_chat, staff_message_id)
        VALUES (${req?.id ?? null}, ${s.chatId}, ${s.person.tgId}, ${question}, ${posted.chatId}, ${posted.messageId})
      `)
      return { data: { ok: true, hint: 'Скажи гостю, что уточняешь у коллег и напишешь, как будет ответ.' }, memo: 'спросил коллег в рабочем чате' }
    },
  }
}

function cancelRequest(s: ClientSession, list: RequestRow[]): ToolDef {
  return {
    name: 'cancel_request',
    description: 'Гость передумал или отказался — отменить заявку (с причиной).',
    parameters: { type: 'object', properties: { request_id: REQUEST_ID, reason: { type: 'string' } }, required: ['reason'] },
    status: () => 'Отменяю заявку…',
    async run(args): Promise<ToolResult> {
      const r = pick(list, args)
      if ('error' in r) return { data: r }
      const db = s.club.db
      const actor = await anyOwnerId(db)
      if (!actor) return { data: { error: 'Не могу отменить — передай администратору' } }
      const result = await decideBooking(db, r.id, 'cancelled', actor)
      if (result.kind !== 'ok') return { data: { error: result.kind === 'refused' ? result.error : 'Заявка не найдена' } }
      await notifyRequestStatus(db, r.id, 'cancelled', 'Tai', `https://${s.club.host}`, { guest: false })
      const reason = String(args['reason'] ?? '').slice(0, 300)
      await postToWorkChat(db, `🤖 <b>Гость отказался от заявки</b> «${esc(r.title || 'Заявка')}» — ${esc(r.name)}${reason ? `\nПричина: ${esc(reason)}` : ''}`, r.staff_tg_message_id ? Number(r.staff_tg_message_id) : null)
      return { data: { ok: true }, memo: 'отменил заявку' }
    },
  }
}

/** Инструменты заявки — только если у гостя есть открытая заявка. */
export function requestTools(s: ClientSession, list: RequestRow[]): ToolDef[] {
  if (!list.length) return []
  return [updateRequest(s, list), confirmRequest(s, list), askStaff(s, list), cancelRequest(s, list)]
}

/** Первое слово Tai гостю, пришедшему из заявки (вместо «Старт»). */
export function requestIntro(r: { title: string | null }): string {
  return `${SERVICE_PREFIX} Гость только что перешёл к тебе из заявки на сайте («${r.title || 'Заявка'}»). Поздоровайся по имени, подтверди, что заявку получил, и начни консультацию: спроси то, что нужно уточнить.`
}

interface QuestionRow { id: string; guest_chat: string; guest_tg_id: string; question: string }
export type GuestReply = (club: TgClub, guest: TgPerson, contact: TaiContact, chatId: string, text: string) => Promise<void>

/**
 * Сотрудник ответил реплаем на вопрос Tai в рабочем чате. true — это был ответ на вопрос
 * (обработан); false — обычное сообщение. text — текст ответа (голосовое уже распознано).
 */
export async function handleStaffAnswer(club: TgClub, msg: TgMessage, text: string, replyToGuest: GuestReply): Promise<boolean> {
  const reply = msg.reply_to_message
  if (!reply?.from?.is_bot || !msg.from) return false
  const res = await club.db.execute(sql`
    SELECT id, guest_chat, guest_tg_id, question FROM tai_request_questions
    WHERE staff_chat = ${String(msg.chat.id)} AND staff_message_id = ${reply.message_id}
    LIMIT 1
  `)
  const q = rows<QuestionRow>(res)[0]
  if (!q) return false
  const staff = await whoIs(club.db, msg.from)
  const base = { threadId: msg.message_thread_id ?? null, replyTo: msg.message_id }
  if (!staff.staff) {
    await club.bot.send(msg.chat.id, 'Ответить гостю может только сотрудник клуба 🙂', base)
    return true
  }
  if (!text.trim()) return true
  await club.db.execute(sql`
    UPDATE tai_request_questions SET status = 'answered', answer = ${text.slice(0, 2000)}, answered_by = ${displayName(staff)}, answered_at = now()
    WHERE id = ${q.id}
  `)
  await club.bot.send(msg.chat.id, 'Принял, передаю гостю ✅', base)

  const [contact] = await club.db.select().from(taiContacts).where(eq(taiContacts.tgId, q.guest_tg_id)).limit(1)
  if (!contact) return true
  const user: TgUser = { id: Number(q.guest_tg_id), is_bot: false, first_name: contact.firstName ?? 'Гость', ...(contact.username ? { username: contact.username } : {}) }
  const guest = await whoIs(club.db, user)
  const note = `${SERVICE_PREFIX} Коллега ${displayName(staff)} ответил на твой вопрос «${q.question}»: «${text.slice(0, 1500)}». Продолжи разговор с гостем с учётом этого ответа — напиши ему сам.`
  void replyToGuest(club, guest, contact, q.guest_chat, note).catch((e) => console.error('[tai] ответ гостю после уточнения не ушёл:', e))
  return true
}
