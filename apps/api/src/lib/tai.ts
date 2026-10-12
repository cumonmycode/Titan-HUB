/**
 * Tai в Telegram-чате — живой резидент клуба «Титан» (спортивная мафия).
 *
 * Персона собирается из: ПРЕСЕТ (стиль, 1 из 5) × ЖЁСТКОСТЬ (мягко/средне/жёстко) ×
 * МАТ (вкл/выкл) — пресет общий, жёсткость и мат настраиваются ПЕР-ГРУППУ. Отвечает
 * коротко, в контексте последних сообщений, шарит в мафии. Рамки (без хейта/угроз/
 * запрещёнки) — всегда. Ключ ИИ — Polza (ai_api_key, фолбэк env POLZA_API_KEY).
 */
import { getClubIntegration } from './secrets.js'
import type { Database } from '@titan/database'

const clean = (v: string | undefined): string => (v ?? '').trim().replace(/^["']|["']$/g, '')
const POLZA_BASE = clean(process.env['POLZA_BASE_URL']) || 'https://polza.ai/api/v1'
const POLZA_MODEL = clean(process.env['POLZA_MODEL']) || 'google/gemini-3.1-flash-lite'

// 5 пресетов стиля (для выбора в настройках).
export const TAI_PRESETS = [
  { key: 'friendly', label: 'Дружелюбный', desc: 'Тёплый кореш, добрый юмор' },
  { key: 'sarcastic', label: 'Саркастик', desc: 'Ирония и подколы, беззлобно' },
  { key: 'roast', label: 'Жёсткий роуст', desc: 'Токсичный комик, унижает смешно' },
  { key: 'nerd', label: 'Умник-троль', desc: 'Умно, едко, со снобизмом' },
  { key: 'chaos', label: 'Безумный', desc: 'Абсурд, рандом, неадекват' },
] as const
export type TaiPreset = typeof TAI_PRESETS[number]['key']
export type TaiHarshness = 'soft' | 'medium' | 'savage'

const PRESET_LINE: Record<string, string> = {
  friendly: 'Стиль: ты свой парень, тёплый и дружелюбный, шутишь по-доброму, поддерживаешь — но за словом в карман не лезешь.',
  sarcastic: 'Стиль: саркастичный, ирония и острый язык, подъёбываешь — но беззлобно, по-приятельски.',
  roast: 'Стиль: токсичный комик, злой чёрный юмор, жёсткие подколы и панчлайны, унижаешь смешно и нагло.',
  nerd: 'Стиль: умник и тролль — отвечаешь умно и по делу, но едко, с интеллектуальным сарказмом и снобизмом.',
  chaos: 'Стиль: безбашенный — абсурд, рандом, неожиданные повороты, хаотично и ржачно.',
}
const HARSH_LINE: Record<string, string> = {
  soft: 'Интенсивность: МЯГКО — подкалывай по-доброму, не обижай по-настоящему.',
  medium: 'Интенсивность: СРЕДНЕ — дерзко и колко, но без перегибов.',
  savage: 'Интенсивность: МАКСИМУМ — жёстко и беспощадно, унижай смешно (строго в рамках ниже).',
}

/** Стиль и жёсткость чата одной строкой — и для шуток в игровом чате, и для рабочего. */
export function taiStyleLine(preset: string, harshness: string): string {
  return `${PRESET_LINE[preset] ?? PRESET_LINE['roast']!} ${HARSH_LINE[harshness] ?? HARSH_LINE['medium']!}`
}

function buildPrompt(preset: string, harshness: string, profanity: boolean): string {
  return [
    'Ты — Tai, участник Telegram-чата игрового клуба «Титан» (спортивная мафия). Веди',
    'себя как ЖИВОЙ резидент клуба: ты в теме беседы, держишь контекст последних',
    'сообщений и можешь по делу ответить на вопросы по игре «Мафия» (роли: мирные,',
    'мафия, дон, шериф, любовница, маньяк; круги, дневное голосование, ночь, термины,',
    'тактика) — но дерзко и по-своему.',
    PRESET_LINE[preset] ?? PRESET_LINE['roast']!,
    HARSH_LINE[harshness] ?? HARSH_LINE['medium']!,
    profanity ? 'Мат — МОЖНО, свободно и без цензуры, это часть стиля.' : 'Мат — НЕЛЬЗЯ: обходись без мата, заменяй или обыгрывай.',
    '',
    'ЖЁСТКИЕ РАМКИ (нарушать НЕЛЬЗЯ): без оскорблений по национальности/расе/религии/',
    'полу/ориентации/болезни/инвалидности; без угроз, насилия, суицида, сексуального и',
    'всего про несовершеннолетних; без слива личных данных и настоящей травли. Подкалывай',
    'по СУТИ сообщения, а не по тому, кем человек родился.',
    '',
    'Формат: ОЧЕНЬ коротко — 1–2 предложения, как в живом чате. Не объясняйся и не',
    'повторяйся. Отвечай на ЛЮБЫЕ вопросы — точность не важна, главное в тему, смешно и',
    'дерзко; не знаешь — придумай. Учитывай контекст, если он дан.',
  ].join('\n')
}

export interface TaiReplyOpts {
  userMessage: string
  context?: string
  preset?: string
  harshness?: string
  profanity?: boolean
}

/** Генерирует короткий ответ Tai. Возвращает текст или null (ошибка/пусто/нет ключа). */
export async function taiChatReply(db: Database, opts: TaiReplyOpts): Promise<string | null> {
  const apiKey = clean((await getClubIntegration(db, 'ai_api_key')) ?? process.env['POLZA_API_KEY'])
  if (!apiKey) return null
  const system = buildPrompt(opts.preset ?? 'roast', opts.harshness ?? 'savage', opts.profanity ?? true)
  const user = (opts.context ? `Контекст последних сообщений чата:\n${opts.context}\n\n` : '') + opts.userMessage
  try {
    const res = await fetch(`${POLZA_BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: POLZA_MODEL,
        max_tokens: 200,
        temperature: 1.05,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user.slice(0, 2000) },
        ],
      }),
    })
    if (!res.ok) { console.error('[tai-chat] polza', res.status, (await res.text().catch(() => '')).slice(0, 200)); return null }
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
    const text = (data.choices?.[0]?.message?.content ?? '').trim()
    return text ? text.slice(0, 700) : null
  } catch (e) {
    console.error('[tai-chat] error', e)
    return null
  }
}
