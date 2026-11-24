/**
 * Общее для Tai в группах: короткая память чата (последние сообщения), факты о клубе
 * для промпта и стиль из настроек чата. Ответы — group.ts, команды — commands.ts,
 * приколы и реплики сами по себе — fun.ts.
 */
import { getStringSetting } from '../../lib/appSettings.js'
import { taiChatReply, type TaiTask } from '../../lib/tai.js'
import type { ChatConfig } from '../../lib/tgChatConfig.js'
import type { TgClub } from './club.js'
import { gameConfigs, nightLabel, upcomingNights } from './games.js'

const BUFFER_MAX = 12
const CONTEXT_LINES = 8
const FACTS_TTL_MS = 5 * 60_000
const buffers = new Map<string, { name: string; text: string; at: number }[]>()
const facts = new Map<string, { at: number; text: string }>()

export function rememberLine(chatId: string | number, name: string, text: string): void {
  if (!text) return
  const k = String(chatId)
  const arr = [...(buffers.get(k) ?? []), { name, text: text.slice(0, 300), at: Date.now() }]
  buffers.set(k, arr.slice(-BUFFER_MAX))
}

/** Последние сообщения чата строками «Ник: текст» (без самого свежего, если skipLast). */
export function chatContext(chatId: string | number, skipLast = false): string | undefined {
  const arr = buffers.get(String(chatId)) ?? []
  const lines = (skipLast ? arr.slice(0, -1) : arr).slice(-CONTEXT_LINES)
  return lines.length ? lines.map((m) => `${m.name}: ${m.text}`).join('\n') : undefined
}

/** Сколько сообщений написали люди за последние `ms` (для реплик и приколов). */
export function recentActivity(chatId: string | number, ms: number): number {
  const since = Date.now() - ms
  return (buffers.get(String(chatId)) ?? []).filter((m) => m.name !== 'Tai' && m.at >= since).length
}

/** Факты о клубе для промпта: ближайшие игры и адрес (кэш на 5 минут). */
export async function clubFacts(club: TgClub): Promise<string> {
  const hit = facts.get(club.key)
  if (hit && Date.now() - hit.at < FACTS_TTL_MS) return hit.text
  const [nights, venue] = await Promise.all([
    gameConfigs(club.db).then((c) => upcomingNights(c, 8).slice(0, 5)).catch(() => []),
    getStringSetting('venue_address', '', club.db).catch(() => ''),
  ])
  const text = [
    `Клуб: ${club.name}${venue ? `, ${venue}` : ''}.`,
    nights.length ? `Ближайшие игры: ${nights.map(nightLabel).join('; ')}.` : 'Расписание игр в боте не заведено.',
  ].join('\n')
  facts.set(club.key, { at: Date.now(), text })
  return text
}

/** Ответ Tai в стиле этого чата. Свою реплику кладёт в память чата. */
export async function taiSays(club: TgClub, chatId: string | number, config: ChatConfig, task: TaiTask, context = chatContext(chatId)): Promise<string | null> {
  const text = await taiChatReply(club.db, {
    task,
    style: { preset: config.tai.preset, harshness: config.tai.harshness, profanity: config.tai.profanity, custom: config.tai.custom },
    clubName: club.name,
    context,
    facts: await clubFacts(club),
  })
  if (text) rememberLine(chatId, 'Tai', text)
  return text
}
