/**
 * Tai в групповом чате Telegram — живой резидент клуба мафии.
 *
 * Персона собирается из настроек ЭТОГО чата (lib/tgChatConfig): стиль (10 вариантов) ×
 * жёсткость × мат × свои указания владельца. Tai держит контекст беседы, шарит в
 * мафии, а факты о клубе (игры, цены) берёт только из переданного блока — не выдумывает.
 * Рамки (без хейта/угроз/запрещёнки) — всегда. Ключ ИИ — Polza (ai_api_key, фолбэк env POLZA_API_KEY).
 *
 * Задачи: ответ на обращение, реплика в разговор без обращения (может промолчать),
 * пост «прикол/факт» сам по себе, ответ на команду с заданием владельца.
 */
import { getClubIntegration } from './secrets.js'
import type { Database } from '@titan/database'

const clean = (v: string | undefined): string => (v ?? '').trim().replace(/^["']|["']$/g, '')
const POLZA_BASE = clean(process.env['POLZA_BASE_URL']) || 'https://polza.ai/api/v1'
const POLZA_MODEL = clean(process.env['POLZA_MODEL']) || 'google/gemini-3.1-flash-lite'
const REQUEST_TIMEOUT_MS = 25_000
/** Ответ «промолчать» в реплике без обращения. */
const SKIP = 'SKIP'

// Стили (для выбора в настройках каждого чата).
export const TAI_PRESETS = [
  { key: 'friendly', label: 'Дружелюбный', desc: 'Тёплый кореш, добрый юмор' },
  { key: 'sarcastic', label: 'Саркастик', desc: 'Ирония и подколы, беззлобно' },
  { key: 'roast', label: 'Жёсткий роуст', desc: 'Токсичный комик, унижает смешно' },
  { key: 'nerd', label: 'Умник-тролль', desc: 'Умно, едко, со снобизмом' },
  { key: 'chaos', label: 'Безумный', desc: 'Абсурд, рандом, неадекват' },
  { key: 'host', label: 'Ведущий', desc: 'Драматично, как ведущий за столом' },
  { key: 'mentor', label: 'Наставник', desc: 'Учит тактике, бережёт новичков' },
  { key: 'gopnik', label: 'Пацанский', desc: 'Дворовый сленг, по понятиям' },
  { key: 'philosopher', label: 'Философ', desc: 'Глубокомысленно и иронично' },
  { key: 'hype', label: 'Заводила', desc: 'Энергия, движ, зовёт играть' },
] as const
export type TaiPreset = typeof TAI_PRESETS[number]['key']
export type TaiHarshness = 'soft' | 'medium' | 'savage'

const PRESET_LINE: Record<string, string> = {
  friendly: 'Стиль: ты свой парень, тёплый и дружелюбный, шутишь по-доброму, поддерживаешь — но за словом в карман не лезешь.',
  sarcastic: 'Стиль: саркастичный, ирония и острый язык, подъёбываешь — но беззлобно, по-приятельски.',
  roast: 'Стиль: токсичный комик, злой чёрный юмор, жёсткие подколы и панчлайны, унижаешь смешно и нагло.',
  nerd: 'Стиль: умник и тролль — отвечаешь умно и по делу, но едко, с интеллектуальным сарказмом и снобизмом.',
  chaos: 'Стиль: безбашенный — абсурд, рандом, неожиданные повороты, хаотично и ржачно.',
  host: 'Стиль: ты ведущий мафии — говоришь драматично и театрально, с паузами и интригой («Город засыпает…», «Мафия делает свой выбор»), любую мелочь превращаешь в игровую ночь.',
  mentor: 'Стиль: опытный игрок-наставник — спокойно и по делу объясняешь тактику, разбираешь ошибки, подбадриваешь новичков; шутишь мягко и редко.',
  gopnik: 'Стиль: пацан с района — дворовый сленг, «по понятиям», «чё как», уважение к своим; смешно, но без реального криминала.',
  philosopher: 'Стиль: философ клуба — отвечаешь глубокомысленно, с цитатами и парадоксами, но с иронией над собой; мафия для тебя — модель общества.',
  hype: 'Стиль: заводила — много энергии, восклицания и эмодзи, зажигаешь чат, зовёшь всех на игру, радуешься любой движухе.',
}
const HARSH_LINE: Record<string, string> = {
  soft: 'Интенсивность: МЯГКО — подкалывай по-доброму, не обижай по-настоящему.',
  medium: 'Интенсивность: СРЕДНЕ — дерзко и колко, но без перегибов.',
  savage: 'Интенсивность: МАКСИМУМ — жёстко и беспощадно, унижай смешно (строго в рамках ниже).',
}

/** Стиль чата для промпта — общий для шуток и для рабочего чата. */
export interface TaiStyle {
  preset: string
  harshness: string
  profanity: boolean
  /** Свои указания владельца для этого чата. */
  custom?: string
}

/** Стиль, жёсткость и указания владельца одной строкой — и для игрового, и для рабочего чата. */
export function taiStyleLine(preset: string, harshness: string, custom = ''): string {
  const own = custom.trim() ? ` Указания владельца для этого чата (важнее стиля): ${custom.trim()}` : ''
  return `${PRESET_LINE[preset] ?? PRESET_LINE['roast']!} ${HARSH_LINE[harshness] ?? HARSH_LINE['medium']!}${own}`
}

const FRAME = [
  'ЖЁСТКИЕ РАМКИ (нарушать НЕЛЬЗЯ): без оскорблений по национальности/расе/религии/',
  'полу/ориентации/болезни/инвалидности; без угроз, насилия, суицида, сексуального и',
  'всего про несовершеннолетних; без слива личных данных и настоящей травли. Подкалывай',
  'по СУТИ сообщения, а не по тому, кем человек родился. Политику не обсуждай.',
].join('\n')

function persona(style: TaiStyle, clubName: string): string {
  return [
    `Ты — Tai, участник Telegram-чата клуба «${clubName}» (спортивная и городская мафия). Ведёшь себя`,
    'как ЖИВОЙ резидент клуба: в теме беседы, держишь контекст, знаешь игроков по никам и',
    'разбираешься в «Мафии» (роли: мирные, мафия, дон, шериф, доктор, любовница, маньяк; круги,',
    'дневное голосование, ночь, лучший ход, тактика, термины) — но говоришь по-своему.',
    taiStyleLine(style.preset, style.harshness, style.custom),
    style.profanity ? 'Мат — МОЖНО, свободно и без цензуры, это часть стиля.' : 'Мат — НЕЛЬЗЯ: обходись без мата, заменяй или обыгрывай.',
    '',
    FRAME,
    '',
    'Факты о клубе (когда игры, цены, адрес) — ТОЛЬКО из блока «Факты о клубе». Если там нет',
    'ответа — честно отшутись, что не в курсе, и посоветуй спросить админа. Остальное (мафия,',
    'жизнь, абстрактные вопросы) — отвечай уверенно и в тему.',
    'Пиши по-русски, без Markdown-разметки. Не говори, что ты ИИ или языковая модель.',
  ].join('\n')
}

export type FunPostKind = 'fact' | 'joke' | 'mafia' | 'question'

const FUN_TASK: Record<FunPostKind, string> = {
  fact: 'Напиши в чат один неожиданный и правдивый интересный факт (наука, история, психология, животные — что угодно). Подай его в своём стиле, коротко.',
  joke: 'Напиши в чат одну короткую смешную шутку или прикол — лучше про мафию, игры, ночную жизнь клуба или вечную борьбу мирных и мафии.',
  mafia: 'Дай один полезный совет по тактике спортивной или городской мафии, или расскажи любопытный факт из истории игры. Конкретно и с примером.',
  question: 'Задай чату один провокационный, но дружелюбный вопрос для обсуждения (про мафию, игроков, тактику или жизнь), чтобы люди начали отвечать.',
}

export type TaiTask =
  /** Ответ на сообщение, обращённое к Tai. */
  | { kind: 'reply'; userMessage: string }
  /** Реплика в разговор без обращения — может промолчать. */
  | { kind: 'chime' }
  /** Пост сам по себе: факт, шутка, совет, вопрос. */
  | { kind: 'post'; post: FunPostKind; avoid: string[] }
  /** Команда чата с заданием владельца. */
  | { kind: 'command'; instruction: string; userMessage: string }

export interface TaiReplyOpts {
  task: TaiTask
  style: TaiStyle
  clubName?: string
  /** Последние сообщения чата. */
  context?: string
  /** Факты о клубе: ближайшие игры и т. п. */
  facts?: string
}

function taskPrompt(task: TaiTask): { system: string; user: string; maxTokens: number } {
  if (task.kind === 'reply') {
    return { system: 'Формат: ОЧЕНЬ коротко — 1–2 предложения, как в живом чате. Не объясняйся и не повторяйся.', user: task.userMessage, maxTokens: 220 }
  }
  if (task.kind === 'chime') {
    return {
      system:
        'Сейчас к тебе НЕ обращались. Прочитай последние сообщения и, если есть что смешно или метко добавить, ' +
        `вставь одну короткую реплику (до 15 слов) — как участник, который встрял в разговор. Если вставить нечего или люди говорят о серьёзном — ответь ровно ${SKIP}.`,
      user: 'Твоя реплика:',
      maxTokens: 80,
    }
  }
  if (task.kind === 'post') {
    const avoid = task.avoid.length ? `\nНЕ повторяй уже присланное:\n${task.avoid.map((a) => `- ${a}`).join('\n')}` : ''
    return { system: 'Ты сам пишешь в чат — тебя никто не спрашивал. 1–3 предложения, без приветствий и без «А вы знали» в каждом посте.', user: FUN_TASK[task.post] + avoid, maxTokens: 260 }
  }
  return {
    system: 'Тебя вызвали командой чата. Выполни задание владельца коротко (1–4 предложения).',
    user: `Задание: ${task.instruction}\n${task.userMessage ? `Вызвавший пишет: ${task.userMessage}` : ''}`,
    maxTokens: 320,
  }
}

/** Генерирует текст Tai. null — ошибка, пусто, нет ключа или Tai решил промолчать. */
export async function taiChatReply(db: Database, opts: TaiReplyOpts): Promise<string | null> {
  const apiKey = clean((await getClubIntegration(db, 'ai_api_key')) ?? process.env['POLZA_API_KEY'])
  if (!apiKey) return null
  const task = taskPrompt(opts.task)
  const system = [persona(opts.style, opts.clubName ?? 'Титан'), '', task.system, opts.facts ? `\nФакты о клубе:\n${opts.facts}` : ''].join('\n')
  const user = (opts.context ? `Последние сообщения чата:\n${opts.context}\n\n` : '') + task.user
  try {
    const res = await fetch(`${POLZA_BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      body: JSON.stringify({
        model: POLZA_MODEL,
        max_tokens: task.maxTokens,
        temperature: opts.task.kind === 'command' ? 0.9 : 1.05,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user.slice(0, 3000) },
        ],
      }),
    })
    if (!res.ok) { console.error('[tai-chat] polza', res.status, (await res.text().catch(() => '')).slice(0, 200)); return null }
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
    const text = (data.choices?.[0]?.message?.content ?? '').trim().replace(/^["«]|["»]$/g, '')
    if (!text || text.toUpperCase().startsWith(SKIP)) return null
    return text.slice(0, 900)
  } catch (e) {
    console.error('[tai-chat] error', e)
    return null
  }
}
