/**
 * Интерьер клуба: Tai смотрит фото зоны с разных ракурсов, читает слова владельца и
 * дописывает описание — планировка, свет, цвета, мебель, декор, удачные ракурсы. Его
 * берут в промпты картинок и видео, а сами фото — в референсы, чтобы сцены были в
 * нашем помещении. Плюс короткая «опора» по-английски для видеомодели.
 */
import type { Database } from '@titan/database'
import { z } from 'zod'
import { chatJson, type ChatPart } from './ai.js'
import { clubTitle } from './context.js'
import { saveZoneAiText, setZoneProgress, zoneOr404, type Zone } from './knowledge.js'
import { SmmError, step } from './types.js'

/** Сколько фото зоны смотрит Tai за раз и сколько берёт в референсы картинки. */
const DESCRIBE_PHOTOS = 8
export const ZONE_REFS = 3
/** Описание зоны считается зависшим через столько — можно запустить заново. */
const STALE_MS = 5 * 60_000

const DescribeSchema = z.object({
  description: z.string().min(80).max(2500),
  angles: z.string().max(800),
  anchor: z.string().min(40).max(900),
})

const needsSource = (zone: Zone) => !zone.photos.length && !zone.ownerText.trim()

export async function describeZone(db: Database, zoneId: string): Promise<void> {
  const zone = await zoneOr404(db, zoneId)
  if (needsSource(zone)) throw new SmmError('Добавьте фото зоны или опишите её — Tai опирается на них', 400)
  try {
    await setZoneProgress(db, zone.id, step(`Смотрю фото: ${zone.title.toLowerCase()}`, 3, 95, 25 + zone.photos.length * 3))
    const name = await clubTitle(db)
    const content: ChatPart[] = [{
      type: 'text',
      text: [
        `Это помещение клуба мафии «${name}»: зона «${zone.title}». Фото — с разных ракурсов.`,
        zone.ownerText.trim() ? `Владелец пишет о зоне: ${zone.ownerText.trim()}` : '',
        'Опиши помещение так, чтобы по описанию можно было нарисовать или снять сцену именно здесь: планировка и размер, стены и пол (цвет, материал), свет (источники, цвет, тёплый или холодный, неон), мебель и столы, декор (логотипы, надписи, маски, картины), что обычно на столах, окна и двери, общее настроение.',
        'Только то, что видно на фото и сказано владельцем, без выдумок. Слова владельца — главнее.',
        'angles — какие ракурсы и сцены здесь удачные для фото и видео (2–4 варианта).',
        'anchor — то же коротко по-английски (2–4 предложения): визуальная опора для видеомодели — layout, colors, materials, lighting, key objects.',
        'Ответ — JSON: {"description": "4–8 предложений по-русски", "angles": "...", "anchor": "..."}',
      ].filter(Boolean).join('\n'),
    }]
    zone.photos.slice(0, DESCRIBE_PHOTOS).forEach((photo, i) => {
      content.push({ type: 'text', text: `Фото ${i + 1}:` }, { type: 'image_url', image_url: { url: photo.url } })
    })
    const r = await chatJson(db, {
      kind: zone.photos.length ? 'vision' : 'text',
      note: `интерьер: ${zone.title}`,
      maxTokens: 2500,
      temperature: 0.3,
      schema: DescribeSchema,
      system: 'Ты описываешь интерьер для дизайнера и оператора. Конкретно, без оценок и рекламы. Ответ — один JSON.',
      user: content,
    })
    await saveZoneAiText(db, zone.id, `${r.description.trim()}\nУдачные ракурсы: ${r.angles.trim()}`, r.anchor.trim())
  } catch (error) {
    await setZoneProgress(db, zone.id, null, error instanceof Error ? error.message.slice(0, 300) : 'Не получилось')
    throw error
  }
}

export async function describeZoneInBackground(db: Database, zoneId: string): Promise<boolean> {
  const zone = await zoneOr404(db, zoneId)
  if (zone.progress && Date.now() - Date.parse(zone.progress.at) < STALE_MS) return false
  if (needsSource(zone)) throw new SmmError('Добавьте фото зоны или опишите её — Tai опирается на них', 400)
  await setZoneProgress(db, zone.id, step(`Смотрю фото: ${zone.title.toLowerCase()}`, 2, 10, 5))
  void describeZone(db, zoneId).catch((error) => console.error('[smm] описание зоны', zone.title, error instanceof Error ? error.message : error))
  return true
}

/** Фото зоны для референсов картинки: первые несколько ракурсов. */
export const zoneRefs = (zone: Zone | undefined): string[] => (zone ? zone.photos.slice(0, ZONE_REFS).map((p) => p.url) : [])
