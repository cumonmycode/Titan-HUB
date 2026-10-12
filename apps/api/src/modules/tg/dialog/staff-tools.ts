/**
 * Инструменты Tai для сотрудников в Telegram, которых нет в HUB: отправить
 * клиенту сегодняшний опрос и посмотреть, кто отметился в опросах.
 */
import { profiles, inArray, eq, type Database } from '@titan/database'
import { registerAction } from '../../ai/tai/actions.js'
import type { TaiBlock } from '../../ai/tai/blocks.js'
import type { ToolDef, ToolResult } from '../../ai/tai/tools/types.js'
import { voteMapOfPoll } from '../../../lib/pollState.js'
import { readRoster } from '../../../lib/roster.js'
import { readAliases } from '../../../lib/tgAliases.js'
import { todaysPolls } from '../games.js'
import { getContact } from './memory.js'

const KIND_PARAM = { type: 'string', enum: ['sport', 'city', 'any'], description: 'Какой вечер: sport — спортивная, city — городская' }
const NAMES_PER_OPTION = 30

const proposeSendPoll: ToolDef = {
  name: 'propose_send_poll',
  description:
    'Подготовить отправку сегодняшнего опроса записи на игру клиенту в личку от Tai (сотрудник подтвердит карточкой). ' +
    'playerId — из find_clients. note — что передать клиенту от себя (необязательно).',
  parameters: {
    type: 'object',
    properties: { playerId: { type: 'string' }, kind: KIND_PARAM, note: { type: 'string' } },
    required: ['playerId'],
  },
  status: () => 'Готовлю опрос для клиента…',
  async run(args, ctx): Promise<ToolResult> {
    const playerId = String(args['playerId'] ?? '')
    const [client] = await ctx.db.select({ id: profiles.id, nickname: profiles.nickname, tgId: profiles.tgId })
      .from(profiles).where(eq(profiles.id, playerId)).limit(1)
    if (!client) return { data: { error: 'Клиент не найден' } }
    if (!client.tgId) return { data: { error: `У ${client.nickname} не привязан Telegram — Tai не знает, кому писать` } }
    const contact = await getContact(ctx.db, client.tgId)
    if (!contact) return { data: { error: `${client.nickname} ещё ни разу не писал Tai — Telegram не даёт боту написать первым. Пусть откроет бота и нажмёт «Старт».` } }
    if (!contact.dmOpen) return { data: { error: `${client.nickname} заблокировал Tai — сообщение не дойдёт` } }
    const kind = typeof args['kind'] === 'string' && args['kind'] !== 'any' ? args['kind'] : (contact.games === 'sport' || contact.games === 'city' ? contact.games : null)
    const polls = await todaysPolls(ctx.db)
    const poll = polls.find((p) => !kind || p.kind === kind) ?? (kind ? undefined : polls[0])
    if (!poll) return { data: { error: 'Сегодня опрос ещё не выложен — отправлять нечего' } }
    const note = typeof args['note'] === 'string' && args['note'].trim() ? args['note'].trim().slice(0, 300) : null
    const action = await registerAction(
      ctx.clubKey,
      ctx.userSub,
      { kind: 'send_poll', playerId: client.id, pollKind: poll.kind, note, nickname: client.nickname },
      {
        kind: 'send_poll',
        title: `Опрос для ${client.nickname}`,
        rows: [{ label: 'Опрос', value: poll.title }, ...(note ? [{ label: 'От тебя', value: note }] : [])],
        confirmLabel: 'Отправить',
      },
    )
    const blocks: TaiBlock[] = [{ type: 'action', action }]
    return { blocks, memo: `подготовил опрос для ${client.nickname}`, data: { shown: 'Карточка показана, ждём подтверждения' }, terminal: true }
  },
}

async function namesByTg(db: Database, tgIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (!tgIds.length) return out
  const direct = await db.select({ tgId: profiles.tgId, nickname: profiles.nickname }).from(profiles).where(inArray(profiles.tgId, tgIds))
  for (const p of direct) if (p.tgId) out.set(p.tgId, p.nickname)
  const aliases = await readAliases(db)
  const viaAlias = tgIds.filter((t) => !out.has(t) && aliases[t])
  if (viaAlias.length) {
    const ids = [...new Set(viaAlias.map((t) => aliases[t]!.profileId))]
    const rows = await db.select({ id: profiles.id, nickname: profiles.nickname }).from(profiles).where(inArray(profiles.id, ids))
    const byId = new Map(rows.map((r) => [r.id, r.nickname]))
    for (const t of viaAlias) { const n = byId.get(aliases[t]!.profileId); if (n) out.set(t, n) }
  }
  const roster = await readRoster(db)
  for (const u of roster) {
    if (out.has(u.tgId) || !tgIds.includes(u.tgId)) continue
    out.set(u.tgId, u.firstName || (u.username ? `@${u.username}` : 'без имени'))
  }
  return out
}

const pollVotes: ToolDef = {
  name: 'poll_votes',
  description: 'Кто отметился в сегодняшних опросах записи на игру: по вариантам («Да», «Опоздаю», «Думаю», «Нет») с никами.',
  parameters: { type: 'object', properties: {} },
  status: () => 'Смотрю опросы…',
  async run(_args, ctx): Promise<ToolResult> {
    const polls = await todaysPolls(ctx.db)
    if (!polls.length) return { data: { error: 'Сегодня опросов не было' } }
    const result = []
    for (const poll of polls) {
      const votes = await voteMapOfPoll(ctx.db, poll.pollId)
      const names = await namesByTg(ctx.db, Object.keys(votes))
      const options = poll.options.map((label, index) => {
        const voters = Object.entries(votes).filter(([, ids]) => ids.includes(index)).map(([tg]) => names.get(tg) ?? 'без имени')
        return { label, count: voters.length, names: voters.slice(0, NAMES_PER_OPTION) }
      })
      result.push({ title: poll.title, options })
    }
    const blocks: TaiBlock[] = result.map((p) => ({
      type: 'list',
      title: p.title,
      rows: p.options.map((o) => ({ id: o.label, title: `${o.label} — ${o.count}`, subtitle: o.names.join(', ') || undefined })),
    }))
    return { data: { polls: result }, blocks, memo: 'показал голоса в опросах' }
  },
}

export const TELEGRAM_STAFF_TOOLS: ToolDef[] = [proposeSendPoll, pollVotes]
