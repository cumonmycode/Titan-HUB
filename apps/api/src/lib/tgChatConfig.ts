/**
 * Настройки бота Tai в одном групповом чате Telegram — всё в одном месте:
 * назначение чата, как отвечает Tai, команды, уведомления, приветствие и правила.
 *
 * Хранение — app_settings.tai_chat_settings (JSON chatId → настройки), тот же ключ,
 * что был у «Tai → Групповые чаты»: старые поля (mode/enabled/preset/harshness/
 * profanity) читаются как раньше, новые дописываются рядом. Сырые записи всегда
 * проходят через normalizeChatConfig — недостающее берётся из умолчаний режима.
 */
import { appSettings, type Database } from '@titan/database'
import { getBoolSetting, getStringSetting } from './appSettings.js'
import { TAI_PRESETS } from './tai.js'

export const CHAT_SETTINGS_KEY = 'tai_chat_settings'

/** game — чат игроков, work — чат персонала, notify — только уведомления. */
export type ChatMode = 'game' | 'work' | 'notify'
export type Harshness = 'soft' | 'medium' | 'savage'
export type CommandAccess = 'admins' | 'everyone'
/** Кого отмечает команда-отметка. */
export type MentionAudience = 'all' | 'unvoted' | 'yes' | 'no' | 'staff'
export type CommandKind = 'mention' | 'text' | 'rules' | 'help'

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
  /** Ответ команды (text) или заголовок отметки (mention). */
  text?: string
  enabled: boolean
  /** Свои права вместо общих для чата. */
  access?: CommandAccess
  builtin?: boolean
}

export const NOTIFY_CATEGORIES = ['requests', 'shifts', 'clients', 'money', 'stock', 'events'] as const
export type NotifyCategory = (typeof NOTIFY_CATEGORIES)[number]
export type BroadcastCategory = Exclude<NotifyCategory, 'requests'>
export interface NotifyTarget { on: boolean; threadId: number | null }

export interface ChatConfig {
  mode: ChatMode
  tai: { on: boolean; preset: string; harshness: Harshness; profanity: boolean }
  commands: { access: CommandAccess; cooldownMin: number; list: ChatCommand[] }
  notify: Record<NotifyCategory, NotifyTarget>
  welcome: { on: boolean; text: string; deleteService: boolean; rules: string }
  /** Состояние бота в чате по последнему апдейту Telegram. */
  bot: { status: BotStatus; at: string | null }
}
export type BotStatus = 'member' | 'administrator' | 'left' | 'kicked' | 'unknown'

/** Сырая запись в app_settings (старые поля + новые). */
export interface RawConfig {
  mode?: string
  enabled?: boolean
  taiOn?: boolean
  preset?: string
  harshness?: string
  profanity?: boolean
  commands?: Partial<ChatConfig['commands']>
  notify?: Partial<Record<BroadcastCategory, Partial<NotifyTarget>>>
  welcome?: Partial<ChatConfig['welcome']>
  bot?: Partial<ChatConfig['bot']>
}

const HARSH: Harshness[] = ['soft', 'medium', 'savage']
export const MODES: ChatMode[] = ['game', 'work', 'notify']
export const COMMAND_NAME_RE = /^[a-z0-9_]{1,32}$/
export const DEFAULT_COOLDOWN_MIN = 10
const AUDIENCES: MentionAudience[] = ['all', 'unvoted', 'yes', 'no', 'staff']

export const DEFAULT_WELCOME: Record<ChatMode, string> = {
  game: 'Привет, {name}! 👋 Добро пожаловать в {chat}. Здесь опросы на игры и новости клуба. Правила — /rules',
  work: 'Привет, {name}! 👋 Я Tai, помогаю команде по работе: смена, касса, записи. Обращайся «Тай, …».',
  notify: 'Привет, {name}! Здесь бот присылает уведомления клуба.',
}

/** Встроенные команды — как раньше, но теперь их можно выключить и переименовать. */
export function builtinCommands(): ChatCommand[] {
  return [
    { id: 'all', name: 'all', aliases: ['@all'], description: 'Отметить всех участников', kind: 'mention', audience: 'all', text: '📣 Участники:', enabled: true, builtin: true },
    { id: 'tvari', name: 'tvari', aliases: ['@tvari', '@твари'], description: 'Кто не отметился в опросе', kind: 'mention', audience: 'unvoted', text: '⚠️ Не отметились или «Думаю»:', enabled: true, builtin: true },
    { id: 'lubimki', name: 'lubimki', aliases: ['@lubimki', '@любимки'], description: 'Кто идёт («Да»)', kind: 'mention', audience: 'yes', text: '❤️ Любимки (проголосовали «Да»):', enabled: true, builtin: true },
    { id: 'supertvari', name: 'supertvari', aliases: ['@supertvari', '@супертвари'], description: 'Кто не идёт («Нет»)', kind: 'mention', audience: 'no', text: '🚫 Проголосовали «Нет»:', enabled: true, builtin: true },
    { id: 'rules', name: 'rules', aliases: ['правила'], description: 'Правила чата', kind: 'rules', enabled: true, builtin: true },
    { id: 'help', name: 'help', aliases: [], description: 'Что умеет бот', kind: 'help', enabled: true, builtin: true },
  ]
}

const TAI_DEFAULTS: Record<ChatMode, ChatConfig['tai']> = {
  game: { on: true, preset: 'roast', harshness: 'savage', profanity: true },
  work: { on: true, preset: 'friendly', harshness: 'soft', profanity: false },
  notify: { on: false, preset: 'friendly', harshness: 'soft', profanity: false },
}

/** Какие уведомления включены у нового чата сразу после добавления. */
const NOTIFY_PRESET: Record<ChatMode, BroadcastCategory[]> = {
  game: [],
  work: ['shifts', 'clients'],
  notify: ['shifts', 'clients', 'money', 'stock', 'events'],
}

/** Общие настройки клуба, от которых зависят умолчания старых чатов. */
export interface ChatGlobals {
  /** tai_chat_enabled — старый общий тумблер «Шутки в игровых чатах». */
  jokes: boolean
  /** tai_preset — общий стиль игровых чатов. */
  preset: string
  /** poll_commands_admin_only — старый общий доступ к командам. */
  adminOnly: boolean
  /** requests_tg_chat — куда идут заявки с сайта (единственный чат). */
  requestsChat: { chatId: string; threadId: number | null } | null
}

const validPreset = (p: unknown): p is string => typeof p === 'string' && TAI_PRESETS.some((x) => x.key === p)
const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '')

function normalizeCommand(c: Partial<ChatCommand>, base?: ChatCommand): ChatCommand | null {
  const name = String(c.name ?? base?.name ?? '').toLowerCase()
  if (!COMMAND_NAME_RE.test(name)) return null
  const kind: CommandKind = base?.kind ?? (c.kind === 'mention' ? 'mention' : 'text')
  const audience = base?.audience ?? (AUDIENCES.includes(c.audience as MentionAudience) ? (c.audience as MentionAudience) : 'all')
  return {
    id: base?.id ?? String(c.id ?? name),
    name,
    aliases: [...new Set((c.aliases ?? base?.aliases ?? []).map((a) => String(a).trim().toLowerCase()).filter((a) => a && a.length <= 32))].slice(0, 8),
    description: str(c.description ?? base?.description, 64) || name,
    kind,
    ...(kind === 'mention' ? { audience } : {}),
    ...(kind === 'mention' || kind === 'text' ? { text: str(c.text ?? base?.text, 2000) } : {}),
    enabled: c.enabled ?? base?.enabled ?? true,
    ...(c.access === 'admins' || c.access === 'everyone' ? { access: c.access } : {}),
    ...(base?.builtin ? { builtin: true } : {}),
  }
}

/** Встроенные (с правками владельца) + свои команды чата. */
function normalizeCommands(raw: ChatCommand[] | undefined, mode: ChatMode): ChatCommand[] {
  const saved = new Map((raw ?? []).map((c) => [c.id, c]))
  const builtins = builtinCommands().map((b) => normalizeCommand(saved.get(b.id) ?? { enabled: mode !== 'notify' }, b)!)
  const ids = new Set(builtins.map((b) => b.id))
  const custom = (raw ?? []).filter((c) => !ids.has(c.id)).map((c) => normalizeCommand(c)).filter((c): c is ChatCommand => !!c)
  return [...builtins, ...custom]
}

export function normalizeChatConfig(chatId: string, raw: RawConfig | undefined, g: ChatGlobals): ChatConfig {
  const r = raw ?? {}
  const mode: ChatMode = MODES.includes(r.mode as ChatMode) ? (r.mode as ChatMode) : 'game'
  const td = TAI_DEFAULTS[mode]
  // Игровой чат без новых настроек: шутит, если был включён общий тумблер и сам чат.
  const legacyOn = mode === 'game' ? g.jokes && r.enabled !== false : mode === 'work'
  const tai: ChatConfig['tai'] = {
    on: typeof r.taiOn === 'boolean' ? r.taiOn : legacyOn,
    preset: validPreset(r.preset) ? r.preset : mode === 'game' && validPreset(g.preset) ? g.preset : td.preset,
    harshness: HARSH.includes(r.harshness as Harshness) ? (r.harshness as Harshness) : td.harshness,
    profanity: typeof r.profanity === 'boolean' ? r.profanity : td.profanity,
  }
  const access = r.commands?.access
  const commands: ChatConfig['commands'] = {
    access: access === 'everyone' || access === 'admins' ? access : g.adminOnly ? 'admins' : 'everyone',
    cooldownMin: Math.min(120, Math.max(0, Math.round(Number(r.commands?.cooldownMin ?? DEFAULT_COOLDOWN_MIN)) || 0)),
    list: normalizeCommands(r.commands?.list, mode),
  }
  // Старые чаты без раздела уведомлений — всё выключено: ничего не начнёт приходить само.
  const notify = Object.fromEntries(
    NOTIFY_CATEGORIES.map((cat) => {
      if (cat === 'requests') {
        const on = g.requestsChat?.chatId === chatId
        return [cat, { on, threadId: on ? g.requestsChat!.threadId : null }]
      }
      const t = r.notify?.[cat]
      return [cat, { on: t?.on === true, threadId: typeof t?.threadId === 'number' ? t.threadId : null }]
    }),
  ) as Record<NotifyCategory, NotifyTarget>
  const welcome: ChatConfig['welcome'] = {
    on: r.welcome?.on === true,
    text: str(r.welcome?.text, 1000) || DEFAULT_WELCOME[mode],
    deleteService: r.welcome?.deleteService === true,
    rules: str(r.welcome?.rules, 3000),
  }
  const status = r.bot?.status
  const bot: ChatConfig['bot'] = {
    status: status === 'member' || status === 'administrator' || status === 'left' || status === 'kicked' ? status : 'unknown',
    at: typeof r.bot?.at === 'string' ? r.bot.at : null,
  }
  return { mode, tai, commands, notify, welcome, bot }
}

/** Заготовка нового чата по назначению: что включено сразу после добавления. */
export function presetFor(mode: ChatMode): RawConfig {
  const td = TAI_DEFAULTS[mode]
  const commandOn = (c: ChatCommand) => mode === 'game' || (mode === 'work' && (c.kind === 'rules' || c.kind === 'help' || c.id === 'all'))
  return {
    mode,
    taiOn: td.on,
    preset: td.preset,
    harshness: td.harshness,
    profanity: td.profanity,
    commands: { access: 'admins', cooldownMin: DEFAULT_COOLDOWN_MIN, list: builtinCommands().map((c) => ({ ...c, enabled: commandOn(c) })) },
    notify: Object.fromEntries(NOTIFY_CATEGORIES.filter((c): c is BroadcastCategory => c !== 'requests').map((c) => [c, { on: NOTIFY_PRESET[mode].includes(c), threadId: null }])),
    welcome: { on: mode === 'game', text: DEFAULT_WELCOME[mode], deleteService: false, rules: '' },
  }
}

// ─── Чтение / запись ─────────────────────────────────────────────────────────

export async function readRawConfigs(db: Database): Promise<Record<string, RawConfig>> {
  try {
    const raw = await getStringSetting(CHAT_SETTINGS_KEY, '', db)
    const parsed = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

async function writeRawConfigs(db: Database, map: Record<string, RawConfig>): Promise<void> {
  const value = JSON.stringify(map)
  await db.insert(appSettings).values({ key: CHAT_SETTINGS_KEY, value }).onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } })
}

export async function readGlobals(db: Database): Promise<ChatGlobals> {
  const [jokes, preset, adminOnly, requestsRaw] = await Promise.all([
    getBoolSetting('tai_chat_enabled', false, db),
    getStringSetting('tai_preset', 'roast', db),
    getBoolSetting('poll_commands_admin_only', true, db),
    getStringSetting('requests_tg_chat', '', db),
  ])
  let requestsChat: ChatGlobals['requestsChat'] = null
  try {
    const v = requestsRaw ? JSON.parse(requestsRaw) : null
    if (v && typeof v.chatId === 'string' && v.chatId) requestsChat = { chatId: v.chatId, threadId: typeof v.threadId === 'number' ? v.threadId : null }
  } catch { /* мусор → нет чата заявок */ }
  return { jokes, preset, adminOnly, requestsChat }
}

export async function readChatConfig(db: Database, chatId: string): Promise<ChatConfig> {
  const [all, g] = await Promise.all([readRawConfigs(db), readGlobals(db)])
  return normalizeChatConfig(chatId, all[chatId], g)
}

export async function readAllChatConfigs(db: Database, ids: string[] = []): Promise<Map<string, ChatConfig>> {
  const [all, g] = await Promise.all([readRawConfigs(db), readGlobals(db)])
  const keys = new Set([...Object.keys(all), ...ids])
  return new Map([...keys].map((id) => [id, normalizeChatConfig(id, all[id], g)]))
}

/** Есть ли у чата сохранённое назначение (иначе он ещё «ничей»). */
export async function chatConfigured(db: Database, chatId: string): Promise<boolean> {
  return !!(await readRawConfigs(db))[chatId]?.mode
}

/** Первое сохранение уведомлений — фиксируем текущее состояние всех категорий. */
function currentNotify(cur: RawConfig): NonNullable<RawConfig['notify']> {
  return Object.fromEntries(
    NOTIFY_CATEGORIES.filter((c): c is BroadcastCategory => c !== 'requests').map((c) => [c, { on: cur.notify?.[c]?.on === true, threadId: cur.notify?.[c]?.threadId ?? null }]),
  )
}

/**
 * Записать часть настроек чата поверх сохранённых. Вложенные разделы сливаются
 * по полям, список команд заменяется целиком. Заявки (requests) — отдельный ключ.
 */
export async function patchChatConfig(db: Database, chatId: string, patch: RawConfig): Promise<void> {
  const all = await readRawConfigs(db)
  const cur = all[chatId] ?? {}
  const next: RawConfig = {
    ...cur,
    ...patch,
    ...(patch.commands ? { commands: { ...cur.commands, ...patch.commands } } : {}),
    ...(patch.welcome ? { welcome: { ...cur.welcome, ...patch.welcome } } : {}),
    ...(patch.notify ? { notify: { ...currentNotify(cur), ...patch.notify } } : {}),
  }
  await writeRawConfigs(db, { ...all, [chatId]: next })
}

/** Заменить настройки чата целиком (заготовка при добавлении), сохранив статус бота. */
export async function replaceChatConfig(db: Database, chatId: string, raw: RawConfig): Promise<void> {
  const all = await readRawConfigs(db)
  await writeRawConfigs(db, { ...all, [chatId]: { ...raw, bot: all[chatId]?.bot } })
}

export async function setBotStatus(db: Database, chatId: string, status: BotStatus): Promise<void> {
  const all = await readRawConfigs(db)
  if (all[chatId]?.bot?.status === status) return
  await writeRawConfigs(db, { ...all, [chatId]: { ...all[chatId], bot: { status, at: new Date().toISOString() } } })
}

export async function forgetChatConfig(db: Database, chatId: string): Promise<void> {
  const all = await readRawConfigs(db)
  if (!(chatId in all)) return
  const rest = { ...all }
  delete rest[chatId]
  await writeRawConfigs(db, rest)
}

export const botActive = (c: ChatConfig): boolean => c.bot.status !== 'left' && c.bot.status !== 'kicked'

/** Чаты, подписанные на категорию уведомлений (кроме заявок — у них свой путь). */
export async function chatsForCategory(db: Database, cat: BroadcastCategory): Promise<{ chatId: string; threadId: number | null }[]> {
  const configs = await readAllChatConfigs(db)
  return [...configs.entries()].filter(([, c]) => c.notify[cat].on && botActive(c)).map(([chatId, c]) => ({ chatId, threadId: c.notify[cat].threadId }))
}
