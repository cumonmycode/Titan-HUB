import type { AppEnv } from '../../types.js'
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { menuCategories, inventory, modifiers, screenSlides, eq, and, asc, desc, isNull } from '@titan/database'
import { requireAuth, requireRole } from '../../middleware/auth.js'
import { defaultMenuScreen, screenPayload } from '../screens/screen-content.js'

const CategorySchema = z.object({
  name: z.string().min(1),
  icon: z.string().default('restaurant_menu'),
  color: z.string().default('violet'),
  isActive: z.boolean().default(true),
  isTabletVisible: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
})

const ItemSchema = z.object({
  name: z.string().min(1),
  category: z.string().uuid().nullable().optional(),
  price: z.number().min(0).default(0),
  costPrice: z.number().min(0).default(0),
  stockQuantity: z.number().int().min(0).default(0),
  minThreshold: z.number().int().default(0),
  trackStock: z.boolean().default(false),
  isService: z.boolean().default(false),
  isActive: z.boolean().default(true),
  isTop: z.boolean().default(false),
  isTabletVisible: z.boolean().default(false),
  // Показывать на экране меню для ТВ (/menu, AbleSign).
  isScreenVisible: z.boolean().default(true),
  imageUrl: z.string().optional(),
  sortOrder: z.number().int().default(0),
  searchTags: z.array(z.string()).default([]),
  linkedSpaceId: z.string().uuid().optional(),
})

const ModifierSchema = z.object({
  name: z.string().min(1),
  price: z.number().min(0).default(0),
})

export const menuRouter = new Hono<AppEnv>()

// Categories — no auth required for tablet reads
menuRouter.get('/categories', async (c) => {
  const db = c.var.db
  const tabletOnly = c.req.query('tabletOnly') === 'true'
  const where = tabletOnly
    ? and(eq(menuCategories.isActive, true), eq(menuCategories.isTabletVisible, true))
    : eq(menuCategories.isActive, true)
  const cats = await db.select().from(menuCategories).where(where).orderBy(asc(menuCategories.sortOrder))
  return c.json({ categories: cats })
})

menuRouter.post('/categories', requireAuth, requireRole('owner', 'staff'), zValidator('json', CategorySchema), async (c) => {
  const db = c.var.db
  const body = c.req.valid('json')
  const [cat] = await db.insert(menuCategories).values(body).returning()
  return c.json({ category: cat }, 201)
})

// Reorder categories — must be BEFORE /categories/:id
menuRouter.patch('/categories/reorder', requireAuth, requireRole('owner', 'staff'), zValidator('json', z.object({
  items: z.array(z.object({ id: z.string().uuid(), sortOrder: z.number().int() }))
})), async (c) => {
  const db = c.var.db
  const { items } = c.req.valid('json')
  await db.transaction(async (tx) => {
    for (const { id, sortOrder } of items) {
      await tx.update(menuCategories).set({ sortOrder }).where(eq(menuCategories.id, id))
    }
  })
  return c.json({ ok: true })
})

menuRouter.patch('/categories/:id', requireAuth, requireRole('owner', 'staff'), zValidator('json', CategorySchema.partial()), async (c) => {
  const db = c.var.db
  const body = c.req.valid('json')
  const [cat] = await db.update(menuCategories).set(body).where(eq(menuCategories.id, c.req.param('id'))).returning()
  if (!cat) return c.json({ error: 'Not found' }, 404)
  return c.json({ category: cat })
})

menuRouter.delete('/categories/:id', requireAuth, requireRole('owner'), async (c) => {
  const db = c.var.db
  const id = c.req.param('id')
  await db.transaction(async (tx) => {
    // Открепляем товары от категории, иначе FK не даст удалить (товары осиротеют).
    await tx.update(inventory).set({ category: null }).where(eq(inventory.category, id))
    await tx.delete(menuCategories).where(eq(menuCategories.id, id))
  })
  return c.json({ ok: true })
})

// Старая ссылка /menu (AbleSign, Titan Menu 1.0): показывает «Экран меню» из раздела
// «Экраны» (первый экран-меню). Экраны из раздела открываются по /screen/<id>.
menuRouter.get('/public', async (c) => {
  const db = c.var.db
  return c.json(await screenPayload(db, await defaultMenuScreen(db)))
})

// ── Реклама «Экрана меню» — прежний API (веб и приложение HUB до раздела «Экраны»).
// Слайды теперь принадлежат экрану; новые клиенты ходят в /screens/:id/slides.
const httpUrl = z.string().trim().max(1000).url().refine((u) => /^https?:\/\//i.test(u), 'Нужна ссылка http(s)')
const SlideSchema = z.object({
  kind: z.enum(['image', 'card']),
  imageUrl: httpUrl.nullable().optional(),
  title: z.string().trim().max(80).nullable().optional(),
  body: z.string().trim().max(240).nullable().optional(),
  linkUrl: httpUrl.nullable().optional(),
  durationSec: z.number().int().min(3).max(120).default(10),
  isActive: z.boolean().default(true),
})

menuRouter.get('/slides', requireAuth, requireRole('owner', 'staff'), async (c) => {
  const db = c.var.db
  const screen = await defaultMenuScreen(db)
  if (!screen) return c.json({ slides: [] })
  // Только реклама ленты: элементы показа (миграция 069) старые сборки не знают.
  const slides = await db.select().from(screenSlides)
    .where(and(eq(screenSlides.screenId, screen.id), eq(screenSlides.placement, 'band')))
    .orderBy(asc(screenSlides.sortOrder), asc(screenSlides.createdAt))
  return c.json({ slides })
})

menuRouter.post('/slides', requireAuth, requireRole('owner'), zValidator('json', SlideSchema), async (c) => {
  const db = c.var.db
  const body = c.req.valid('json')
  if (body.kind === 'image' && !body.imageUrl) return c.json({ error: 'Нужна картинка' }, 400)
  const screen = await defaultMenuScreen(db)
  if (!screen) return c.json({ error: 'Нет экрана меню — добавьте его в «Экранах»' }, 404)
  const [last] = await db.select({ sortOrder: screenSlides.sortOrder }).from(screenSlides)
    .where(and(eq(screenSlides.screenId, screen.id), eq(screenSlides.placement, 'band')))
    .orderBy(desc(screenSlides.sortOrder)).limit(1)
  const [slide] = await db.insert(screenSlides)
    .values({ ...body, screenId: screen.id, placement: 'band', sortOrder: (last?.sortOrder ?? -1) + 1 }).returning()
  return c.json({ slide }, 201)
})

// Порядок — ДО /slides/:id, иначе 'reorder' поймался бы как id.
menuRouter.patch('/slides/reorder', requireAuth, requireRole('owner'), zValidator('json', z.object({
  items: z.array(z.object({ id: z.string().uuid(), sortOrder: z.number().int() })),
})), async (c) => {
  const db = c.var.db
  const { items } = c.req.valid('json')
  await db.transaction(async (tx) => {
    for (const { id, sortOrder } of items) {
      await tx.update(screenSlides).set({ sortOrder, updatedAt: new Date() }).where(eq(screenSlides.id, id))
    }
  })
  return c.json({ ok: true })
})

menuRouter.patch('/slides/:id', requireAuth, requireRole('owner'), zValidator('json', SlideSchema.partial()), async (c) => {
  const db = c.var.db
  const body = c.req.valid('json')
  const [slide] = await db.update(screenSlides).set({ ...body, updatedAt: new Date() }).where(eq(screenSlides.id, c.req.param('id'))).returning()
  if (!slide) return c.json({ error: 'Not found' }, 404)
  return c.json({ slide })
})

menuRouter.delete('/slides/:id', requireAuth, requireRole('owner'), async (c) => {
  const db = c.var.db
  await db.delete(screenSlides).where(eq(screenSlides.id, c.req.param('id')))
  return c.json({ ok: true })
})

// Items
menuRouter.get('/items', async (c) => {
  const db = c.var.db
  const categoryId = c.req.query('categoryId')
  const tabletVisible = c.req.query('tabletVisible') === 'true'
  // Сырьё (kind='ingredient') — не позиция меню: в кассе и у гостей его нет.
  const baseFilter = and(eq(inventory.isActive, true), isNull(inventory.deletedAt), eq(inventory.kind, 'goods'))
  const catFilter = categoryId ? and(baseFilter, eq(inventory.category, categoryId)) : baseFilter
  const where = tabletVisible ? and(catFilter, eq(inventory.isTabletVisible, true)) : catFilter
  const rows = await db
    .select()
    .from(inventory)
    .where(where)
    .orderBy(asc(inventory.sortOrder), asc(inventory.name))
  // Публичный список — без costPrice (себестоимость/маржа не для гостей).
  const items = rows.map(({ costPrice, ...rest }) => rest)
  return c.json({ items })
})

menuRouter.get('/items/all', requireAuth, async (c) => {
  const db = c.var.db
  const items = await db
    .select()
    .from(inventory)
    .where(and(isNull(inventory.deletedAt), eq(inventory.kind, 'goods')))
    .orderBy(asc(inventory.sortOrder), asc(inventory.name))
  return c.json({ items })
})

menuRouter.get('/items/:id', async (c) => {
  const db = c.var.db
  const [item] = await db.select().from(inventory).where(eq(inventory.id, c.req.param('id')))
  if (!item) return c.json({ error: 'Not found' }, 404)
  const mods = await db.select().from(modifiers).where(eq(modifiers.productId, item.id))
  const { costPrice, ...safeItem } = item
  return c.json({ item: safeItem, modifiers: mods })
})

menuRouter.post('/items', requireAuth, requireRole('owner', 'staff'), zValidator('json', ItemSchema), async (c) => {
  const db = c.var.db
  const body = c.req.valid('json')
  const [item] = await db.insert(inventory).values({
    ...body,
    // Начальный остаток ВСЕГДА 0: количество меняется только через Закупки/
    // Ревизии/Списания (аудируемый PATCH /inventory/:id), а не из меню.
    stockQuantity: 0,
    price: String(body.price),
    costPrice: String(body.costPrice),
  }).returning()
  return c.json({ item }, 201)
})

// Reorder items — must be BEFORE /:id routes to avoid being captured as id="reorder"
menuRouter.patch('/items/reorder', requireAuth, requireRole('owner', 'staff'), zValidator('json', z.object({
  items: z.array(z.object({ id: z.string().uuid(), sortOrder: z.number().int() }))
})), async (c) => {
  const db = c.var.db
  const { items } = c.req.valid('json')
  await db.transaction(async (tx) => {
    for (const { id, sortOrder } of items) {
      await tx.update(inventory).set({ sortOrder, updatedAt: new Date() }).where(eq(inventory.id, id))
    }
  })
  return c.json({ ok: true })
})

menuRouter.patch('/items/:id', requireAuth, requireRole('owner', 'staff'), zValidator('json', ItemSchema.partial()), async (c) => {
  const db = c.var.db
  const body = c.req.valid('json')
  const updateData: Record<string, any> = { ...body, updatedAt: new Date() }
  // Остаток меняется ТОЛЬКО через аудируемый PATCH /inventory/:id (с блокировкой
  // строки и записью движения). Здесь абсолютная перезапись затёрла бы
  // параллельные продажи без аудита — поэтому stockQuantity не трогаем.
  // minThreshold/trackStock — это конфигурация, их править можно.
  delete updateData.stockQuantity
  if (body.price !== undefined) updateData.price = String(body.price)
  if (body.costPrice !== undefined) updateData.costPrice = String(body.costPrice)
  const [item] = await db.update(inventory).set(updateData).where(eq(inventory.id, c.req.param('id'))).returning()
  if (!item) return c.json({ error: 'Not found' }, 404)
  return c.json({ item })
})

menuRouter.delete('/items/:id', requireAuth, requireRole('owner'), async (c) => {
  const db = c.var.db
  // Мягкое удаление: позиция остаётся в БД ради исторических чеков, но помечается
  // deletedAt и исчезает из всех списков меню. См. 009_inventory_soft_delete.sql.
  await db.update(inventory).set({ deletedAt: new Date() }).where(eq(inventory.id, c.req.param('id')))
  return c.json({ ok: true })
})

// Modifiers
menuRouter.get('/items/:id/modifiers', async (c) => {
  const db = c.var.db
  const mods = await db.select().from(modifiers).where(eq(modifiers.productId, c.req.param('id')))
  return c.json({ modifiers: mods })
})

menuRouter.post('/items/:id/modifiers', requireAuth, requireRole('owner', 'staff'), zValidator('json', ModifierSchema), async (c) => {
  const db = c.var.db
  const body = c.req.valid('json')
  const [mod] = await db.insert(modifiers).values({
    ...body,
    price: String(body.price),
    productId: c.req.param('id'),
  }).returning()
  return c.json({ modifier: mod }, 201)
})

menuRouter.delete('/items/:itemId/modifiers/:modId', requireAuth, requireRole('owner', 'staff'), async (c) => {
  const db = c.var.db
  await db.delete(modifiers).where(eq(modifiers.id, c.req.param('modId')))
  return c.json({ ok: true })
})
