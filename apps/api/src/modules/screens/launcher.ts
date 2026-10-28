/**
 * ТВ в кабинке — главный экран Titan TV, привязанный к экрану HUB (миграция 091).
 *
 * Реклама: тот же блок, что в ленте ТВ с меню — картинки и карточки с QR. По умолчанию
 * берётся лента первого экрана с меню, можно выбрать ленту другого экрана или свою.
 * ТВ рисует QR сам (нативный экран, без SVG), поэтому карточка приходит с матрицей QR.
 *
 * Пульт: HUB публикует команду в канал экранов клуба (Redis), ТВ держит поток
 * /screens/device/stream и выполняет её сразу. Так же ТВ узнаёт, что реклама
 * поменялась, — и перезапрашивает её, не дожидаясь пульса.
 */
import { Redis } from 'ioredis'
import type { Database, Screen } from '@titan/database'
import { screenSlides, eq, and, asc } from '@titan/database'
import { bandReady, defaultMenuScreen } from './screen-content.js'
import { qrBits, screensChannel, type LauncherAd, type ScreenSignal } from './launcher-protocol.js'

export * from './launcher-protocol.js'

/** Сколько ТВ получили сигнал: 0 — ни один поток этого клуба не слушает. */
export async function publishScreenSignal(clubId: string | null | undefined, signal: ScreenSignal): Promise<number> {
  const redis = new Redis(process.env['REDIS_URL'] ?? 'redis://redis:6379')
  try {
    return await redis.publish(screensChannel(clubId), JSON.stringify(signal))
  } catch {
    return 0
  } finally {
    redis.disconnect()
  }
}

/** Чья лента рекламы идёт на этот ТВ: выбранного экрана или первого экрана с меню. */
async function adsSourceId(db: Database, screen: Screen): Promise<string | null> {
  if (!screen.adsEnabled) return null
  return screen.adsScreenId ?? (await defaultMenuScreen(db))?.id ?? null
}

/** Реклама для ТВ в кабинке: включённые картинки и карточки ленты по порядку. */
export async function launcherAds(db: Database, screen: Screen): Promise<LauncherAd[]> {
  const sourceId = await adsSourceId(db, screen)
  if (!sourceId) return []
  const rows = await db.select().from(screenSlides)
    .where(and(eq(screenSlides.screenId, sourceId), eq(screenSlides.placement, 'band'), eq(screenSlides.isActive, true)))
    .orderBy(asc(screenSlides.sortOrder), asc(screenSlides.createdAt))
  const ads: LauncherAd[] = []
  for (const sl of rows.filter(bandReady)) {
    const isCard = sl.kind === 'card'
    ads.push({
      kind: isCard ? 'card' : 'image',
      imageUrl: isCard ? null : sl.imageUrl,
      title: isCard ? sl.title : null,
      body: isCard ? sl.body : null,
      qr: isCard && sl.linkUrl ? await qrBits(sl.linkUrl) : null,
      durationSec: sl.durationSec,
      fit: sl.fit,
    })
  }
  return ads
}
