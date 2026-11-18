import { appSettings, eq, type Database } from '@titan/database'

// ─────────────────────────────────────────────────────────────────────────────
// «Увиденные» ботом ГРУППЫ и ТОПИКИ — чтобы в интерфейсе выбирать их из списка,
// а не вписывать числовые ID. Telegram не отдаёт список всех групп/топиков бота,
// поэтому копим из апдейтов: бота добавили в группу (my_chat_member) / сообщение
// в группе → группа; forum_topic_created / message_thread_id → топик (+имя, если
// топик создан при боте). Хранение — app_settings клуба (ключ tg_chats), без миграции.
// Запись только при изменениях (троттлинг: большинство сообщений ничего не пишут).
// ─────────────────────────────────────────────────────────────────────────────

export const TG_CHATS_KEY = 'tg_chats'

interface TopicInfo { name: string | null }
interface ChatInfo { title: string | null; type: string | null; topics: Record<string, TopicInfo> }
type ChatsMap = Record<string, ChatInfo>

async function read(db: Database): Promise<ChatsMap> {
  try {
    const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, TG_CHATS_KEY))
    if (!row?.value) return {}
    const p = JSON.parse(row.value)
    return p && typeof p === 'object' && !Array.isArray(p) ? (p as ChatsMap) : {}
  } catch {
    return {}
  }
}

async function write(db: Database, map: ChatsMap): Promise<void> {
  const value = JSON.stringify(map)
  const [ex] = await db.select({ key: appSettings.key }).from(appSettings).where(eq(appSettings.key, TG_CHATS_KEY))
  if (ex) await db.update(appSettings).set({ value, updatedAt: new Date() }).where(eq(appSettings.key, TG_CHATS_KEY))
  else await db.insert(appSettings).values({ key: TG_CHATS_KEY, value })
}

// Зафиксировать группу/супергруппу (личку/каналы пропускаем). Пишем только при
// новой группе или смене названия.
export async function recordChat(db: Database, chat: { id?: number | string | null; title?: string | null; type?: string | null } | null | undefined): Promise<void> {
  if (!chat || chat.id == null) return
  const type = chat.type ?? null
  if (type === 'private') return // опросы — только в группы
  const id = String(chat.id)
  const map = await read(db)
  const cur = map[id]
  const title = chat.title ?? cur?.title ?? null
  const finalType = type ?? cur?.type ?? null
  if (cur && cur.title === title && (cur.type ?? null) === finalType) return
  map[id] = { title, type: finalType, topics: cur?.topics ?? {} }
  await write(db, map)
}

// Зафиксировать топик чата (имя — только если известно; не затираем имеющееся).
export async function recordTopic(db: Database, chatId: number | string | null | undefined, threadId: number | string | null | undefined, name?: string | null): Promise<void> {
  if (chatId == null || threadId == null) return
  const cid = String(chatId)
  const tid = String(threadId)
  const map = await read(db)
  const chat = map[cid] ?? { title: null, type: null, topics: {} }
  const cur = chat.topics[tid]
  const newName = name ?? cur?.name ?? null
  if (cur && cur.name === newName) return
  chat.topics[tid] = { name: newName }
  map[cid] = chat
  await write(db, map)
}

export interface ChatListItem {
  id: string
  title: string | null
  type: string | null
  topics: { threadId: string; name: string | null }[]
}

export async function listChats(db: Database): Promise<ChatListItem[]> {
  const map = await read(db)
  return Object.entries(map).map(([id, c]) => ({
    id,
    title: c.title,
    type: c.type,
    topics: Object.entries(c.topics ?? {}).map(([threadId, t]) => ({ threadId, name: t?.name ?? null })),
  }))
}

/** Убрать группу из списка «увиденных» (бот вышел или владелец её забыл). */
export async function forgetChat(db: Database, chatId: number | string): Promise<void> {
  const map = await read(db)
  const id = String(chatId)
  if (!(id in map)) return
  const rest = { ...map }
  delete rest[id]
  await write(db, rest)
}
