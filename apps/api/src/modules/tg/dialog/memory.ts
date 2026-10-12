/**
 * Память Tai: собеседники в личке (tai_contacts) и история диалогов (tai_messages).
 *
 * История нужна, чтобы Tai продолжал разговор, а не начинал с нуля, и помнил, что
 * уже обещал («напомню в субботу»). Хранится в БД клуба: переживает рестарт API.
 */
import { taiContacts, taiMessages, eq, and, desc, lt, gt, sql, type Database, type TaiContact, type TaiGames } from '@titan/database'
import type { TaiTurn } from '../../ai/tai/engine.js'

const HISTORY_LIMIT = 24
const HISTORY_DAYS = 30
const NOTES_MAX = 800
const CONTENT_MAX = 4_000
const RETENTION_DAYS = 120

export interface TgUserRef {
  id: number | string
  first_name?: string | null
  username?: string | null
}

export async function getContact(db: Database, tgId: string): Promise<TaiContact | null> {
  const [row] = await db.select().from(taiContacts).where(eq(taiContacts.tgId, tgId)).limit(1)
  return row ?? null
}

/**
 * Человек написал Tai: заводим/обновляем карточку. Раз пишет — личка открыта, а
 * счётчик сообщений «без ответа» обнуляется.
 */
export async function touchContact(db: Database, from: TgUserRef, profileId: string | null): Promise<TaiContact> {
  const tgId = String(from.id)
  const now = new Date()
  const values = {
    tgId,
    profileId,
    firstName: from.first_name ?? null,
    username: from.username ?? null,
    dmOpen: true,
    followups: 0,
    lastInboundAt: now,
    updatedAt: now,
  }
  const [row] = await db.insert(taiContacts).values(values).onConflictDoUpdate({
    target: taiContacts.tgId,
    set: {
      firstName: values.firstName,
      username: values.username,
      dmOpen: true,
      followups: 0,
      lastInboundAt: now,
      updatedAt: now,
      // Профиль появился (привязали Telegram) — запоминаем; отвязали — не затираем историю.
      ...(profileId ? { profileId } : {}),
    },
  }).returning()
  return row!
}

export interface ContactPatch {
  games?: TaiGames | null
  notes?: string | null
  optedOut?: boolean
  remindKind?: string | null
  remindAt?: Date | null
  dmOpen?: boolean
  profileId?: string | null
}

export async function updateContact(db: Database, tgId: string, patch: ContactPatch): Promise<void> {
  if (!Object.keys(patch).length) return
  await db.update(taiContacts).set({ ...patch, updatedAt: new Date() }).where(eq(taiContacts.tgId, tgId))
}

/** Добавить факт в память о человеке: свежие сверху, старые обрезаются. */
export async function rememberNote(db: Database, tgId: string, note: string): Promise<void> {
  const clean = note.trim().replace(/\s+/g, ' ').slice(0, 200)
  if (!clean) return
  const current = (await getContact(db, tgId))?.notes ?? ''
  const lines = [clean, ...current.split('\n').filter((l) => l && l !== clean)]
  let notes = ''
  for (const line of lines) {
    if ((notes + line).length > NOTES_MAX) break
    notes = notes ? `${notes}\n${line}` : line
  }
  await updateContact(db, tgId, { notes })
}

/** Tai написал человеку. proactive — первым, без его сообщения (для лимита частоты). */
export async function markOutbound(db: Database, tgId: string, proactive: boolean): Promise<void> {
  const now = new Date()
  await db.update(taiContacts).set({
    lastOutboundAt: now,
    updatedAt: now,
    ...(proactive ? { lastProactiveAt: now, followups: sql`${taiContacts.followups} + 1` } : {}),
  }).where(eq(taiContacts.tgId, tgId))
}

/** Telegram ответил 403: человек заблокировал бота — первым больше не пишем. */
export async function markBlocked(db: Database, tgId: string): Promise<void> {
  await db.update(taiContacts).set({ dmOpen: false, updatedAt: new Date() }).where(eq(taiContacts.tgId, tgId))
}

export interface StoredMessage {
  chatId: string
  tgId?: string | null
  role: 'user' | 'assistant'
  content: string
  voice?: boolean
  memo?: string | null
}

export async function appendMessage(db: Database, m: StoredMessage): Promise<void> {
  const content = m.content.trim().slice(0, CONTENT_MAX)
  if (!content) return
  await db.insert(taiMessages).values({
    chatId: m.chatId,
    tgId: m.tgId ?? null,
    role: m.role,
    content,
    voice: !!m.voice,
    memo: m.memo ? m.memo.slice(0, 1_500) : null,
  })
}

/** Последние реплики чата за месяц — в хронологическом порядке, для модели. */
export async function recentTurns(db: Database, chatId: string, limit = HISTORY_LIMIT): Promise<TaiTurn[]> {
  const since = new Date(Date.now() - HISTORY_DAYS * 86_400_000)
  const rows = await db.select().from(taiMessages)
    .where(and(eq(taiMessages.chatId, chatId), gt(taiMessages.createdAt, since)))
    .orderBy(desc(taiMessages.createdAt))
    .limit(limit)
  // Модель ждёт чередование реплик: подряд идущие одной стороны склеиваем.
  const turns: TaiTurn[] = []
  for (const row of rows.reverse()) {
    const prev = turns[turns.length - 1]
    if (prev && prev.role === row.role) {
      prev.content = `${prev.content}\n${row.content}`
      if (row.memo) prev.memo = [prev.memo, row.memo].filter(Boolean).join('; ')
    } else {
      turns.push({ role: row.role, content: row.content, ...(row.memo ? { memo: row.memo } : {}) })
    }
  }
  return turns
}

/** Старые диалоги удаляем (раз в сутки из фоновой задачи). */
export async function pruneMessages(db: Database): Promise<void> {
  await db.delete(taiMessages).where(lt(taiMessages.createdAt, new Date(Date.now() - RETENTION_DAYS * 86_400_000)))
}
