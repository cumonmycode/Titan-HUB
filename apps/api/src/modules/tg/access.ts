/**
 * Кто может попасть в какой чат клуба. Правила — в настройках чата (access):
 *  • «всем» — любой, кто попросит; иначе
 *  • сотрудникам (staff), игрокам вида игры (games: спортивная / городская — по тому,
 *    во что человек играет: сказал Tai или по чатам, где его видели),
 *  • и тем, кого владелец отметил вручную (allow — в карточке клиента или при подтверждении анкеты).
 * Анкета, ещё не подтверждённая в HUB, проходит только по ручному списку.
 *
 * В личке Tai по просьбе даёт ссылки только на доступные чаты (инструмент chat_invites).
 * Если у чата включена «Проверка заявок» (guard), ссылка — с заявкой на вступление, и Tai сам
 * одобряет или отклоняет заявку: чужой не войдёт даже по пересланной ссылке. Без проверки —
 * личная одноразовая ссылка на сутки.
 */
import type { Database } from '@titan/database'
import { listChats } from '../../lib/tgChats.js'
import { botActive, readAllChatConfigs, readChatConfig, readInviteLink, saveInviteLink, type ChatConfig } from '../../lib/tgChatConfig.js'
import type { ToolDef, ToolResult } from '../ai/tai/tools/types.js'
import type { TgClub } from './club.js'
import { gamesFromChats } from './games.js'
import { profileByTg } from './identity.js'
import { accessReason, type Member } from './rules.js'
export { accessReason, type AccessReason, type Member } from './rules.js'
import { getContact } from './dialog/memory.js'
import type { TgChat, TgUser } from './types.js'

const PERSONAL_LINK_TTL_SEC = 24 * 3600
const MAX_LINKS = 8

export async function memberOf(db: Database, tgId: string): Promise<Member> {
  const [profile, contact] = await Promise.all([profileByTg(db, tgId), getContact(db, tgId)])
  return { profile, games: contact?.games ?? (await gamesFromChats(db, tgId)) }
}

/** Ссылка на чат для этого человека: с заявкой (если проверка включена) или личная одноразовая. */
async function inviteFor(club: TgClub, chatId: string, config: ChatConfig, tgId: string): Promise<string | null> {
  if (config.access.guard) {
    const saved = await readInviteLink(club.db, chatId)
    if (saved) return saved
    const link = await club.bot.call<{ invite_link: string }>('createChatInviteLink', { chat_id: chatId, name: 'Tai · по заявке', creates_join_request: true })
    if (link?.invite_link) await saveInviteLink(club.db, chatId, link.invite_link)
    return link?.invite_link ?? null
  }
  const link = await club.bot.call<{ invite_link: string }>('createChatInviteLink', {
    chat_id: chatId,
    name: `Tai · ${tgId}`.slice(0, 32),
    member_limit: 1,
    expire_date: Math.floor(Date.now() / 1000) + PERSONAL_LINK_TTL_SEC,
  })
  return link?.invite_link ?? null
}

/** Чаты, в которые Tai может пригласить этого человека. */
export async function invitableChats(club: TgClub, tgId: string): Promise<{ chatId: string; title: string; config: ChatConfig }[]> {
  const [chats, member] = await Promise.all([listChats(club.db), memberOf(club.db, tgId)])
  const configs = await readAllChatConfigs(club.db, chats.map((c) => c.id))
  return chats
    .map((ch) => ({ chatId: ch.id, title: ch.title ?? 'Чат клуба', config: configs.get(ch.id)! }))
    .filter(({ config }) => config.access.invite && botActive(config) && accessReason(config.access, member) != null)
}

/** Инструмент Tai в личке: ссылки на чаты клуба — кнопками, только доступные человеку. */
export function chatInvitesTool(club: TgClub, tgId: string, dmChatId: string): ToolDef {
  return {
    name: 'chat_invites',
    description:
      'Ссылки-приглашения в Telegram-чаты клуба (игровые чаты и т. п.). Зови, когда человек просит ссылку на чат/группу клуба или хочет в чат. ' +
      'Ссылки придут кнопками отдельным сообщением — сам ссылки не пиши. Даёт только те чаты, куда человеку можно; если ничего нет — объясни, что доступ открывает администратор.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Часть названия чата, если человек просит конкретный (например «спорт»). Пусто — все доступные.' } },
    },
    status: () => 'Готовлю ссылки на чаты…',
    async run(args): Promise<ToolResult> {
      const query = String(args['query'] ?? '').trim().toLowerCase()
      const all = await invitableChats(club, tgId)
      const picked = (query ? all.filter((c) => c.title.toLowerCase().includes(query)) : all).slice(0, MAX_LINKS)
      if (!picked.length) {
        return { data: { sent: [], available: all.map((c) => c.title), note: all.length ? 'Под запрос ничего — предложи из доступных' : 'Нет доступных чатов: доступ выдаёт администратор клуба' } }
      }
      const links = await Promise.all(picked.map(async (c) => ({ ...c, url: await inviteFor(club, c.chatId, c.config, tgId) })))
      const ready = links.filter((l): l is typeof l & { url: string } => !!l.url)
      if (ready.length) {
        const guarded = ready.some((l) => l.config.access.guard)
        await club.bot.send(dmChatId, guarded ? 'Вот ссылки — после заявки я сразу тебя пропущу 👇' : 'Вот ссылки — каждая на одного человека и на сутки 👇', {
          markup: { inline_keyboard: ready.map((l) => [{ text: l.title, url: l.url }]) },
        })
      }
      const failed = links.filter((l) => !l.url).map((l) => l.title)
      return {
        data: { sent: ready.map((l) => l.title), failed, note: failed.length ? 'Для части чатов у бота нет права приглашать — скажи, что передашь администратору' : 'Кнопки уже отправлены' },
        memo: `дал ссылки на чаты: ${ready.map((l) => l.title).join(', ') || 'нет'}`,
      }
    },
  }
}

export interface JoinRequest {
  chat: TgChat
  from: TgUser
  user_chat_id?: number
}

/** Заявка на вступление: если у чата проверка включена — пускаем по правилам, иначе решают админы. */
export async function onJoinRequest(club: TgClub, req: JoinRequest): Promise<void> {
  const config = await readChatConfig(club.db, String(req.chat.id))
  if (!config.access.guard) return
  const allowed = accessReason(config.access, await memberOf(club.db, String(req.from.id))) != null
  const done = await club.bot.call<boolean>(allowed ? 'approveChatJoinRequest' : 'declineChatJoinRequest', { chat_id: req.chat.id, user_id: req.from.id })
  if (!done || allowed || !req.user_chat_id) return
  // Отказ объясняем в личке: у бота есть 5 минут написать подавшему заявку.
  await club.bot.send(req.user_chat_id, `Пока не могу пустить тебя в «${req.chat.title ?? 'чат клуба'}» — туда доступ по приглашению администратора. Напиши мне, если думаешь, что это ошибка 🙂`)
}
