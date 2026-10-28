/**
 * Протокол ТВ в кабинке (Titan TV) без базы: что ТВ присылает о себе, команды пульта,
 * сигналы в канале экранов клуба, QR карточек рекламы матрицей и отпечаток рекламы.
 * БД и Redis — в launcher.ts.
 */
import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { clubChannelSuffix } from '../../lib/realtime.js'

const text = (max: number) => z.string().transform((s) => s.trim().slice(0, max))

/** Что ТВ сообщает о себе в пульсе; длинные строки обрезаются, а не отклоняются. */
export const DeviceStateSchema = z.object({
  screen: z.enum(['home', 'saver', 'cinema', 'app', 'input']),
  app: text(60).nullable().optional(),
  airplay: z.object({
    title: text(200),
    artist: text(200),
    client: text(80),
    playing: z.boolean(),
  }).nullable().optional(),
  volume: z.object({
    level: z.number().int().min(0).max(100),
    max: z.number().int().min(1).max(100),
    muted: z.boolean(),
  }).nullable().optional(),
  ha: z.enum(['connected', 'connecting', 'offline', 'auth_failed', 'idle']).nullable().optional(),
})

/**
 * Команды пульта из HUB:
 *   home — главный экран (закрывает приложение гостя), screensaver — заставка,
 *   reset — после гостей: главный экран, закрыть приложения, обычная громкость,
 *   message — надпись поверх всего, что идёт на ТВ, volume — громкость в процентах,
 *   mute — выключить или вернуть звук.
 */
export const CommandSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('home') }),
  z.object({ action: z.literal('screensaver') }),
  z.object({ action: z.literal('reset') }),
  z.object({
    action: z.literal('message'),
    text: z.string().trim().min(1, 'Напишите сообщение').max(200),
    seconds: z.number().int().min(5).max(120).default(20),
  }),
  z.object({ action: z.literal('volume'), percent: z.number().int().min(0).max(100) }),
  z.object({ action: z.literal('mute'), muted: z.boolean() }),
])

export type ScreenCommand = z.infer<typeof CommandSchema>

/** Сигнал ТВ: команда одному экрану или «реклама поменялась» всем ('*'). */
export type ScreenSignal =
  | { type: 'command'; screenId: string; command: ScreenCommand & { id: string } }
  | { type: 'content'; screenId: string }

export const screensChannel = (clubId: string | null | undefined) => `titan:screens:${clubChannelSuffix(clubId)}`

export const commandSignal = (screenId: string, command: ScreenCommand): ScreenSignal =>
  ({ type: 'command', screenId, command: { ...command, id: randomUUID() } })

/** Сигнал касается этого ТВ? Битое сообщение канала — нет. */
export function signalFor(screenId: string, raw: string): ScreenSignal | null {
  try {
    const signal = JSON.parse(raw) as ScreenSignal
    if (signal?.type !== 'command' && signal?.type !== 'content') return null
    return signal.screenId === screenId || signal.screenId === '*' ? signal : null
  } catch {
    return null
  }
}

/** QR как матрица: size×size символов '1' (тёмный модуль) и '0' построчно. */
export type QrBits = { size: number; bits: string }

const qrCache = new Map<string, QrBits>()
export async function qrBits(url: string): Promise<QrBits | null> {
  const hit = qrCache.get(url)
  if (hit) return hit
  try {
    const QRCode = await import('qrcode')
    const { modules } = QRCode.create(url, { errorCorrectionLevel: 'M' })
    const qr = { size: modules.size, bits: Array.from(modules.data, (m) => (m ? '1' : '0')).join('') }
    if (qrCache.size > 100) qrCache.clear()
    qrCache.set(url, qr)
    return qr
  } catch {
    return null
  }
}

export type LauncherAd = {
  kind: 'image' | 'card'
  imageUrl: string | null
  title: string | null
  body: string | null
  qr: QrBits | null
  durationSec: number
  fit: string
}

/** Отпечаток рекламы: ТВ сравнивает его из пульса и перезапрашивает только новое. */
export const adsVersion = (ads: LauncherAd[]) =>
  createHash('sha1').update(JSON.stringify(ads)).digest('hex').slice(0, 16)
