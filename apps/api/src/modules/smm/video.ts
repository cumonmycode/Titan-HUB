/**
 * Видео нейросетью (Veo 3.1 Fast, 8 с, 9:16, ~45 ₽) — так, чтобы оно было реалистичным
 * и снятым у нас, а не в выдуманном клубе:
 *  1. Tai продумывает одну сцену: где (зона клуба), кто, что делает, камера, свет, звук.
 *  2. Первый кадр — фотореалистичная картинка в этой зоне по её настоящим фото (3 ₽);
 *     если у поста уже есть живое вертикальное фото — можно начать с него.
 *  3. Veo оживляет кадр (режим «первый кадр») по подробному промпту на английском — так
 *     модель понимает его лучше всего; переводчик Polza выключен.
 * Готовое видео подхватывает крон (pollVideos).
 */
import type { Database } from '@titan/database'
import { z } from 'zod'
import { storeRemoteMedia } from '../../lib/imageStore.js'
import { chatJson, generateImage, startVideo } from './ai.js'
import { clubTitle } from './context.js'
import { insertMedia, loadPost, nextSort, setPostProgress, updatePost } from './db.js'
import { zoneRefs } from './interior.js'
import { listZones, usableZones, zoneByCode, zoneDescription, zonesText } from './knowledge.js'
import { mafiaKnowledge } from './mafia.js'
import { FORMAT_LABEL, PLATFORM_LABEL } from './prompts.js'
import { SmmError, step, type SmmPost } from './types.js'

const VIDEO_ASPECT = '9:16' as const
/** Примерно столько Veo снимает 8 секунд — для шкалы. */
const VIDEO_ETA_SEC = 150

const PlanSchema = z.object({
  scene: z.string().min(20).max(600),
  zone: z.string().max(8).nullable().optional(),
  usePostImage: z.boolean().optional(),
  keyframe: z.string().min(40).max(3000),
  prompt: z.string().min(200).max(4000),
})

/** Как писать промпт видео (Veo) — главное для реализма. */
const VEO_RULES = [
  'prompt — промпт для видеомодели Veo, СТРОГО НА АНГЛИЙСКОМ, 120–220 слов, одна непрерывная сцена 8 секунд, вертикально 9:16, начинается ровно с первого кадра (keyframe).',
  'Порядок: Shot & camera → Subject & action → Setting → Lighting & color → Sound → Style → Avoid.',
  '- Camera: одно простое движение (slow push-in, gentle handheld follow, slow orbit, static tripod), объектив (35mm/50mm), малая глубина резкости. Никаких склеек и смены планов.',
  '- Subject & action: 1–2 простых, физически правдоподобных действия на 8 секунд; люди двигаются естественно, тонкая мимика, реальные руки и предметы (карточки ролей, маски, фишки, бокалы).',
  '- Setting: если сцена в зоне клуба — помещение словами из опоры зоны (layout, colors, materials), точно как на первом кадре, ничего не добавлять; если нет — место, которого требует сюжет, конкретно и правдоподобно.',
  '- Lighting & color: реальные источники света места (у зоны — её свет и цвета); без «волшебного» сияния.',
  '- Sound: живой звук помещения (low murmur of players, shuffling cards, chips, soft background music). Речь — только если без неё никак: одна короткая фраза по-русски в кавычках с описанием, кто говорит; иначе «no dialogue».',
  '- Style: photorealistic, documentary realism, shot on a modern cinema camera / flagship smartphone, natural skin texture and pores, real-world physics, 24fps natural motion blur, subtle film grain. Looks like real footage, not CGI.',
  '- Avoid: on-screen text, subtitles, captions, logos, watermarks, distorted or melting faces, extra fingers, morphing objects, cartoon or 3D-render look, slow motion, sudden cuts.',
  'keyframe — промпт первого кадра ПО-РУССКИ для фотореалистичной картинки 9:16: та же сцена в первую секунду (в зоне — если выбрал зону), как настоящая фотография (свет, лица, кожа, фактуры), без текста и логотипов на кадре, люди — без узнаваемых лиц крупным планом.',
  'Мафия в кадре — по справке: спортивная — 10 игроков в масках за одним столом, Судья; городская — ведущий и больше игроков. Не смешивай.',
].join('\n')

/** Зона — только когда сюжет действительно у нас в клубе. */
export const ZONE_CHOICE = [
  'Зона клуба ("zone", код З1…) — только если этого требует сюжет или тема: игра, турнир, вечер, ДР или корпоратив у нас, показ помещения, бар, кабинки.',
  'Если сцена не про наш клуб (поздравление, мем, правило игры, атмосфера, улица, люди вне клуба) — "zone": null, место придумай под сюжет.',
].join(' ')

/** Живое вертикальное фото публикации (архив или своё) — с него можно начать видео. */
function postImageFrame(post: SmmPost): string | null {
  const frame = post.media.find((m) => m.kind === 'image' && m.status === 'done' && m.selected && m.aspect === VIDEO_ASPECT && m.url && (m.source === 'archive' || m.source === 'upload'))
  return frame?.url ?? null
}

/** Продумать сцену, сделать первый кадр и запустить Veo. Пост уже занят (busy = video). */
export async function makePostVideo(db: Database, postId: string, wish?: string): Promise<void> {
  const post = await loadPost(db, postId)
  if (!post) throw new SmmError('Публикация не найдена', 404)
  try {
    await setPostProgress(db, post.id, step('Продумываю сцену видео', 3, 15, 15))
    const [name, zones] = await Promise.all([clubTitle(db), listZones(db)])
    const ownFrame = postImageFrame(post)
    const plan = await chatJson(db, {
      system: `Ты — Tai, SMM-менеджер и режиссёр коротких видео клуба мафии «${name}». Ставишь задачу видеомодели так, чтобы ролик выглядел как настоящая съёмка в нашем клубе. Ответ — один JSON.`,
      note: `сцена видео ${post.id}`,
      maxTokens: 3000,
      temperature: 0.6,
      schema: PlanSchema,
      user: [
        `Публикация: ${PLATFORM_LABEL[post.platform]}, ${FORMAT_LABEL[post.format]}. Тема: ${post.topic}.`,
        post.brief ? `Идея: ${post.brief}` : '',
        post.visual ? `Визуал: ${post.visual}` : '',
        post.script ? `Сценарий: зацепка «${post.script.hook}»; кадры: ${post.script.shots.map((s, i) => `${i + 1}) ${s.text}`).join(' ')}` : '',
        wish ? `Пожелание к видео: ${wish}` : '',
        zonesText(zones),
        usableZones(zones).length ? ZONE_CHOICE : 'Фото зон клуба ещё нет: если сцена в клубе — опиши помещение как тёмный уютный клуб мафии с игровым столом.',
        ownFrame ? 'У публикации есть живое вертикальное фото — "usePostImage": true, если сцену можно начать с него (тогда keyframe опиши по этому фото).' : '',
        `Справка по мафии (для правдоподобия сцены):\n${mafiaKnowledge('brief')}`,
        '',
        VEO_RULES,
        '',
        'Ответ — JSON: {"scene": "одной-двумя фразами по-русски, что в ролике", "zone": "З2" | null, "usePostImage": false, "keyframe": "...", "prompt": "..."}',
      ].filter(Boolean).join('\n'),
    })
    const zone = zoneByCode(zones, plan.zone ?? undefined)
    let firstFrame = plan.usePostImage && ownFrame ? ownFrame : null
    if (!firstFrame) {
      await setPostProgress(db, post.id, step('Делаю первый кадр в клубе', 15, 35, 30))
      const where = zone ? `Место — настоящее помещение клуба «${zone.title}» (референсы — его фото с разных ракурсов): сохрани планировку, мебель, цвета и свет как на фото. ${zoneDescription(zone).slice(0, 600)}\n` : ''
      const frame = await generateImage(db, { prompt: `${where}${plan.keyframe}\nФотореализм: настоящая фотография, естественный свет помещения, живые фактуры. Без текста, надписей и логотипов на кадре.`, aspect: VIDEO_ASPECT, references: zoneRefs(zone), note: `кадр видео ${post.id}` })
      const stored = await storeRemoteMedia(frame.url)
      if (!stored.ok) throw new SmmError(`Первый кадр не сохранился: ${stored.error}`, 502)
      firstFrame = stored.url
    }
    await setPostProgress(db, post.id, step('Нейросеть снимает видео', 35, 97, VIDEO_ETA_SEC))
    const setting = zone?.anchor ? `\nSetting reference (keep exactly as in the first frame): ${zone.anchor}` : ''
    const { polzaId, model } = await startVideo(db, { prompt: `${plan.prompt}${setting}`, aspect: VIDEO_ASPECT, firstFrame, english: true })
    await insertMedia(db, { postId: post.id, kind: 'video', source: 'ai', status: 'pending', aspect: VIDEO_ASPECT, prompt: `${plan.scene}\n\n${plan.prompt}`, model, polzaId, sort: await nextSort(db, post.id) })
  } catch (error) {
    await updatePost(db, post.id, { busy: null, error: error instanceof Error ? `Видео не получилось: ${error.message}`.slice(0, 300) : 'Видео не получилось' })
    throw error
  }
}

export function makePostVideoInBackground(db: Database, postId: string, wish?: string): void {
  void makePostVideo(db, postId, wish).catch((error) => console.error('[smm] видео', postId, error instanceof Error ? error.message : error))
}
