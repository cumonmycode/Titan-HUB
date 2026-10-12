/**
 * Голос Tai — нейросетевая озвучка через Polza (/audio/speech).
 *
 * Системный голос телефона звучит роботом, поэтому ответ озвучивает сервер: по
 * фразам, пока модель ещё пишет, — первая фраза звучит через ~1–2 с после её
 * окончания. Модель и голос — в env (TAI_TTS_MODEL, TAI_TTS_VOICE), чтобы сменить
 * голос без сборки приложения.
 */
import { POLZA_BASE } from './llm.js'
import { speakable } from './ru-speech.js'
import { voiceById, type TaiSettings } from './settings.js'

// Подача для моделей, которые её понимают (OpenAI gpt-4o-mini-tts).
const INSTRUCTIONS = 'Говори по-русски живо и непринуждённо, как дружелюбный коллега в клубе: разговорно, с лёгкой улыбкой, в среднем темпе.'
const TIMEOUT_MS = 20_000

export type SpeechAudio = { format: 'mp3' | 'wav'; data: string }

/** Сырой PCM 16 бит моно (Gemini, Microsoft) → WAV, который играет любой плеер. */
function pcmToWav(pcm: Buffer, sampleRate = 24_000): Buffer {
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}

/** Озвучить фразу. null — синтез не удался (клиент тогда промолчит, текст уже на экране). */
export async function synthesize(apiKey: string, text: string, voiceSettings: Pick<TaiSettings, 'voice' | 'speed'>, signal?: AbortSignal): Promise<SpeechAudio | null> {
  const input = speakable(text).slice(0, 1_000)
  if (!input) return null
  const { model: MODEL, voice: VOICE, tunable } = voiceById(voiceSettings.voice)
  const openai = tunable
  try {
    const res = await fetch(`${POLZA_BASE}/audio/speech`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: MODEL, voice: VOICE, input, ...(openai ? { response_format: 'mp3', instructions: INSTRUCTIONS, speed: voiceSettings.speed } : {}) }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]) : AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) {
      console.error('[tai] tts', res.status, (await res.text().catch(() => '')).slice(0, 200))
      return null
    }
    const body = (await res.json()) as { audio?: string; contentType?: string }
    if (!body.audio) return null
    const bytes = Buffer.from(body.audio, 'base64')
    const type = body.contentType ?? ''
    if (type.includes('mpeg') || type.includes('mp3') || bytes.subarray(0, 3).toString() === 'ID3' || bytes[0] === 0xff) return { format: 'mp3', data: body.audio }
    if (bytes.subarray(0, 4).toString() === 'RIFF') return { format: 'wav', data: body.audio }
    return { format: 'wav', data: pcmToWav(bytes).toString('base64') }
  } catch (error) {
    if (!signal?.aborted) console.error('[tai] tts failed', error)
    return null
  }
}

const STT_MODEL = (process.env['TAI_STT_MODEL'] ?? '').trim() || 'openai/gpt-4o-mini-transcribe'
const STT_TIMEOUT_MS = 30_000

/** Распознать речь (webm из браузера, ogg/opus из Telegram). null — не вышло. */
export async function transcribe(apiKey: string, audio: Blob, filename: string): Promise<string | null> {
  const form = new FormData()
  form.set('model', STT_MODEL)
  form.set('language', 'ru')
  form.set('file', audio, filename)
  const res = await fetch(`${POLZA_BASE}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal: AbortSignal.timeout(STT_TIMEOUT_MS),
  }).catch(() => null)
  if (!res?.ok) {
    console.error('[tai] transcribe failed', res?.status, res ? (await res.text().catch(() => '')).slice(0, 200) : 'network')
    return null
  }
  const data = (await res.json().catch(() => ({}))) as { text?: string }
  return (data.text ?? '').trim()
}

/**
 * Голосовое сообщение для Telegram: весь ответ одним файлом. OpenAI-голоса сразу
 * отдают ogg/opus — Telegram показывает его как голосовое; остальные — mp3/wav.
 */
export async function synthesizeVoiceNote(apiKey: string, text: string, voiceSettings: Pick<TaiSettings, 'voice' | 'speed'>): Promise<{ data: Buffer; format: 'ogg' | 'mp3' } | null> {
  const input = speakable(text).slice(0, 2_000)
  if (!input) return null
  const { model, voice, tunable } = voiceById(voiceSettings.voice)
  try {
    const res = await fetch(`${POLZA_BASE}/audio/speech`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, voice, input, ...(tunable ? { response_format: 'opus', instructions: INSTRUCTIONS, speed: voiceSettings.speed } : {}) }),
      signal: AbortSignal.timeout(TIMEOUT_MS * 2),
    })
    if (!res.ok) {
      console.error('[tai] voice note', res.status, (await res.text().catch(() => '')).slice(0, 200))
      return null
    }
    const body = (await res.json()) as { audio?: string }
    if (!body.audio) return null
    const bytes = Buffer.from(body.audio, 'base64')
    if (bytes.subarray(0, 4).toString() === 'OggS') return { data: bytes, format: 'ogg' }
    if (bytes.subarray(0, 3).toString() === 'ID3' || bytes[0] === 0xff) return { data: bytes, format: 'mp3' }
    // Microsoft отдаёт PCM/WAV — голосовым его Telegram не покажет, промолчим текстом.
    return null
  } catch (error) {
    console.error('[tai] voice note failed', error)
    return null
  }
}

/** Конец законченной фразы в text после from; -1 — фраза ещё пишется. Короткие куски копим. */
function sentenceEnd(text: string, from: number): number {
  const rest = text.slice(from)
  // Первый кусок режем и по запятой/тире: короткая фраза озвучивается за ~1,5 с.
  const re = from === 0 ? /[.!?…,:—–](?=\s|$)|\n/g : /[.!?…](?=\s|$)|\n/g
  let end = -1
  let m: RegExpExecArray | null
  while ((m = re.exec(rest))) {
    const at = from + m.index + 1
    // Первая фраза — как можно раньше; следующие — не короче ~40 знаков, чтобы не дробить речь.
    if (at - from >= (from === 0 ? 14 : 40)) {
      end = at
      if (from === 0) break
    }
  }
  return end
}

/**
 * Озвучка ответа по мере печати: законченные фразы уходят в синтез сразу и
 * параллельно, звук отдаётся строго по порядку.
 */
export class SpeechStream {
  private spokenUpTo = 0
  private text = ''
  private seq = 0
  private chain: Promise<void> = Promise.resolve()

  constructor(
    private readonly apiKey: string,
    private readonly voice: Pick<TaiSettings, 'voice' | 'speed'>,
    /** upTo — сколько знаков текста ответа озвучено (клиент показывает текст вместе со звуком). */
    private readonly emit: (audio: SpeechAudio & { seq: number; upTo: number }) => Promise<void>,
    private readonly signal: AbortSignal,
  ) {}

  get spokeAnything(): boolean {
    return this.seq > 0
  }

  push(delta: string) {
    this.text += delta
    const end = sentenceEnd(this.text, this.spokenUpTo)
    if (end > this.spokenUpTo) this.enqueue(this.text.slice(this.spokenUpTo, end), end)
  }

  /** Дописанный хвост (или своя фраза, если текста не было) — и дождаться всего звука. */
  async finish(fallback?: string): Promise<void> {
    const rest = this.text.slice(this.spokenUpTo)
    if (rest.trim()) this.enqueue(rest, this.text.length)
    else if (!this.spokeAnything && fallback) this.enqueue(fallback, this.text.length)
    await this.chain
  }

  private enqueue(part: string, upTo: number) {
    this.spokenUpTo = upTo
    const seq = (this.seq += 1)
    const pending = synthesize(this.apiKey, part, this.voice, this.signal)
    this.chain = this.chain.then(async () => {
      const audio = await pending
      if (audio && !this.signal.aborted) await this.emit({ ...audio, seq, upTo })
    })
  }
}
