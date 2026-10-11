import { useQuery } from '@tanstack/react-query';

import { api } from './api';
import type { MenuCategory } from './pos-api';
import { queryClient } from './query';
import { useClubKey } from './queries';
import { useSession } from './session';

/**
 * Раздел «Товары» (apps/api/src/modules/goods, миграция 070): меню, остатки и операции
 * склада одним разделом. Позиция меню и сырьё — одна сущность каталога; остаток меняют
 * только документы (приход, списание, ревизия) и продажи кассы. Себестоимость считает склад:
 * WAC по приходам, у позиции с техкартой — сумма состава.
 *
 * Сырьё и штучные товары учитываются целым числом в своей единице: штуки, граммы или
 * миллилитры. На экране граммы показываем килограммами, миллилитры — литрами, когда их много.
 */

const host = () => useSession.getState().club?.host ?? 'none';

/* ─────────────────────────── Модели ─────────────────────────── */

export type Unit = 'pcs' | 'g' | 'ml';
export type StockMode = 'none' | 'pieces' | 'recipe';
/** menu — позиция меню; tariff — скрытая позиция тарифа; rental — аренда зоны; ingredient — сырьё. */
export type GoodsRole = 'menu' | 'tariff' | 'rental' | 'ingredient';

export type RecipeLine = { componentId: string; quantity: number };

export type GoodsItem = {
  id: string;
  name: string;
  kind: 'goods' | 'ingredient';
  unit: Unit;
  /** Имя штуки (pack — «пачка»…) для unit = 'pcs'; null — «шт». */
  unitLabel: PieceName | null;
  /** Фасовка при закупке: «пачка ≈ 25 шт» (размер — в базовых единицах). */
  packName: PieceName | null;
  packSize: number | null;
  role: GoodsRole;
  stockMode: StockMode;
  category: string | null;
  price: number;
  costPrice: number;
  stockQuantity: number;
  reorderPoint: number | null;
  parLevel: number | null;
  isActive: boolean;
  isTop: boolean;
  isTabletVisible: boolean;
  isScreenVisible: boolean;
  searchTags: string[];
  linkedSpaceId: string | null;
  sortOrder: number;
  recipe: RecipeLine[];
  hasReceipts: boolean;
  /** Средний расход в день за 30 дней, в единице товара. */
  dailyUse: number;
};

export type Catalog = {
  categories: MenuCategory[];
  items: GoodsItem[];
  byId: Map<string, GoodsItem>;
};

export type MovementType = 'opening' | 'receipt' | 'sale' | 'return' | 'adjustment' | 'write_off' | 'count' | 'transfer';

export type GoodsMovement = {
  id: string;
  type: MovementType;
  delta: number;
  qtyAfter: number;
  unitCost: string | null;
  sourceType: string | null;
  sourceId: string | null;
  reason: string | null;
  createdAt: string;
  author: string | null;
  /** Позиция меню, ради которой списан ингредиент техкарты. */
  soldItemName: string | null;
};

export type DaySeries = { date: string; qty: number }[];

export type GoodsCard = {
  movements: GoodsMovement[];
  sales: { qty: number; revenue: number; series: DaySeries };
  usage: { qty: number; series: DaySeries };
  lastSupply: { date: string; supplier: string | null; supplyId: string; quantity: number; costPerUnit: number } | null;
  usedIn: { id: string; name: string; quantity: number }[];
};

export type DocType = 'supply' | 'write_off' | 'revision';

export type GoodsDocument = {
  type: DocType;
  id: string;
  status: 'draft' | 'posted';
  createdAt: string;
  updatedAt: string | null;
  author: string | null;
  positions: number;
  amount: number;
  title: string | null;
  fromRegister?: boolean;
  surplus?: number;
  shortage?: number;
};

/* ─────────────────────────── Единицы ─────────────────────────── */

export const UNIT_LABEL: Record<Unit, string> = { pcs: 'шт', g: 'г', ml: 'мл' };

/** Как называется штука или упаковка — со склонениями: «1 пачка, 2 пачки, 5 пачек». */
export type PieceName = 'pcs' | 'pack' | 'bottle' | 'can' | 'box' | 'bag' | 'portion';
/** `per` — для цены («₽ за пачку»), `in` — для фасовки («в пачке 25 шт»). */
export const PIECE_NAMES: Record<PieceName, { title: string; forms: [string, string, string]; per: string; in: string }> = {
  pcs: { title: 'Штука', forms: ['шт', 'шт', 'шт'], per: 'шт', in: 'штуке' },
  pack: { title: 'Пачка', forms: ['пачка', 'пачки', 'пачек'], per: 'пачку', in: 'пачке' },
  bottle: { title: 'Бутылка', forms: ['бутылка', 'бутылки', 'бутылок'], per: 'бутылку', in: 'бутылке' },
  can: { title: 'Банка', forms: ['банка', 'банки', 'банок'], per: 'банку', in: 'банке' },
  box: { title: 'Коробка', forms: ['коробка', 'коробки', 'коробок'], per: 'коробку', in: 'коробке' },
  bag: { title: 'Пакет', forms: ['пакет', 'пакета', 'пакетов'], per: 'пакет', in: 'пакете' },
  portion: { title: 'Порция', forms: ['порция', 'порции', 'порций'], per: 'порцию', in: 'порции' },
};
export const PIECE_CHOICES = Object.keys(PIECE_NAMES) as PieceName[];

function pluralForm(n: number, forms: [string, string, string]): string {
  const a = Math.abs(Math.trunc(n)) % 100;
  const b = a % 10;
  if (!Number.isInteger(n)) return forms[1];
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}

/** «3 пачки», «1 коробка» — число со словом в нужной форме. */
export function pieceText(n: number, name: PieceName | null | undefined): string {
  return `${decimal(n, 2).replace('-', '−')} ${pluralForm(n, PIECE_NAMES[name ?? 'pcs'].forms)}`;
}

/** Крупная единица для ввода и показа: килограммы и литры (в 1000 раз больше базовой). */
export const BIG_UNIT: Record<Unit, { label: string; factor: number }> = {
  pcs: { label: 'шт', factor: 1 },
  g: { label: 'кг', factor: 1000 },
  ml: { label: 'л', factor: 1000 },
};

export const UNIT_CHOICES: { unit: Unit; title: string }[] = [
  { unit: 'g', title: 'Граммы' },
  { unit: 'ml', title: 'Миллилитры' },
  { unit: 'pcs', title: 'Штуки' },
];

/** Быстрый выбор единицы нового ингредиента: «Пачки» — штуки с именем «пачка» (соус в порцию). */
export const QUICK_UNITS: { unit: Unit; label: PieceName | null; title: string }[] = [
  { unit: 'g', label: null, title: 'Граммы' },
  { unit: 'ml', label: null, title: 'Миллилитры' },
  { unit: 'pcs', label: null, title: 'Штуки' },
  { unit: 'pcs', label: 'pack', title: 'Пачки' },
];

const decimal = (n: number, digits: number) =>
  new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits, useGrouping: true }).format(n).replace(/ /g, ' ');

/** «24 шт», «38 пачек», «850 г», «1,25 кг», «1,5 л», «−3 шт». */
export function formatQty(qty: number, unit: Unit, label?: PieceName | null): string {
  if (unit === 'pcs') return pieceText(qty, label);
  if (Math.abs(qty) < 1000) return `${decimal(qty, 0).replace('-', '−')} ${UNIT_LABEL[unit]}`;
  return `${decimal(qty / 1000, 2).replace('-', '−')} ${BIG_UNIT[unit].label}`;
}

/** Количество в единице позиции, с именем штуки: «38 пачек», «1,2 кг». */
export const itemQty = (item: Pick<GoodsItem, 'unit' | 'unitLabel'>, qty: number) => formatQty(qty, item.unit, item.unitLabel);

/** Короткое имя единицы позиции для поля ввода: «шт», «пачек», «г». */
export const unitShort = (item: Pick<GoodsItem, 'unit' | 'unitLabel'>) =>
  item.unit === 'pcs' ? PIECE_NAMES[item.unitLabel ?? 'pcs'].forms[2] : UNIT_LABEL[item.unit];

/** Единица рядом с числом в поле: «1 пачка», «3 пачки», «18 г» — форма по набранному числу. */
export function unitWord(unit: Unit, label: PieceName | null | undefined, text: string): string {
  if (unit !== 'pcs') return UNIT_LABEL[unit];
  const n = parseDecimal(text);
  return pluralForm(n ?? 5, PIECE_NAMES[label ?? 'pcs'].forms);
}

/** Фасовка словами: «пачка ≈ 25 шт»; null — фасовка не задана. */
export function packText(item: Pick<GoodsItem, 'unit' | 'unitLabel' | 'packName' | 'packSize'>): string | null {
  if (!item.packSize) return null;
  return `${PIECE_NAMES[item.packName ?? 'pack'].forms[0]} ≈ ${itemQty(item, item.packSize)}`;
}

/** Цена единицы так, как её привыкли видеть: за штуку (пачку), за килограмм, за литр. */
export function unitPrice(costPerBase: number, unit: Unit, label?: PieceName | null): { value: number; label: string } {
  return { value: costPerBase * BIG_UNIT[unit].factor, label: `за ${unit === 'pcs' ? PIECE_NAMES[label ?? 'pcs'].per : BIG_UNIT[unit].label}` };
}

/** Число для поля ввода: «1,25» — с запятой, без хвостовых нулей. */
export function numberText(n: number, digits = 3): string {
  return decimal(n, digits).replace(/\s/g, '');
}

/** Строка из поля → число (запятая или точка); пусто или мусор → null. */
export function parseDecimal(text: string): number | null {
  const normalized = text.replace(/\s/g, '').replace(',', '.');
  if (!normalized) return null;
  const n = Number(normalized);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/* ─────────────────────────── Остатки ─────────────────────────── */

export type StockLevel = 'out' | 'low' | 'ok';

export const LEVEL_LOOK: Record<StockLevel, { label: string; color: string }> = {
  out: { label: 'Нет', color: '#F43F5E' },
  low: { label: 'Заканчивается', color: '#F97316' },
  ok: { label: 'В наличии', color: '#10B981' },
};

/** Ведётся ли у позиции остаток: штучный товар меню или сырьё (не тариф и не аренда). */
export const isStockItem = (item: GoodsItem) => item.kind === 'ingredient' || (item.stockMode === 'pieces' && (item.role === 'menu' || item.role === 'rental'));

/** Позиция меню, которую правят в «Товарах» (тарифы — в «Тарифах и аренде»). */
export const isMenuItem = (item: GoodsItem) => item.kind === 'goods' && item.role !== 'tariff';

export function stockLevel(item: Pick<GoodsItem, 'stockQuantity' | 'reorderPoint'>): StockLevel {
  if (item.stockQuantity <= 0) return 'out';
  if (item.reorderPoint && item.stockQuantity <= item.reorderPoint) return 'low';
  return 'ok';
}

/** На сколько дней хватит при текущем расходе; null — расхода не было. */
export function daysLeft(item: Pick<GoodsItem, 'stockQuantity' | 'dailyUse'>): number | null {
  if (item.dailyUse <= 0 || item.stockQuantity <= 0) return null;
  return Math.floor(item.stockQuantity / item.dailyUse);
}

/** Сколько порций можно приготовить по составу и какой ингредиент кончится первым. */
export function servings(item: GoodsItem, byId: Map<string, GoodsItem>): { count: number; limitedBy: GoodsItem | null } | null {
  if (item.stockMode !== 'recipe' || item.recipe.length === 0) return null;
  let count = Infinity;
  let limitedBy: GoodsItem | null = null;
  for (const line of item.recipe) {
    const component = byId.get(line.componentId);
    if (!component) continue;
    const n = Math.max(0, Math.floor(component.stockQuantity / line.quantity));
    if (n < count) {
      count = n;
      limitedBy = component;
    }
  }
  return Number.isFinite(count) ? { count, limitedBy } : null;
}

/** Себестоимость порции по составу — для предпросмотра в редакторе. */
export function recipeCost(recipe: RecipeLine[], byId: Map<string, GoodsItem>): number {
  return recipe.reduce((sum, line) => sum + line.quantity * (byId.get(line.componentId)?.costPrice ?? 0), 0);
}

/** Сколько дозаказать, чтобы добить до целевого уровня (или удвоить точку заказа). */
export function reorderQuantity(item: GoodsItem): number {
  const target = item.parLevel ?? (item.reorderPoint ? item.reorderPoint * 2 : 0);
  return Math.max(0, target - Math.max(0, item.stockQuantity));
}

export const margin = (price: number, cost: number) => (price > 0 && cost > 0 ? Math.round(((price - cost) / price) * 100) : null);

/* ─────────────────────────── Запросы ─────────────────────────── */

const STALE_MS = 15_000;

export function useGoods() {
  const club = useClubKey();
  return useQuery({
    queryKey: [club, 'goods', 'catalog'],
    queryFn: () => api.get<{ categories: MenuCategory[]; items: GoodsItem[] }>('/goods'),
    // Кэш живёт на диске между сборками — форму ответа нормализуем здесь же.
    select: (data): Catalog => {
      const items = (data.items ?? []).map((i) => ({
        ...i,
        recipe: i.recipe ?? [],
        searchTags: i.searchTags ?? [],
        unitLabel: i.unitLabel ?? null,
        packName: i.packName ?? null,
        packSize: i.packSize ?? null,
      }));
      return { categories: data.categories ?? [], items, byId: new Map(items.map((i) => [i.id, i])) };
    },
    staleTime: STALE_MS,
  });
}

export function useGoodsCard(itemId: string) {
  const club = useClubKey();
  return useQuery({
    queryKey: [club, 'goods', 'card', itemId],
    queryFn: () => api.get<GoodsCard>(`/goods/items/${itemId}/card`),
    staleTime: STALE_MS,
  });
}

export function useGoodsDocuments() {
  const club = useClubKey();
  return useQuery({
    queryKey: [club, 'goods', 'documents'],
    queryFn: () => api.get<{ documents: GoodsDocument[] }>('/goods/documents?limit=120').then((r) => r.documents),
    staleTime: STALE_MS,
  });
}

export function useSuppliers() {
  const club = useClubKey();
  return useQuery({
    queryKey: [club, 'goods', 'suppliers'],
    queryFn: () => api.get<{ suppliers: { name: string; count: number }[] }>('/goods/suppliers').then((r) => r.suppliers.map((s) => s.name)),
    staleTime: 5 * 60_000,
  });
}

/** Касса, меню POS и старые экраны тоже читают остатки — обновляем всё, что их показывает. */
export function refreshGoods() {
  const club = host();
  void queryClient.invalidateQueries({ queryKey: [club, 'goods'] });
  void queryClient.invalidateQueries({ queryKey: [club, 'menu'] });
  void queryClient.invalidateQueries({ queryKey: [club, 'inventory'] });
}

/* ─────────────────────────── Позиции ─────────────────────────── */

export type ItemInput = {
  name: string;
  category?: string | null;
  price?: number;
  isActive?: boolean;
  isTop?: boolean;
  isTabletVisible?: boolean;
  isScreenVisible?: boolean;
  searchTags?: string[];
  linkedSpaceId?: string | null;
  stockMode?: StockMode;
  recipe?: RecipeLine[];
  costPrice?: number;
  reorderPoint?: number | null;
  parLevel?: number | null;
  unit?: Unit;
  unitLabel?: PieceName | null;
  packName?: PieceName | null;
  packSize?: number | null;
};

export async function createItem(kind: 'goods' | 'ingredient', input: ItemInput): Promise<string> {
  try {
    return (await api.post<{ id: string }>('/goods/items', { kind, ...input })).id;
  } finally {
    refreshGoods();
  }
}

export async function updateItem(itemId: string, input: Partial<ItemInput>): Promise<void> {
  try {
    await api.patch(`/goods/items/${itemId}`, input);
  } finally {
    refreshGoods();
  }
}

/** Только владелец. Позиция остаётся в прошлых чеках. */
export async function deleteItem(itemId: string): Promise<void> {
  await api.delete(`/goods/items/${itemId}`);
  refreshGoods();
}
