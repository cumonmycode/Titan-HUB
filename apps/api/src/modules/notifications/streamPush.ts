/**
 * Push «Мы в эфире» клиентам My Titan, когда эфир клуба опубликован (tg/streams.ts →
 * publishStream). Только тем, у кого установлено приложение и не выключены «Трансляции»
 * (profiles.client_streams_enabled). Строка в ленте уведомлений ведёт на экран
 * «Трансляции» (meta.screen = 'stream'). Telegram не дублируем — там пишет Tai.
 * Заголовок и текст задаёт владелец в HUB («Маркетинг → Трансляции»), пусто — стандартные;
 * {название} в тексте заменяется названием эфира.
 * Никогда не бросает наверх: вызывать fire-and-forget.
 */
import { appDevices, profiles, and, eq, inArray, isNull, type Database } from '@titan/database'
import { deliverToClients } from './client.js'

/** Те же «клиенты клуба», что у рассылок: владельцы и сотрудники тоже играют и смотрят. */
const CLIENT_ROLES = ['client', 'staff', 'owner'] as const

interface StartedStream { id: string; title: string }
export interface StreamPushText { title: string; body: string }

export const DEFAULT_PUSH_TITLE = '🔴 Мы в эфире!'
export const DEFAULT_PUSH_BODY = '{название} — заходите смотреть и болеть за своих'
const TITLE_PLACEHOLDER = /\{название\}/gi

/** Текст push: свой или стандартный, с названием эфира вместо {название}. */
export function streamPushText(stream: StartedStream, custom: StreamPushText): StreamPushText {
  const fill = (template: string) => template.replace(TITLE_PLACEHOLDER, stream.title).trim()
  return { title: fill(custom.title || DEFAULT_PUSH_TITLE), body: fill(custom.body || DEFAULT_PUSH_BODY) }
}

async function streamAudience(db: Database): Promise<string[]> {
  const rows = await db.selectDistinct({ id: profiles.id })
    .from(profiles)
    .innerJoin(appDevices, and(eq(appDevices.profileId, profiles.id), eq(appDevices.app, 'client')))
    .where(and(
      inArray(profiles.role, CLIENT_ROLES),
      isNull(profiles.deletedAt),
      eq(profiles.clientStreamsEnabled, true),
    ))
  return rows.map((r) => r.id)
}

export async function notifyStreamStarted(db: Database, stream: StartedStream, custom: StreamPushText): Promise<void> {
  try {
    const ids = await streamAudience(db)
    if (!ids.length) return
    const text = streamPushText(stream, custom)
    const r = await deliverToClients(ids, {
      kind: 'stream',
      title: text.title,
      body: text.body,
      meta: { screen: 'stream', streamId: stream.id },
    }, { push: true, telegram: false }, db)
    console.info(`[streams] push «${stream.title}»: ${r.recipients} клиентов, ${r.push} push`)
  } catch (err) {
    console.error('[streams] push в My Titan не отправлен:', err)
  }
}
