/**
 * История чатов с Tai в Titan HUB — как список чатов в Gemini. У каждого сотрудника
 * свои чаты, общие для его устройств (iPhone, iPad, веб). В реплике Tai хранятся и
 * блоки интерфейса: карточка действия или поставки после нажатия обновляется и здесь,
 * чтобы в старом чате не висела «ожидающая» кнопка.
 */
import { taiChats, taiChatTurns, and, asc, desc, eq, ilike, or, sql, type Database } from '@titan/database'
import type { TaiBlock, TaiEvent } from './blocks.js'
import { resolveApiKey, streamChat } from './llm.js'

const TITLE_MAX = 60
const NAME_MAX = 40
const LIST_LIMIT = 100
const TURNS_LIMIT = 200

export type ChatSummary = { id: string; title: string; updatedAt: Date }
export type StoredTurn = { id: number; role: 'user' | 'assistant'; content: string; blocks: TaiBlock[]; memo: string | null; createdAt: Date }

/** Заголовок до имени от Tai — начало вопроса. */
export function titleOf(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim()
  const short = line.length > TITLE_MAX ? `${line.slice(0, TITLE_MAX - 1).trimEnd()}…` : line
  return short ? short.charAt(0).toUpperCase() + short.slice(1) : 'Новый чат'
}

const likeOf = (q: string) => `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`

/** Чаты сотрудника, свежие сверху; q — поиск по заголовку и тексту реплик. */
export async function listChats(db: Database, userId: string, q?: string): Promise<ChatSummary[]> {
  const query = q?.trim()
  const mine = eq(taiChats.userId, userId)
  const where = query
    ? and(mine, or(ilike(taiChats.title, likeOf(query)), sql`exists (select 1 from tai_chat_turns t where t.chat_id = ${taiChats.id} and t.content ilike ${likeOf(query)})`))
    : mine
  return db.select({ id: taiChats.id, title: taiChats.title, updatedAt: taiChats.updatedAt }).from(taiChats).where(where).orderBy(desc(taiChats.updatedAt)).limit(LIST_LIMIT)
}

export async function ownChat(db: Database, userId: string, id: string): Promise<ChatSummary | null> {
  const [row] = await db.select({ id: taiChats.id, title: taiChats.title, updatedAt: taiChats.updatedAt }).from(taiChats).where(and(eq(taiChats.id, id), eq(taiChats.userId, userId))).limit(1)
  return row ?? null
}

export async function chatTurns(db: Database, chatId: string): Promise<StoredTurn[]> {
  const rows = await db.select().from(taiChatTurns).where(eq(taiChatTurns.chatId, chatId)).orderBy(asc(taiChatTurns.id)).limit(TURNS_LIMIT)
  return rows.map((r) => ({ id: r.id, role: r.role, content: r.content, blocks: r.blocks as TaiBlock[], memo: r.memo, createdAt: r.createdAt }))
}

export async function createChat(db: Database, userId: string, title: string): Promise<ChatSummary> {
  const [row] = await db.insert(taiChats).values({ userId, title }).returning({ id: taiChats.id, title: taiChats.title, updatedAt: taiChats.updatedAt })
  return row!
}

export async function renameChat(db: Database, userId: string, id: string, title: string): Promise<ChatSummary | null> {
  const [row] = await db
    .update(taiChats)
    .set({ title: title.trim().slice(0, TITLE_MAX) || 'Без названия' })
    .where(and(eq(taiChats.id, id), eq(taiChats.userId, userId)))
    .returning({ id: taiChats.id, title: taiChats.title, updatedAt: taiChats.updatedAt })
  return row ?? null
}

export async function deleteChat(db: Database, userId: string, id: string): Promise<boolean> {
  const rows = await db.delete(taiChats).where(and(eq(taiChats.id, id), eq(taiChats.userId, userId))).returning({ id: taiChats.id })
  return rows.length > 0
}

export async function appendTurn(db: Database, chatId: string, turn: { role: 'user' | 'assistant'; content: string; blocks?: TaiBlock[]; memo?: string | null }): Promise<void> {
  await db.insert(taiChatTurns).values({ chatId, role: turn.role, content: turn.content, blocks: turn.blocks ?? [], memo: turn.memo || null })
  await db.update(taiChats).set({ updatedAt: new Date() }).where(eq(taiChats.id, chatId))
}

/** Что Tai ответил — собирается из потока, пока ответ уходит клиенту. */
export function recordReply(emit: (event: TaiEvent) => Promise<void>) {
  const reply = { text: '', blocks: [] as TaiBlock[], memo: '' }
  const record = async (event: TaiEvent) => {
    if (event.type === 'delta') reply.text += event.text
    else if (event.type === 'block') reply.blocks.push(event.block)
    else if (event.type === 'done') reply.memo = event.memo
    await emit(event)
  }
  return { reply, emit: record }
}

/**
 * Карточка нажата (в приложении или вебе) — обновить её в сохранённых репликах.
 * kind — тип блока ('action' | 'supply'), value — новое состояние карточки.
 */
export async function updateStoredBlock(db: Database, kind: 'action' | 'supply', id: string, value: unknown): Promise<void> {
  const match = JSON.stringify([{ type: kind, [kind]: { id } }])
  const one = JSON.stringify({ type: kind, [kind]: { id } })
  await db.execute(sql`
    update tai_chat_turns set blocks = (
      select jsonb_agg(case when b @> ${one}::jsonb then jsonb_set(b, ${sql.raw(`'{${kind}}'`)}, ${JSON.stringify(value)}::jsonb) else b end order by ord)
      from jsonb_array_elements(blocks) with ordinality as e(b, ord)
    )
    where blocks @> ${match}::jsonb`)
}

/** Короткое имя чата от Tai (2–4 слова) после первого ответа — как в Gemini. */
export async function nameChat(db: Database, chatId: string, question: string, answer: string): Promise<void> {
  try {
    let name = ''
    const messages = [
      { role: 'system' as const, content: 'Придумай заголовок для чата кассы клуба: 2–4 слова по-русски, без кавычек, без точки в конце, с заглавной буквы. Ответь только заголовком.' },
      { role: 'user' as const, content: `Вопрос: ${question.slice(0, 500)}\nОтвет: ${answer.slice(0, 500)}` },
    ]
    for await (const chunk of streamChat({ apiKey: await resolveApiKey(db), messages, tools: [], maxTokens: 24, temperature: 0.2, signal: AbortSignal.timeout(15_000) })) {
      if (chunk.type === 'text') name += chunk.text
    }
    const title = name.replace(/["«»\n]/g, ' ').replace(/\s+/g, ' ').replace(/[.!]+$/, '').trim()
    if (title && title.length <= NAME_MAX) await db.update(taiChats).set({ title }).where(eq(taiChats.id, chatId))
  } catch {
    // Имя — украшение: остаётся начало вопроса.
  }
}
