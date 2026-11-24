/**
 * Команды группового чата: встроенные и свои. Тип и нормализация — здесь,
 * выполнение — modules/tg/commands.ts, админские /mute и т. п. — modules/tg/moderation.ts.
 */

export type CommandAccess = 'admins' | 'everyone'
/** Кого отмечает команда-отметка (и из кого выбирает «случайный»). */
export type MentionAudience = 'all' | 'unvoted' | 'yes' | 'no' | 'staff'
/**
 * Что делает команда:
 *  mention — отметить людей, text — ответить текстом, rules/help — правила и справка,
 *  stream — ссылки на текущий стрим и донаты, games — ближайшие игры,
 *  tai — Tai отвечает по заданию владельца (факт, тост, прогноз…) в стиле чата,
 *  random — выбрать случайного человека, poll — показать сегодняшний опрос.
 */
export type CommandKind = 'mention' | 'text' | 'rules' | 'help' | 'stream' | 'games' | 'tai' | 'random' | 'poll'

export const COMMAND_KINDS: CommandKind[] = ['mention', 'text', 'rules', 'help', 'stream', 'games', 'tai', 'random', 'poll']
/** Виды, которые владелец может выбрать у своей команды (rules/help — только встроенные). */
export const CUSTOM_KINDS: CommandKind[] = ['text', 'mention', 'tai', 'random', 'games', 'stream', 'poll']
const AUDIENCE_KINDS = new Set<CommandKind>(['mention', 'random'])
const TEXT_KINDS = new Set<CommandKind>(['mention', 'text', 'tai', 'random'])

export interface ChatCommand {
  id: string
  /** Латиница для меню «/» Telegram: /all, /rules. */
  name: string
  /** Другие слова, на которые отзывается команда: @all, @твари, правила. */
  aliases: string[]
  /** Подпись в меню «/» и в справке. */
  description: string
  kind: CommandKind
  audience?: MentionAudience
  /** Ответ (text), заголовок (mention/random) или задание для Tai (tai). */
  text?: string
  enabled: boolean
  /** Свои права вместо общих для чата. */
  access?: CommandAccess
  builtin?: boolean
}

export const COMMAND_NAME_RE = /^[a-z0-9_]{1,32}$/
export const AUDIENCES: MentionAudience[] = ['all', 'unvoted', 'yes', 'no', 'staff']
const MAX_ALIASES = 8
const MAX_TEXT = 2000

/** Встроенные команды — их можно выключить и переименовать, но не удалить. */
export function builtinCommands(): ChatCommand[] {
  return [
    { id: 'all', name: 'all', aliases: ['@all'], description: 'Отметить всех участников', kind: 'mention', audience: 'all', text: '📣 Участники:', enabled: true, builtin: true },
    { id: 'tvari', name: 'tvari', aliases: ['@tvari', '@твари'], description: 'Кто не отметился в опросе', kind: 'mention', audience: 'unvoted', text: '⚠️ Не отметились или «Думаю»:', enabled: true, builtin: true },
    { id: 'lubimki', name: 'lubimki', aliases: ['@lubimki', '@любимки'], description: 'Кто идёт («Да»)', kind: 'mention', audience: 'yes', text: '❤️ Любимки (проголосовали «Да»):', enabled: true, builtin: true },
    { id: 'supertvari', name: 'supertvari', aliases: ['@supertvari', '@супертвари'], description: 'Кто не идёт («Нет»)', kind: 'mention', audience: 'no', text: '🚫 Проголосовали «Нет»:', enabled: true, builtin: true },
    { id: 'stream', name: 'stream', aliases: ['@stream', '@стрим', 'стрим'], description: 'Ссылка на стрим и донаты', kind: 'stream', enabled: true, builtin: true },
    { id: 'games', name: 'games', aliases: ['@игры', 'расписание'], description: 'Ближайшие игры', kind: 'games', enabled: true, builtin: true },
    { id: 'rules', name: 'rules', aliases: ['правила'], description: 'Правила чата', kind: 'rules', enabled: true, builtin: true },
    { id: 'help', name: 'help', aliases: [], description: 'Что умеет бот', kind: 'help', enabled: true, builtin: true },
  ]
}

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '')

function normalizeCommand(c: Partial<ChatCommand>, base?: ChatCommand): ChatCommand | null {
  const name = String(c.name ?? base?.name ?? '').toLowerCase()
  if (!COMMAND_NAME_RE.test(name)) return null
  const kind: CommandKind = base?.kind ?? (CUSTOM_KINDS.includes(c.kind as CommandKind) ? (c.kind as CommandKind) : 'text')
  const audience = base?.audience ?? (AUDIENCES.includes(c.audience as MentionAudience) ? (c.audience as MentionAudience) : 'all')
  return {
    id: base?.id ?? String(c.id ?? name),
    name,
    aliases: [...new Set((c.aliases ?? base?.aliases ?? []).map((a) => String(a).trim().toLowerCase()).filter((a) => a && a.length <= 32))].slice(0, MAX_ALIASES),
    description: str(c.description ?? base?.description, 64) || name,
    kind,
    ...(AUDIENCE_KINDS.has(kind) ? { audience } : {}),
    ...(TEXT_KINDS.has(kind) ? { text: str(c.text ?? base?.text, MAX_TEXT) } : {}),
    enabled: c.enabled ?? base?.enabled ?? true,
    ...(c.access === 'admins' || c.access === 'everyone' ? { access: c.access } : {}),
    ...(base?.builtin ? { builtin: true } : {}),
  }
}

/** Встроенные (с правками владельца) + свои команды чата. */
export function normalizeCommands(raw: ChatCommand[] | undefined, defaultOn: (c: ChatCommand) => boolean): ChatCommand[] {
  const saved = new Map((raw ?? []).map((c) => [c.id, c]))
  const builtins = builtinCommands().map((b) => normalizeCommand(saved.get(b.id) ?? { enabled: defaultOn(b) }, b)!)
  const ids = new Set(builtins.map((b) => b.id))
  const custom = (raw ?? []).filter((c) => !ids.has(c.id)).map((c) => normalizeCommand(c)).filter((c): c is ChatCommand => !!c)
  return [...builtins, ...custom]
}
