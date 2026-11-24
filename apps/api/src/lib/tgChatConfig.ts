/**
 * Настройки бота Tai в одном групповом чате Telegram — всё в одном месте:
 * назначение чата, как отвечает Tai, команды, уведомления, приветствие и правила.
 *
 * Хранение — app_settings.tai_chat_settings (JSON chatId → настройки), тот же ключ,
 * что был у «Tai → Групповые чаты»: старые поля (mode/enabled/preset/harshness/
 * profanity) читаются как раньше, новые дописываются рядом. Сырые записи всегда
 * проходят через normalizeChatConfig — недостающее берётся из умолчаний режима.
 */
import { appSettings, sql, type Database } from '@titan/database'
import { getBoolSetting, getStringSetting } from './appSettings.js'
import { TAI_PRESETS } from './tai.js'
import { builtinCommands, normalizeCommands, type ChatCommand, type CommandAccess } from './tgChatCommands.js'

export const CHAT_SETTINGS_KEY = 'tai_chat_settings'

/** game — чат игроков, work — чат персонала, notify — только уведомления. */
export type ChatMode = 'game' | 'work' | 'notify'
export type Harshness = 'soft' | 'medium' | 'savage'
export type { ChatCommand, CommandAccess, CommandKind, MentionAudience } from './tgChatCommands.js'
export { COMMAND_NAME_RE, builtinCommands }
import { COMMAND_NAME_RE } from './tgChatCommands.js'
/** Иногда Tai сам вступает в разговор (без обращения к нему). */
export type Chime = 'off' | 'rare' | 'often'
/** Что Tai сам присылает в чат время от времени. */
export type FunKind = 'fact' | 'joke' | 'mafia' | 'question'
export type GameKind = 'sport' | 'city'

export const NOTIFY_CATEGORIES = ['requests', 'shifts', 'clients', 'money', 'stock', 'events', 'streams'] as const
export type NotifyCategory = (typeof NOTIFY_CATEGORIES)[number]
export type BroadcastCategory = Exclude<NotifyCategory, 'requests'>
export interface NotifyTarget { on: boolean; threadId: number | null }

export interface ChatConfig {
  mode: ChatMode
  tai: {
    on: boolean
    preset: string
    harshness: Harshness
    profanity: boolean
    /** Свои указания владельца: кто Tai в этом чате, о чём шутить, чего не трогать. */
    custom: string
    chime: Chime
    /** Иногда ставит реакции-эмодзи на сообщения. */
    reactions: boolean
  }
  /** Приколы и факты от Tai сами по себе: сколько в день, в какие часы, куда. */
  fun: { on: boolean; perDay: number; from: number; to: number; kinds: FunKind[]; threadId: number | null }
  /**
   * Кто может попасть в чат: Tai в личке даёт ссылку только тем, кому можно, а заявки
   * на вступление по ссылке бота (guard) одобряет или отклоняет сам.
   */
  access: { invite: boolean; everyone: boolean; games: GameKind[]; staff: boolean; allow: string[]; guard: boolean }
  /** Админские команды /mute, /mutechat, /ban и т. п. */
  moderation: { on: boolean }
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
  custom?: string
  chime?: string
  reactions?: boolean
  fun?: Partial<ChatConfig['fun']>
  access?: Partial<ChatConfig['access']>
  moderation?: Partial<ChatConfig['moderation']>
  /** Постоянная ссылка-заявка бота в чат (createChatInviteLink). */
  inviteLink?: string
  commands?: Partial<ChatConfig['commands']>
  notify?: Partial<Record<BroadcastCategory, Partial<NotifyTarget>>>
  welcome?: Partial<ChatConfig['welcome']>
  bot?: Partial<ChatConfig['bot']>
}

const HARSH: Harshness[] = ['soft', 'medium', 'savage']
export const MODES: ChatMode[] = ['game', 'work', 'notify']
export const DEFAULT_COOLDOWN_MIN = 10

export const DEFAULT_WELCOME: Record<ChatMode, string> = {
  game: 'Привет, {name}! 👋 Добро пожаловать в {chat}. Здесь опросы на игры и новости клуба. Правила — /rules',
  work: 'Привет, {name}! 👋 Я Tai, помогаю команде по работе: смена, касса, записи. Обращайся «Тай, …».',
  notify: 'Привет, {name}! Здесь бот присылает уведомления клуба.',
}

const TAI_DEFAULTS: Record<ChatMode, Pick<ChatConfig['tai'], 'on' | 'preset' | 'harshness' | 'profanity'>> = {
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
export const CUSTOM_MAX = 600

const CHIMES: Chime[] = ['off', 'rare', 'often']
export const FUN_KINDS: FunKind[] = ['fact', 'joke', 'mafia', 'question']
const GAME_KINDS: GameKind[] = ['sport', 'city']
const MAX_ALLOW = 2000
const clampInt = (v: unknown, min: number, max: number, fallback: number): number => {
  const n = Math.round(Number(v))
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
}

function normalizeFun(r: RawConfig['fun'], mode: ChatMode): ChatConfig['fun'] {
  const kinds = (r?.kinds ?? []).filter((k): k is FunKind => FUN_KINDS.includes(k as FunKind))
  const from = clampInt(r?.from, 0, 23, 12)
  const to = clampInt(r?.to, 1, 24, 22)
  return {
    on: r?.on === true && mode !== 'notify',
    perDay: clampInt(r?.perDay, 1, 6, 1),
    from,
    to: to > from ? to : Math.min(24, from + 1),
    kinds: kinds.length ? [...new Set(kinds)] : ['fact', 'joke', 'mafia'],
    threadId: typeof r?.threadId === 'number' ? r.threadId : null,
  }
}

function normalizeAccess(r: RawConfig['access']): ChatConfig['access'] {
  return {
    invite: r?.invite === true,
    everyone: r?.everyone === true,
    games: [...new Set((r?.games ?? []).filter((g): g is GameKind => GAME_KINDS.includes(g as GameKind)))],
    staff: r?.staff !== false,
    allow: [...new Set((r?.allow ?? []).filter((id): id is string => typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id)))].slice(0, MAX_ALLOW),
    guard: r?.guard === true,
  }
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
    custom: str(r.custom, CUSTOM_MAX),
    chime: CHIMES.includes(r.chime as Chime) ? (r.chime as Chime) : mode === 'game' ? 'rare' : 'off',
    reactions: typeof r.reactions === 'boolean' ? r.reactions : mode === 'game',
  }
  const access = r.commands?.access
  const commands: ChatConfig['commands'] = {
    access: access === 'everyone' || access === 'admins' ? access : g.adminOnly ? 'admins' : 'everyone',
    cooldownMin: Math.min(120, Math.max(0, Math.round(Number(r.commands?.cooldownMin ?? DEFAULT_COOLDOWN_MIN)) || 0)),
    list: normalizeCommands(r.commands?.list, (c) => mode !== 'notify' && (mode === 'game' || c.kind !== 'stream')),
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
  return { mode, tai, fun: normalizeFun(r.fun, mode), access: normalizeAccess(r.access), moderation: { on: r.moderation?.on !== false && mode !== 'notify' }, commands, notify, welcome, bot }
}

/** Заготовка нового чата по назначению: что включено сразу после добавления. */
export function presetFor(mode: ChatMode): RawConfig {
  const td = TAI_DEFAULTS[mode]
  const commandOn = (c: ChatCommand) => mode === 'game' || (mode === 'work' && (c.kind === 'rules' || c.kind === 'help' || c.kind === 'games' || c.id === 'all'))
  return {
    mode,
    taiOn: td.on,
    preset: td.preset,
    harshness: td.harshness,
    profanity: td.profanity,
    commands: { access: 'admins', cooldownMin: DEFAULT_COOLDOWN_MIN, list: builtinCommands().map((c) => ({ ...c, enabled: commandOn(c) })) },
    notify: Object.fromEntries(NOTIFY_CATEGORIES.filter((c): c is BroadcastCategory => c !== 'requests').map((c) => [c, { on: NOTIFY_PRESET[mode].includes(c), threadId: null }])),
    welcome: { on: mode === 'game', text: DEFAULT_WELCOME[mode], deleteService: false, rules: '' },
    fun: { on: mode === 'game', perDay: 1, from: 12, to: 22, kinds: ['fact', 'joke', 'mafia'], threadId: null },
    access: { invite: mode === 'game', everyone: false, games: [], staff: true, allow: [], guard: false },
    moderation: { on: mode !== 'notify' },
  }
}

// ─── Чтение / запись ─────────────────────────────────────────────────────────

type DbLike = Database | Parameters<Parameters<Database['transaction']>[0]>[0]

export async function readRawConfigs(db: DbLike): Promise<Record<string, RawConfig>> {
  try {
    const raw = await getStringSetting(CHAT_SETTINGS_KEY, '', db)
    const parsed = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

/**
 * Изменить настройки чатов под блокировкой. Все чаты лежат в одной записи, поэтому
 * без неё две правки подряд (или правка из HUB и апдейт Telegram о статусе бота)
 * читали одно и то же и последняя затирала первую.
 */
async function mutateRawConfigs(db: Database, change: (all: Record<string, RawConfig>) => Record<string, RawConfig> | null): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${CHAT_SETTINGS_KEY}, 0))`)
    const next = change(await readRawConfigs(tx))
    if (!next) return
    const value = JSON.stringify(next)
    await tx.insert(appSettings).values({ key: CHAT_SETTINGS_KEY, value }).onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } })
  })
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

/** Слить раздел: только если он пришёл в правке. */
const section = <K extends 'commands' | 'welcome' | 'fun' | 'access' | 'moderation'>(cur: RawConfig, patch: RawConfig, key: K) =>
  patch[key] ? { [key]: { ...(cur[key] as object | undefined), ...(patch[key] as object) } } : {}

/**
 * Записать часть настроек чата поверх сохранённых. Вложенные разделы сливаются
 * по полям, списки (команды, люди с доступом) заменяются целиком. Заявки (requests) — отдельный ключ.
 */
export async function patchChatConfig(db: Database, chatId: string, patch: RawConfig): Promise<void> {
  await mutateRawConfigs(db, (all) => {
    const cur = all[chatId] ?? {}
    const next: RawConfig = {
      ...cur,
      ...patch,
      ...section(cur, patch, 'commands'),
      ...section(cur, patch, 'welcome'),
      ...section(cur, patch, 'fun'),
      ...section(cur, patch, 'access'),
      ...section(cur, patch, 'moderation'),
      ...(patch.notify ? { notify: { ...currentNotify(cur), ...patch.notify } } : {}),
    }
    return { ...all, [chatId]: next }
  })
}

/** Заменить настройки чата целиком (заготовка при добавлении), сохранив статус бота. */
export async function replaceChatConfig(db: Database, chatId: string, raw: RawConfig): Promise<void> {
  await mutateRawConfigs(db, (all) => ({ ...all, [chatId]: { ...raw, bot: all[chatId]?.bot } }))
}

export async function setBotStatus(db: Database, chatId: string, status: BotStatus): Promise<void> {
  // Частый случай — статус не поменялся: проверяем без блокировки.
  if ((await readRawConfigs(db))[chatId]?.bot?.status === status) return
  await mutateRawConfigs(db, (all) =>
    all[chatId]?.bot?.status === status ? null : { ...all, [chatId]: { ...all[chatId], bot: { status, at: new Date().toISOString() } } },
  )
}

export async function forgetChatConfig(db: Database, chatId: string): Promise<void> {
  await mutateRawConfigs(db, (all) => {
    if (!(chatId in all)) return null
    const rest = { ...all }
    delete rest[chatId]
    return rest
  })
}

/** Группа стала супергруппой — Telegram дал ей новый id: переносим настройки. */
export async function moveChatConfig(db: Database, fromId: string, toId: string): Promise<void> {
  await mutateRawConfigs(db, (all) => {
    if (!all[fromId] || all[toId]?.mode) return null
    const rest = { ...all, [toId]: all[fromId]! }
    delete rest[fromId]
    return rest
  })
}

/** Ссылка-заявка бота в чат (создаётся один раз). */
export async function readInviteLink(db: DbLike, chatId: string): Promise<string | null> {
  return (await readRawConfigs(db))[chatId]?.inviteLink ?? null
}

export async function saveInviteLink(db: Database, chatId: string, link: string | null): Promise<void> {
  await mutateRawConfigs(db, (all) => {
    const cur = { ...all[chatId] }
    if (link) cur.inviteLink = link
    else delete cur.inviteLink
    return { ...all, [chatId]: cur }
  })
}

export const botActive = (c: ChatConfig): boolean => c.bot.status !== 'left' && c.bot.status !== 'kicked'

/** Чаты, подписанные на категорию уведомлений (кроме заявок — у них свой путь). */
export async function chatsForCategory(db: Database, cat: BroadcastCategory): Promise<{ chatId: string; threadId: number | null }[]> {
  const configs = await readAllChatConfigs(db)
  return [...configs.entries()].filter(([, c]) => c.notify[cat].on && botActive(c)).map(([chatId, c]) => ({ chatId, threadId: c.notify[cat].threadId }))
}
