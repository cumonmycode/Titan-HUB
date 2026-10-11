import {
  pgTable,
  uuid,
  text,
  numeric,
  integer,
  boolean,
  timestamp,
} from 'drizzle-orm/pg-core'
import { screens } from './screens.js'

export const menuCategories = pgTable('menu_categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  icon: text('icon').notNull().default('restaurant_menu'),
  color: text('color').notNull().default('violet'),
  isActive: boolean('is_active').notNull().default(true),
  isTabletVisible: boolean('is_tablet_visible').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const inventory = pgTable('inventory', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  // 'goods' — позиция меню (продаётся); 'ingredient' — сырьё: в меню не попадает,
  // списывается по техкартам (recipe_items). Миграция 070.
  kind: text('kind').$type<'goods' | 'ingredient'>().notNull().default('goods'),
  // Единица учёта остатка: штуки, граммы или миллилитры (остаток — целое в этой единице).
  unit: text('unit').$type<'pcs' | 'g' | 'ml'>().notNull().default('pcs'),
  // Имя штуки для unit = 'pcs' (pack — «пачка», bottle — «бутылка»…), миграция 071.
  unitLabel: text('unit_label'),
  // Фасовка при закупке: «пачка ≈ 25 шт» — в приходе вносят упаковки (071).
  packName: text('pack_name'),
  packSize: integer('pack_size'),
  category: uuid('category').references(() => menuCategories.id),
  price: numeric('price', { precision: 10, scale: 2 }).notNull().default('0'),
  // Себестоимость единицы (WAC по приходам; у позиции с техкартой — сумма состава).
  // 4 знака: у сырья это цена грамма/миллилитра.
  costPrice: numeric('cost_price', { precision: 12, scale: 4 }).default('0'),
  stockQuantity: integer('stock_quantity').notNull().default(0),
  minThreshold: integer('min_threshold').default(0),
  // Параметры пополнения (миграция 044): точка заказа и целевой уровень (par).
  // Low-stock алерт срабатывает при stockQuantity <= reorderPoint (а не на нуле);
  // дозаказ добивает до parLevel. minThreshold остаётся для обратной совместимости.
  reorderPoint: integer('reorder_point'),
  parLevel: integer('par_level'),
  trackStock: boolean('track_stock').notNull().default(false),
  isService: boolean('is_service').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  isTop: boolean('is_top').notNull().default(false),
  isTabletVisible: boolean('is_tablet_visible').notNull().default(false),
  // Показывать на экране меню для ТВ (/menu, AbleSign) — миграция 064.
  isScreenVisible: boolean('is_screen_visible').notNull().default(true),
  imageUrl: text('image_url'),
  sortOrder: integer('sort_order').notNull().default(0),
  searchTags: text('search_tags').array().default([]),
  linkedSpaceId: uuid('linked_space_id'),
  // Мягкое удаление: позиция используется в исторических чеках (check_items.item_id
  // → inventory.id, FK RESTRICT + имя не денормализовано), поэтому жёстко удалять
  // нельзя. deletedAt отделён от isActive: isActive = скрыта из меню, но в управлении
  // видна; deletedAt != null = удалена, исключается из всех списков.
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// Техкарта: из чего состоит одна порция позиции меню (миграция 070). quantity — целое
// в единице компонента (18 г зёрен, 150 мл молока, 1 шт стакана). Продажа позиции с
// техкартой списывает компоненты, а не саму позицию.
export const recipeItems = pgTable('recipe_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  productId: uuid('product_id')
    .notNull()
    .references(() => inventory.id, { onDelete: 'cascade' }),
  componentId: uuid('component_id')
    .notNull()
    .references(() => inventory.id),
  quantity: integer('quantity').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
})

export const modifiers = pgTable('modifiers', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  price: numeric('price', { precision: 10, scale: 2 }).notNull().default('0'),
  productId: uuid('product_id')
    .notNull()
    .references(() => inventory.id, { onDelete: 'cascade' }),
})

// Тарифы клиентов (Гость/Резидент/Студент/Одна игра/Без тарифа и т.д.) — отдельная
// управляемая сущность (раздел «Тарифы и аренда»). Не считаются на складе. Каждый
// тариф привязан к скрытой backing-позиции меню (itemId), через которую тариф
// попадает в чек как обычная позиция (денежный путь не меняется); tariffs владеет
// идентичностью/ценой/порядком и используется в настройках и аналитике.
export const tariffs = pgTable('tariffs', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  // Тариф = СТАТУС клиента. key — слаг статуса (resident/student/newbie/guest),
  // на него ссылается profiles.client_tier. isSystem — базовые 4 (не удаляются).
  key: text('key'),
  isSystem: boolean('is_system').notNull().default(false),
  price: numeric('price', { precision: 10, scale: 2 }).notNull().default('0'),
  color: text('color').notNull().default('#8B5CF6'),
  sortOrder: integer('sort_order').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
  // Backing-позиция меню (категория «Тарифы», trackStock=false) — через неё тариф
  // ложится в check_items. Аналитика маппит тариф по этому itemId.
  itemId: uuid('item_id').references(() => inventory.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// Слайды экрана (миграции 065, 068). У экрана-меню — реклама в области ленты тарифов,
// у слайдшоу — картинки на весь экран. kind: 'image' — картинка image_url; 'card' —
// заголовок/текст и QR по link_url. transition — анимация смены, fit — вписать целиком
// (contain) или заполнить экран (cover).
export const screenSlides = pgTable('screen_slides', {
  id: uuid('id').primaryKey().defaultRandom(),
  screenId: uuid('screen_id').references(() => screens.id, { onDelete: 'cascade' }),
  // 'band' — реклама в ленте меню (image|card); 'show' — элемент показа (menu|image), миграция 069.
  placement: text('placement').$type<'band' | 'show'>().notNull().default('band'),
  kind: text('kind').$type<'image' | 'card' | 'menu'>().notNull().default('image'),
  transition: text('transition').$type<'fade' | 'slide' | 'zoom' | 'flip' | 'none'>().notNull().default('fade'),
  transitionMs: integer('transition_ms').notNull().default(900),
  fit: text('fit').$type<'contain' | 'cover'>().notNull().default('contain'),
  imageUrl: text('image_url'),
  title: text('title'),
  body: text('body'),
  linkUrl: text('link_url'),
  durationSec: integer('duration_sec').notNull().default(10),
  isActive: boolean('is_active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export type ScreenSlide = typeof screenSlides.$inferSelect
export type MenuCategory = typeof menuCategories.$inferSelect
export type NewMenuCategory = typeof menuCategories.$inferInsert
export type InventoryItem = typeof inventory.$inferSelect
export type NewInventoryItem = typeof inventory.$inferInsert
export type RecipeItem = typeof recipeItems.$inferSelect
export type Modifier = typeof modifiers.$inferSelect
export type NewModifier = typeof modifiers.$inferInsert
export type Tariff = typeof tariffs.$inferSelect
