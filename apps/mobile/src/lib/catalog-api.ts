import { useQuery } from '@tanstack/react-query';
import type { SFSymbol } from 'sf-symbols-typescript';

import { api } from './api';
import type { MenuCategory, Space, Tariff } from './pos-api';
import { queryClient } from './query';
import { useClubKey } from './queries';
import { useSession } from './session';
import type { NumericString } from './types';

/**
 * Справочники меню (категории, порядок) и «Тарифы и аренда» (apps/api/src/modules/menu,
 * pricing, spaces). Сами позиции меню и склад правит раздел «Товары» — lib/goods-api.ts.
 * - Категория «Тарифы» и её позиции управляются тарифами, в меню их не показываем.
 * - `imageUrl` и `linkedSpaceId` на сервере не принимают null — пустые ключи опускаем.
 */

/* ─────────────────────────── Вид категорий ─────────────────────────── */

export const CATEGORY_SYMBOLS: Record<string, SFSymbol> = {
  cold_drinks: 'waterbottle',
  hot_drinks: 'cup.and.heat.waves',
  snacks: 'popcorn',
  tariffs: 'ticket',
  food: 'fork.knife',
  hookah: 'flame',
  desserts: 'birthday.cake',
  cocktails: 'wineglass',
  beer: 'mug',
  lemonade: 'takeoutbag.and.cup.and.straw',
  coffee: 'cup.and.saucer',
  tea: 'leaf',
  breakfast: 'sun.horizon',
  pizza: 'fork.knife.circle',
  games: 'dice',
  vip: 'crown',
  rental: 'timer',
  events: 'party.popper',
  sweets: 'gift',
  other: 'square.grid.2x2',
};

/** Пресеты значков веб-кассы: подпись и фирменный цвет. */
export const CATEGORY_PRESETS: { id: string; label: string; color: string }[] = [
  { id: 'cold_drinks', label: 'Холодные напитки', color: '#06B6D4' },
  { id: 'hot_drinks', label: 'Горячие напитки', color: '#F97316' },
  { id: 'snacks', label: 'Снэки', color: '#F59E0B' },
  { id: 'food', label: 'Еда', color: '#10B981' },
  { id: 'hookah', label: 'Кальяны', color: '#F43F5E' },
  { id: 'desserts', label: 'Десерты', color: '#EC4899' },
  { id: 'cocktails', label: 'Коктейли', color: '#6366F1' },
  { id: 'beer', label: 'Пиво', color: '#D97706' },
  { id: 'lemonade', label: 'Лимонады', color: '#65A30D' },
  { id: 'coffee', label: 'Кофе', color: '#C2410C' },
  { id: 'tea', label: 'Чай', color: '#0D9488' },
  { id: 'breakfast', label: 'Завтраки', color: '#CA8A04' },
  { id: 'pizza', label: 'Пицца', color: '#DC2626' },
  { id: 'games', label: 'Настолки', color: '#2563EB' },
  { id: 'vip', label: 'VIP', color: '#7C3AED' },
  { id: 'rental', label: 'Аренда', color: '#64748B' },
  { id: 'events', label: 'Мероприятия', color: '#A855F7' },
  { id: 'sweets', label: 'Сладости', color: '#C026D3' },
  { id: 'other', label: 'Прочее', color: '#475569' },
];

/** Палитра тарифов, типов вечеров и категорий — как в вебе. */
export const PALETTE = ['#8B5CF6', '#10B981', '#F59E0B', '#3B82F6', '#F43F5E', '#06B6D4', '#EAB308', '#EC4899', '#6366F1', '#94A3B8'];

const LEGACY_COLORS: Record<string, string> = {
  violet: '#8B5CF6',
  slate: '#94A3B8',
  orange: '#F97316',
  emerald: '#10B981',
  rose: '#F43F5E',
  amber: '#F59E0B',
  blue: '#3B82F6',
  indigo: '#6366F1',
  pink: '#EC4899',
  cyan: '#06B6D4',
};

export const categoryHex = (value?: string | null) => (value ? LEGACY_COLORS[value] || (/^#[0-9a-f]{6}$/i.test(value) ? value : '#8B5CF6') : '#8B5CF6');
export const categorySymbol = (icon?: string | null): SFSymbol => (icon && CATEGORY_SYMBOLS[icon]) || 'square.grid.2x2';
export const isTariffCategory = (c: Pick<MenuCategory, 'name'>) => c.name.toLowerCase().includes('тариф');

/* ─────────────────────────── Меню ─────────────────────────── */

export type AdminMenuItem = {
  id: string;
  name: string;
  category: string | null;
  price: NumericString;
  costPrice: NumericString | null;
  stockQuantity: number;
  minThreshold: number | null;
  trackStock: boolean;
  isService: boolean;
  isActive: boolean;
  isTop: boolean;
  isTabletVisible: boolean;
  /** На экране меню для ТВ (/menu). */
  isScreenVisible?: boolean;
  imageUrl: string | null;
  sortOrder: number;
  searchTags: string[] | null;
  linkedSpaceId: string | null;
};

const host = () => useSession.getState().club?.host ?? 'none';

/** Категории (без «Тарифов») и все неудалённые позиции, включая скрытые. */
export function useMenuAdmin() {
  const club = useClubKey();
  return useQuery({
    queryKey: [club, 'menu', 'admin'],
    queryFn: async () => {
      const [categories, items] = await Promise.all([
        api.get<{ categories: MenuCategory[] }>('/menu/categories').then((r) => r.categories),
        api.get<{ items: AdminMenuItem[] }>('/menu/items/all').then((r) => r.items),
      ]);
      const tariffIds = new Set(categories.filter(isTariffCategory).map((c) => c.id));
      return {
        allCategories: categories,
        categories: categories.filter((c) => !tariffIds.has(c.id)),
        items: items.filter((i) => !i.category || !tariffIds.has(i.category)),
      };
    },
    staleTime: 15_000,
  });
}

function refreshMenu() {
  const club = host();
  void queryClient.invalidateQueries({ queryKey: [club, 'goods'] });
  void queryClient.invalidateQueries({ queryKey: [club, 'menu'] });
  void queryClient.invalidateQueries({ queryKey: [club, 'inventory'] });
}

export type CategoryInput = { name: string; icon: string; color: string; isTabletVisible: boolean };

export async function saveCategory(categoryId: string | null, input: CategoryInput): Promise<MenuCategory> {
  const body = { name: input.name.trim(), icon: input.icon, color: input.color, isTabletVisible: input.isTabletVisible };
  const { category } = categoryId
    ? await api.patch<{ category: MenuCategory }>(`/menu/categories/${categoryId}`, body)
    : await api.post<{ category: MenuCategory }>('/menu/categories', body);
  refreshMenu();
  return category;
}

/** Только владелец. Позиции категории остаются — без категории. */
export async function deleteCategory(categoryId: string): Promise<void> {
  await api.delete(`/menu/categories/${categoryId}`);
  refreshMenu();
}

export async function reorderCategories(order: { id: string; sortOrder: number }[]): Promise<void> {
  try {
    await api.patch('/menu/categories/reorder', { items: order });
  } finally {
    refreshMenu();
  }
}

export async function reorderItems(order: { id: string; sortOrder: number }[]): Promise<void> {
  try {
    await api.patch('/menu/items/reorder', { items: order });
  } finally {
    refreshMenu();
  }
}

/* ─────────────────────────── Тарифы и аренда ─────────────────────────── */

/** Значок и цвет типа зоны — как в веб-разделе «Аренда». */
export const SPACE_LOOK: Record<Space['type'], { symbol: SFSymbol; color: string }> = {
  small_booth: { symbol: 'door.left.hand.closed', color: '#3B82F6' },
  large_booth: { symbol: 'door.french.closed', color: '#06B6D4' },
  hall: { symbol: 'building.columns', color: '#94A3B8' },
  table: { symbol: 'table.furniture', color: '#8B5CF6' },
  vr: { symbol: 'visionpro', color: '#4CD7F6' },
  ps5: { symbol: 'gamecontroller', color: '#10B981' },
  zone: { symbol: 'square.grid.2x2', color: '#F59E0B' },
};

/** isScreenVisible — «на экране ТВ» (/menu), флаг позиции, которой тариф ложится в чек. */
export type AdminTariff = Tariff & { isSystem?: boolean; isScreenVisible?: boolean };
export type EveningTypeRow = { key: string; label: string; color: string | null; sortOrder: number; isSystem: boolean };

export function useTariffsAdmin() {
  const club = useClubKey();
  return useQuery({
    queryKey: [club, 'pricing', 'tariffs', 'admin'],
    queryFn: () => api.get<{ tariffs: AdminTariff[] }>('/pricing/tariffs').then((r) => r.tariffs),
    staleTime: 15_000,
  });
}

export function useEveningTypesAdmin() {
  const club = useClubKey();
  return useQuery({
    queryKey: [club, 'pricing', 'evening-types'],
    queryFn: () => api.get<{ eveningTypes: EveningTypeRow[] }>('/pricing/evening-types').then((r) => r.eveningTypes),
    staleTime: 15_000,
  });
}

export function useSpacesAdmin() {
  const club = useClubKey();
  return useQuery({
    queryKey: [club, 'spaces', 'all'],
    queryFn: () => api.get<{ spaces: Space[] }>('/spaces/all').then((r) => r.spaces),
    staleTime: 15_000,
  });
}

function refreshPricing() {
  const club = host();
  for (const key of [['pricing'], ['spaces'], ['pos', 'spaces'], ['clients', 'tiers'], ['menu'], ['events']]) {
    void queryClient.invalidateQueries({ queryKey: [club, ...key] });
  }
}

export async function saveTariff(tariffId: string | null, input: { name: string; price: number; color: string; isScreenVisible?: boolean }): Promise<void> {
  const body = {
    name: input.name.trim(),
    price: input.price,
    color: input.color,
    ...(tariffId && input.isScreenVisible !== undefined ? { isScreenVisible: input.isScreenVisible } : {}),
  };
  if (tariffId) await api.patch(`/pricing/tariffs/${tariffId}`, body);
  else await api.post('/pricing/tariffs', body);
  refreshPricing();
}

/** Базовые статусы удалить нельзя; остальные скрываются, чеки прошлого не ломаются. */
export async function deleteTariff(tariffId: string): Promise<void> {
  await api.delete(`/pricing/tariffs/${tariffId}`);
  refreshPricing();
}

/** Вернуть скрытый тариф в кассу (вместе с его позицией в меню). */
export async function restoreTariff(tariffId: string): Promise<void> {
  await api.patch(`/pricing/tariffs/${tariffId}`, { isActive: true });
  refreshPricing();
}

export async function saveEveningType(key: string | null, input: { label: string; color: string }): Promise<void> {
  const body = { label: input.label.trim(), color: input.color };
  if (key) await api.patch(`/pricing/evening-types/${key}`, body);
  else await api.post('/pricing/evening-types', body);
  refreshPricing();
}

export async function deleteEveningType(key: string): Promise<void> {
  await api.delete(`/pricing/evening-types/${key}`);
  refreshPricing();
}

export type SpaceInput = { name: string; type: Space['type']; hourlyRate: number; capacity: number | null; isActive: boolean; isScreenVisible: boolean };

export async function saveSpace(spaceId: string | null, input: SpaceInput): Promise<void> {
  const body = {
    name: input.name.trim(),
    type: input.type,
    hourlyRate: input.hourlyRate,
    // null стирает вместимость; раньше пустое поле просто не отправлялось, и старое число оставалось.
    capacity: input.capacity,
    isScreenVisible: input.isScreenVisible,
    ...(spaceId ? { isActive: input.isActive } : {}),
  };
  if (spaceId) await api.patch(`/spaces/${spaceId}`, body);
  else await api.post('/spaces', body);
  refreshPricing();
}

/** 6-значный код привязки планшета к зоне — живёт 5 минут. */
export async function createTabletLinkCode(spaceId: string): Promise<{ code: string; spaceName: string; expiresIn: number }> {
  return api.post<{ code: string; spaceName: string; expiresIn: number }>(`/spaces/${spaceId}/tablet-link-code`, {});
}

export async function saveEventRate(hours: number, price: number): Promise<void> {
  await api.patch(`/pricing/event-rates/${hours}`, { price });
  refreshPricing();
}

export async function deleteEventRate(hours: number): Promise<void> {
  await api.delete(`/pricing/event-rates/${hours}`);
  refreshPricing();
}
