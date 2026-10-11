import { create } from 'zustand';

import { BIG_UNIT, numberText, parseDecimal, reorderQuantity, type GoodsItem, type PieceName, type Unit } from './goods-api';

/**
 * Состав открытого документа — прихода, списания или техкарты. Редактор и шторка выбора
 * позиций («Добавить») работают с одним списком строк, поэтому выбор не передаётся через
 * параметры маршрута. Одновременно открыт один редактор: `start` начинает новый состав.
 *
 * Строка хранит поля так, как их набирают. В приходе количество — в крупной единице
 * (кг, л, шт), цена — за упаковку (у позиции с фасовкой) или за крупную единицу; в
 * списании и составе — базовая единица (г, мл, шт: «18 г»).
 */

export type DraftMode = 'supply' | 'write_off' | 'recipe';

export type DraftLine = {
  key: string;
  /** null — затрата без карточки товара (только в приходе). */
  itemId: string | null;
  name: string;
  unit: Unit;
  /** Имя штуки (pack — «пачка») для подписи поля. */
  label: PieceName | null;
  qty: string;
  price: string;
  /** Приход с фасовкой: сколько упаковок (количество подставляется packs × packSize), цена — за упаковку. */
  packs: string;
  packSize: number | null;
  packName: PieceName | null;
  /** Количество поправили руками — упаковки его больше не пересчитывают. */
  qtyManual: boolean;
  /** Растёт, когда значение подставлено извне, — поле ввода пересоздаётся. */
  version: number;
};

type DraftState = {
  mode: DraftMode | null;
  /** Позиция, чей состав правим, — саму её в состав не добавить. */
  productId: string | null;
  lines: DraftLine[];
  /** Растёт при каждой правке: по нему редактор сохраняет черновик. */
  revision: number;
  /** Номер открытого редактора: закрываясь, он очищает только свой состав. */
  session: number;
  /** Начать состав (начальные строки — не правка) и вернуть номер сессии для `reset`. */
  start: (mode: DraftMode, lines: DraftLine[], productId?: string | null) => number;
  reset: (session: number) => void;
  addItems: (items: GoodsItem[]) => void;
  addFree: (name: string) => void;
  setText: (key: string, field: 'qty' | 'price' | 'name' | 'packs', text: string) => void;
  remove: (key: string) => void;
};

let seq = 0;
export const newLineKey = () => `line-${++seq}`;

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const round4 = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000;

/** Начальные значения строки: дозаказ до целевого уровня (целыми упаковками), цена по средней. */
function defaults(mode: DraftMode, item: GoodsItem): { qty: string; price: string; packs: string } {
  if (mode !== 'supply') return { qty: item.unit === 'pcs' ? '1' : '', price: '', packs: '' };
  const factor = BIG_UNIT[item.unit].factor;
  const need = reorderQuantity(item);
  if (item.packSize) {
    const packs = need > 0 ? Math.ceil(need / item.packSize) : 0;
    return {
      packs: packs > 0 ? String(packs) : '',
      qty: packs > 0 ? numberText((packs * item.packSize) / factor) : '',
      price: item.costPrice > 0 ? numberText(round2(item.costPrice * item.packSize), 2) : '',
    };
  }
  return {
    packs: '',
    qty: need > 0 ? numberText(need / factor) : '',
    price: item.costPrice > 0 ? numberText(round2(item.costPrice * factor), 2) : '',
  };
}

type LineSource = Pick<GoodsItem, 'id' | 'name' | 'unit' | 'unitLabel' | 'packSize' | 'packName'>;

/** Новая строка для позиции каталога со значениями по умолчанию. */
export function lineFor(mode: DraftMode, item: GoodsItem): DraftLine {
  return {
    key: newLineKey(),
    itemId: item.id,
    name: item.name,
    unit: item.unit,
    label: item.unitLabel,
    packSize: mode === 'supply' ? item.packSize : null,
    packName: item.packName,
    qtyManual: false,
    version: 0,
    ...defaults(mode, item),
  };
}

/** Начальные строки документа и позиция, с которой его открыли (из карточки), — без дублей. */
export function withPreset(mode: DraftMode, lines: DraftLine[], preset: GoodsItem | undefined): DraftLine[] {
  if (!preset || lines.some((l) => l.itemId === preset.id)) return lines;
  return [...lines, lineFor(mode, preset)];
}

export const useDocDraft = create<DraftState>((set, get) => ({
  mode: null,
  productId: null,
  lines: [],
  revision: 0,
  session: 0,
  start: (mode, lines, productId = null) => {
    const session = get().session + 1;
    set({ mode, lines, productId, revision: 0, session });
    return session;
  },
  reset: (session) => {
    if (get().session === session) set({ mode: null, productId: null, lines: [], revision: 0 });
  },
  addItems: (items) => {
    const { mode, lines, productId } = get();
    if (!mode) return;
    const present = new Set(lines.map((l) => l.itemId));
    const fresh = items.filter((item) => !present.has(item.id) && item.id !== productId).map((item) => lineFor(mode, item));
    if (fresh.length) set({ lines: [...lines, ...fresh], revision: get().revision + 1 });
  },
  addFree: (name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const line: DraftLine = {
      key: newLineKey(),
      itemId: null,
      name: trimmed,
      unit: 'pcs',
      label: null,
      qty: '1',
      price: '',
      packs: '',
      packSize: null,
      packName: null,
      qtyManual: false,
      version: 0,
    };
    set({ lines: [...get().lines, line], revision: get().revision + 1 });
  },
  setText: (key, field, text) =>
    set({
      lines: get().lines.map((l) => {
        if (l.key !== key) return l;
        if (field === 'qty') return { ...l, qty: text, qtyManual: true };
        if (field !== 'packs') return { ...l, [field]: text };
        // Упаковки подставляют количество, пока его не поправили руками.
        const packs = parseDecimal(text);
        if (l.qtyManual || !l.packSize || packs === null) return { ...l, packs: text };
        return { ...l, packs: text, qty: numberText((packs * l.packSize) / BIG_UNIT[l.unit].factor), version: l.version + 1 };
      }),
      revision: get().revision + 1,
    }),
  remove: (key) => set({ lines: get().lines.filter((l) => l.key !== key), revision: get().revision + 1 }),
}));

/** Строка прихода в единицах сервера: целое в базовой единице, цена за неё, упаковки. */
export function supplyValues(line: DraftLine) {
  const factor = line.itemId ? BIG_UNIT[line.unit].factor : 1;
  const qty = parseDecimal(line.qty) ?? 0;
  const price = parseDecimal(line.price) ?? 0;
  const packs = line.packSize ? (parseDecimal(line.packs) ?? 0) : 0;
  const quantity = line.itemId ? Math.round(qty * factor) : qty;
  const error = !line.name.trim() ? 'Укажите название' : quantity <= 0 ? 'Укажите количество' : null;
  // С фасовкой цена — за упаковку: сумма = упаковки × цена (упаковки не внесли — по
  // количеству: доля упаковки × цена), цена единицы = сумма / количество.
  const entered = !line.packSize ? round2(qty * price) : packs > 0 ? round2(packs * price) : round2((quantity / line.packSize) * price);
  const costPerUnit = !line.packSize ? round4(price / factor) : quantity > 0 ? round4(entered / quantity) : 0;
  // Сумма строки — как её считает сервер: количество × округлённая цена единицы.
  const sum = round2(quantity * costPerUnit);
  return { quantity, costPerUnit, sum, packs: packs > 0 ? packs : null, error };
}

/**
 * Итог прихода по формуле сервера: round2(Σ количество × цена единицы). Ровно эта сумма
 * уходит выдачей из кассы — диалог «Провести?» показывает её же.
 */
export function supplyTotal(lines: { quantity: number; costPerUnit: number }[]): number {
  return round2(lines.reduce((sum, l) => sum + l.quantity * l.costPerUnit, 0));
}

/** Количество строки списания или состава — целое в базовой единице. */
export function baseQuantity(line: DraftLine): number {
  return Math.round(parseDecimal(line.qty) ?? 0);
}

/** Строки из сохранённого документа: количество в базовой единице → текст поля. */
export function draftLineOf(
  mode: DraftMode,
  item: LineSource | null,
  saved: { itemId?: string | null; name?: string; quantity: number; costPerUnit?: number; packs?: number | null },
): DraftLine {
  const unit = item?.unit ?? 'pcs';
  const factor = mode === 'supply' && saved.itemId ? BIG_UNIT[unit].factor : 1;
  const packs = mode === 'supply' && saved.packs ? saved.packs : 0;
  const packSize = mode === 'supply' ? (item?.packSize ?? null) : null;
  const price = !saved.costPerUnit
    ? 0
    : packs > 0
      ? (saved.costPerUnit * saved.quantity) / packs
      : packSize
        ? saved.costPerUnit * packSize
        : saved.costPerUnit * factor;
  return {
    key: newLineKey(),
    itemId: saved.itemId ?? null,
    name: item?.name ?? saved.name ?? '—',
    unit,
    label: item?.unitLabel ?? null,
    packSize,
    packName: item?.packName ?? null,
    qtyManual: packs > 0,
    qty: saved.quantity > 0 ? numberText(saved.quantity / factor) : '',
    price: mode === 'supply' && price > 0 ? numberText(round2(price), 2) : '',
    packs: packs > 0 ? numberText(packs, 2) : '',
    version: 0,
  };
}
