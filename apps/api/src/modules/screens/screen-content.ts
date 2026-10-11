/**
 * Что показывает экран Titan Menu — общее для /menu/public (старая ссылка AbleSign и
 * Titan Menu 1.0) и /screens/:id/public (экраны из раздела «Экраны»).
 *
 * Меню для гостя: сначала «Игровой вечер» (тарифы) и «Кабинки» (почасовая аренда зон)
 * по возрастанию цены, затем разделы меню в порядке владельца, позиции внутри — по
 * алфавиту. Только включённые и отмеченные «на экране ТВ» позиции/зоны с ценой > 0;
 * без себестоимости и остатков.
 */
import type { Database, Screen } from '@titan/database'
import { menuCategories, inventory, spaces, appSettings, screens, screenSlides, eq, and, asc, isNull } from '@titan/database'

export const SCREEN_THEMES = ['night', 'neon', 'deco', 'synth', 'avant', 'dossier', 'halloween'] as const

type Item = { name: string; price: number; perHour?: boolean }
export type MenuSection = { title: string; icon: string; featured: boolean; items: Item[] }

// QR для карточек: SVG по ссылке, с небольшим кэшем (экраны опрашивают сервер раз
// в 20 с — пересобирать один и тот же QR незачем).
const qrCache = new Map<string, string>()
async function qrSvg(url: string): Promise<string | null> {
  const hit = qrCache.get(url)
  if (hit) return hit
  try {
    const QRCode = await import('qrcode')
    const svg = await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#111111', light: '#ffffff' } })
    if (qrCache.size > 100) qrCache.clear()
    qrCache.set(url, svg)
    return svg
  } catch {
    return null
  }
}

export async function menuSections(db: Database): Promise<MenuSection[]> {
  const [cats, rows, spaceRows] = await Promise.all([
    db.select({ id: menuCategories.id, name: menuCategories.name, icon: menuCategories.icon })
      .from(menuCategories).where(eq(menuCategories.isActive, true)).orderBy(asc(menuCategories.sortOrder)),
    db.select({ name: inventory.name, category: inventory.category, price: inventory.price })
      .from(inventory)
      .where(and(eq(inventory.isActive, true), eq(inventory.isScreenVisible, true), isNull(inventory.deletedAt), eq(inventory.kind, 'goods'))),
    db.select({ name: spaces.name, type: spaces.type, hourlyRate: spaces.hourlyRate })
      .from(spaces).where(and(eq(spaces.isActive, true), eq(spaces.isScreenVisible, true))),
  ])

  const byName = (a: Item, b: Item) => a.name.localeCompare(b.name, 'ru', { numeric: true, sensitivity: 'base' })
  const byPrice = (a: Item, b: Item) => a.price - b.price || byName(a, b)

  const items = rows
    .map((r) => ({ name: r.name.trim(), category: r.category, price: Number(r.price) }))
    .filter((r) => r.name && r.price > 0)
  const pick = (category: string | null) => items
    .filter((i) => i.category === category)
    .map(({ name, price }) => ({ name, price }))

  const isTariffCat = (name: string) => name.toLowerCase().includes('тариф')
  const tariffItems: Item[] = []
  const menu: MenuSection[] = []
  for (const cat of cats) {
    const own = pick(cat.id)
    if (own.length === 0) continue
    if (isTariffCat(cat.name)) tariffItems.push(...own)
    else menu.push({ title: cat.name.trim(), icon: cat.icon, featured: false, items: own.sort(byName) })
  }
  const uncategorized = pick(null)
  if (uncategorized.length) menu.push({ title: 'Другое', icon: 'other', featured: false, items: uncategorized.sort(byName) })

  // Аренда зон — цена за час. Зона, заведённая ещё и позицией меню, не дублируется.
  const itemNames = new Set(items.map((i) => i.name.toLowerCase()))
  const rentable = spaceRows
    .map((s) => ({ name: s.name.trim(), type: s.type, price: Number(s.hourlyRate) }))
    .filter((s) => s.name && s.price > 0 && !itemNames.has(s.name.toLowerCase()))

  const sections: MenuSection[] = []
  if (tariffItems.length) {
    sections.push({ title: 'Игровой вечер', icon: 'tariffs', featured: true, items: tariffItems.sort(byPrice) })
  }
  if (rentable.length) {
    sections.push({
      title: rentable.every((s) => s.type.endsWith('_booth')) ? 'Кабинки' : 'Аренда',
      icon: 'rental',
      featured: true,
      items: rentable.map(({ name, price }) => ({ name, price, perHour: true })).sort(byPrice),
    })
  }
  return [...sections, ...menu]
}

export type ShowItem = {
  kind: 'menu' | 'image'
  imageUrl: string | null
  durationSec: number
  transition: string
  transitionMs: number
  fit: string
}

/** Показ, когда в нём ничего не включено: просто меню. */
const MENU_ONLY: ShowItem[] = [{ kind: 'menu', imageUrl: null, durationSec: 60, transition: 'fade', transitionMs: 900, fit: 'contain' }]

/**
 * Включённые элементы экрана по порядку: показ (меню и картинки на весь экран) и
 * реклама ленты меню (картинки и карточки, у карточек со ссылкой — готовый QR).
 */
async function screenContent(db: Database, screen: Screen) {
  const rows = await db.select().from(screenSlides)
    .where(and(eq(screenSlides.screenId, screen.id), eq(screenSlides.isActive, true)))
    .orderBy(asc(screenSlides.sortOrder), asc(screenSlides.createdAt))
  const playlist: ShowItem[] = []
  const band = []
  for (const sl of rows) {
    if (sl.placement === 'show') {
      if (sl.kind !== 'menu' && !(sl.kind === 'image' && sl.imageUrl)) continue
      playlist.push({
        kind: sl.kind === 'menu' ? 'menu' : 'image',
        imageUrl: sl.kind === 'image' ? sl.imageUrl : null,
        durationSec: sl.durationSec,
        transition: sl.transition,
        transitionMs: sl.transitionMs,
        fit: sl.fit,
      })
      continue
    }
    if (sl.kind === 'image' && !sl.imageUrl) continue
    if (sl.kind === 'card' && !sl.title && !sl.body && !sl.linkUrl) continue
    if (sl.kind === 'menu') continue
    band.push({
      kind: sl.kind,
      imageUrl: sl.kind === 'image' ? sl.imageUrl : null,
      title: sl.kind === 'card' ? sl.title : null,
      body: sl.kind === 'card' ? sl.body : null,
      qrSvg: sl.kind === 'card' && sl.linkUrl ? await qrSvg(sl.linkUrl) : null,
      durationSec: sl.durationSec,
      transition: sl.transition,
      fit: sl.fit,
    })
  }
  return { playlist: playlist.length ? playlist : MENU_ONLY, band }
}

async function venueName(db: Database): Promise<string | null> {
  const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, 'venue_name'))
  return row?.value || null
}

/**
 * Экран для старой ссылки /menu — первый экран, в показе которого есть меню (после
 * миграции 069 у «Экрана меню» он есть всегда). Нет такого — просто меню без экрана.
 */
export async function defaultMenuScreen(db: Database): Promise<Screen | null> {
  const [row] = await db.select({ screen: screens }).from(screens)
    .innerJoin(screenSlides, and(
      eq(screenSlides.screenId, screens.id),
      eq(screenSlides.placement, 'show'),
      eq(screenSlides.kind, 'menu'),
      eq(screenSlides.isActive, true),
    ))
    .orderBy(asc(screens.sortOrder), asc(screens.createdAt)).limit(1)
  return row?.screen ?? null
}

/**
 * Всё, что нужно странице экрана (public/tv-menu.html) для показа.
 * playlist — показ по кругу; slides — реклама в ленте меню. kind оставлен для страниц,
 * открытых до миграции 069: без меню в показе они видят слайдшоу из тех же картинок.
 */
export async function screenPayload(db: Database, screen: Screen | null) {
  const theme = screen && (SCREEN_THEMES as readonly string[]).includes(screen.theme) ? screen.theme : 'night'
  const content = screen ? await screenContent(db, screen) : { playlist: MENU_ONLY, band: [] }
  const hasMenu = content.playlist.some((item) => item.kind === 'menu')
  const [clubName, sections] = await Promise.all([
    venueName(db),
    hasMenu ? menuSections(db) : Promise.resolve([] as MenuSection[]),
  ])
  return {
    id: screen?.id ?? null,
    name: screen?.name ?? null,
    kind: hasMenu ? 'menu' as const : 'slideshow' as const,
    rotation: screen?.rotation ?? 0,
    clubName,
    theme,
    bandSec: Math.min(300, Math.max(5, screen?.bandSec ?? 20)),
    playlist: content.playlist,
    slides: hasMenu ? content.band : content.playlist,
    sections,
  }
}
