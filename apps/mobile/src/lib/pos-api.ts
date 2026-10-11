import { useQuery } from '@tanstack/react-query';
import { Alert } from 'react-native';

import { api, ApiError } from './api';
import { toNumber } from './format';
import { queryClient } from './query';
import { useClubKey } from './queries';
import { useSession } from './session';
import type { CheckDetail, CheckRow, NumericString } from './types';

/**
 * Запись в кассу — контракты `mobile-api-v1` (сверены с pos.router.ts и веб-кассой).
 * Правила: итог считает сервер; мутации позиций — только у открытого чека; неидемпотентные
 * POST не повторяем вслепую — после ошибки перечитываем чек.
 */

/* ─────────────────────────── Справочники ─────────────────────────── */

export type PlayerSearchItem = {
  id: string;
  nickname: string;
  clientTier: string;
  /** > 0 — депозит, < 0 — долг. */
  balance: NumericString;
  bonusPoints: NumericString;
  photoUrl: string | null;
};

export type Tariff = {
  id: string;
  name: string;
  /** Статус-тариф: совпадает с clientTier игрока. */
  key: string | null;
  price: NumericString;
  color: string;
  sortOrder: number;
  isActive: boolean;
  /** Позиция меню, которой тариф ложится в чек; null — добавлять нечего. */
  itemId: string | null;
};

export type Space = {
  id: string;
  name: string;
  type: 'small_booth' | 'large_booth' | 'hall' | 'table' | 'vr' | 'ps5' | 'zone';
  hourlyRate: NumericString;
  capacity: number | null;
  isActive: boolean;
  /** Ставка на экране меню для ТВ (/menu). */
  isScreenVisible?: boolean;
};

export type MenuCategory = {
  id: string;
  name: string;
  icon: string;
  color: string;
  isActive: boolean;
  isTabletVisible?: boolean;
  sortOrder: number;
};

export type MenuItem = {
  id: string;
  name: string;
  category: string | null;
  price: NumericString;
  stockQuantity: number;
  trackStock: boolean;
  isActive: boolean;
  isTop: boolean;
  imageUrl: string | null;
  sortOrder: number;
  searchTags: string[] | null;
};

export const TIER_LABEL: Record<string, string> = {
  resident: 'Резидент',
  student: 'Студент',
  newbie: 'Новичок',
  guest: 'Гость',
};

export const SPACE_TYPE_LABEL: Record<Space['type'], string> = {
  small_booth: 'Малая кабинка',
  large_booth: 'Большая кабинка',
  hall: 'Зал',
  table: 'Стол',
  vr: 'VR',
  ps5: 'PS5',
  zone: 'Зона',
};

export function usePlayerSearch(query: string) {
  const club = useClubKey();
  const q = query.trim();
  return useQuery({
    queryKey: [club, 'pos', 'players', q],
    queryFn: ({ signal }) =>
      api.get<{ players: PlayerSearchItem[] }>(`/pos/players/search?q=${encodeURIComponent(q)}`, { signal }).then((r) => r.players),
    enabled: q.length > 0,
    staleTime: 15_000,
  });
}

export type ClientTier = 'guest' | 'newbie' | 'resident' | 'student';

/** Новый клиент по нику; возвращает его id. Сервер не различает дубль ника и сбой — оба 500. */
export async function createClient(nickname: string, clientTier: ClientTier): Promise<string> {
  try {
    const { client } = await api.post<{ client: { id: string } }>('/clients', { nickname: nickname.trim(), clientTier });
    const host = useSession.getState().club?.host ?? 'none';
    void queryClient.invalidateQueries({ queryKey: [host, 'pos', 'players'] });
    return client.id;
  } catch (error) {
    if (error instanceof ApiError && error.status === 400) throw new Error('Ник — минимум 2 символа');
    if (error instanceof ApiError && error.status >= 500) throw new Error('Такой ник уже есть или сервер недоступен');
    throw error;
  }
}

export function useTariffs() {
  const club = useClubKey();
  return useQuery({
    queryKey: [club, 'pricing', 'tariffs'],
    queryFn: () => api.get<{ tariffs: Tariff[] }>('/pricing/tariffs').then((r) => r.tariffs.filter((t) => t.isActive !== false)),
    staleTime: 5 * 60_000,
  });
}

export function useSpaces() {
  const club = useClubKey();
  return useQuery({
    queryKey: [club, 'pos', 'spaces'],
    queryFn: () => api.get<{ spaces: Space[] }>('/pos/spaces').then((r) => r.spaces),
    staleTime: 5 * 60_000,
  });
}

export function useMenu() {
  const club = useClubKey();
  return useQuery({
    queryKey: [club, 'menu'],
    queryFn: async () => {
      const [categories, items] = await Promise.all([
        api.get<{ categories: MenuCategory[] }>('/menu/categories').then((r) => r.categories),
        api.get<{ items: MenuItem[] }>('/menu/items').then((r) => r.items),
      ]);
      return { categories, items: items.filter((i) => i.isActive) };
    },
    staleTime: 5 * 60_000,
  });
}

/** Предвыбор тарифа по статусу игрока — как в веб-кассе (page.tsx:404-410). */
export function preselectTariff(tariffs: Tariff[], clientTier: string): string | null {
  const byKey = tariffs.find((t) => t.key && t.key === clientTier);
  if (byKey) return byKey.id;
  const fallbackName = TIER_LABEL[clientTier];
  if (!fallbackName || clientTier === 'newbie') return null;
  return tariffs.find((t) => t.name.toLowerCase() === fallbackName.toLowerCase())?.id ?? null;
}

/**
 * Порядок тарифов в сетке кассы: статусы резидент → новичок → гость → студент, затем свои
 * статусы клуба, затем тарифы без статуса от дорогого к дешёвому («Друзья клуба», потом
 * «Одна игра») — самый дешёвый оказывается рядом с «Без тарифа».
 */
const STATUS_ORDER = ['resident', 'newbie', 'guest', 'student'];

export function sortTariffs(tariffs: Tariff[]): Tariff[] {
  const rank = (t: Tariff) => {
    if (!t.key) return 200;
    const i = STATUS_ORDER.indexOf(t.key);
    return i === -1 ? 100 : i;
  };
  return [...tariffs].sort(
    (a, b) => rank(a) - rank(b) || (rank(a) === 200 ? toNumber(b.price) - toNumber(a.price) : a.sortOrder - b.sortOrder),
  );
}

/* ─────────────────────────── Предчеки Tai ─────────────────────────── */

/** Игрок проголосовал «да»/«опоздаю» в опросе дня, чека у него в смене ещё нет. */
export type Precheck = {
  playerId: string;
  nickname: string;
  photoUrl: string | null;
  clientTier: string;
  vote: 'да' | 'опоздаю';
  tariffItemId: string | null;
  tariffName: string | null;
  tariffPrice: NumericString | null;
};

/** Без подписки Tai или без открытой смены сервер отдаёт пустой список. Веб опрашивает раз в 20 с. */
export function usePrechecks() {
  const club = useClubKey();
  return useQuery({
    queryKey: [club, 'pos', 'prechecks'],
    queryFn: () => api.get<{ prechecks: Precheck[] }>('/pos/prechecks').then((r) => r.prechecks),
    refetchInterval: 20_000,
  });
}

/* ─────────────────────────── Предугаданные позиции Tai ─────────────────────────── */

/** Частый заказ резидента, которого ещё нет в чеке. */
export type ItemSuggestion = { itemId: string; name: string; price: NumericString };

/**
 * «Tai предлагает» — как в веб-кассе. Сервер отдаёт пусто без подписки Tai,
 * для не-резидентов и для закрытых чеков, поэтому запрос — только при плательщике.
 */
export function useCheckSuggestions(checkId: string, enabled: boolean) {
  const club = useClubKey();
  return useQuery({
    queryKey: [club, 'pos', 'suggestions', checkId],
    queryFn: () => api.get<{ suggestions: ItemSuggestion[] }>(`/pos/checks/${checkId}/suggestions`).then((r) => r.suggestions),
    enabled,
    staleTime: 60_000,
  });
}

/* ─────────────────────────── Чек ─────────────────────────── */

type CreateCheckBody = { playerId?: string; spaceId?: string; linkedEventId?: string; guestNames?: string[] };

/** Открыть чек. При аренде зоны — привязываем активное мероприятие этой зоны, как веб. */
export async function createCheck(body: CreateCheckBody): Promise<CheckRow> {
  let linkedEventId = body.linkedEventId;
  if (body.spaceId && !linkedEventId) {
    linkedEventId = await api
      .get<{ event: { id: string } | null }>(`/events/active-for-space/${body.spaceId}`)
      .then((r) => r.event?.id)
      .catch(() => undefined);
  }
  const { check } = await api.post<{ check: CheckRow }>('/pos/checks', { ...body, linkedEventId });
  return check;
}

/** Последовательная очередь мутаций одного чека: ответы применяются в порядке нажатий. */
const queues = new Map<string, Promise<unknown>>();

function enqueue<T>(checkId: string, task: () => Promise<T>): Promise<T> {
  const previous = queues.get(checkId) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(task);
  queues.set(checkId, next);
  return next;
}

function applyCheck(check: CheckDetail) {
  const host = useSession.getState().club?.host ?? 'none';
  queryClient.setQueryData([host, 'pos', 'check', check.id], check);
  void queryClient.invalidateQueries({ queryKey: [host, 'pos', 'checks'] });
  void queryClient.invalidateQueries({ queryKey: [host, 'pos', 'shift-summary'] });
  // Позиции изменились — Tai пересчитывает, что ещё предложить.
  void queryClient.invalidateQueries({ queryKey: [host, 'pos', 'suggestions', check.id] });
}

async function refetchCheck(checkId: string) {
  const host = useSession.getState().club?.host ?? 'none';
  await queryClient.invalidateQueries({ queryKey: [host, 'pos', 'check', checkId] });
}

/** Перечитать чек после изменений, которые сервер пишет в него сам (например, база мероприятия). */
export const reloadCheck = refetchCheck;

/** Добавить позицию (+1). Не идемпотентно: при ошибке перечитываем чек, а не повторяем. */
export function addItem(checkId: string, itemId: string, quantity = 1) {
  return enqueue(checkId, async () => {
    try {
      const { check } = await api.post<{ check: CheckDetail }>(`/pos/checks/${checkId}/items`, { itemId, quantity });
      applyCheck(check);
      return check;
    } catch (error) {
      await refetchCheck(checkId);
      throw error;
    }
  });
}

/** Абсолютное количество строки (идемпотентно); 0 — удалить строку. */
export function setItemQuantity(checkId: string, checkItemId: string, quantity: number) {
  return enqueue(checkId, async () => {
    try {
      const { check } =
        quantity <= 0
          ? await api.delete<{ check: CheckDetail }>(`/pos/checks/${checkId}/items/${checkItemId}`)
          : await api.patch<{ check: CheckDetail }>(`/pos/checks/${checkId}/items/${checkItemId}`, { quantity });
      applyCheck(check);
      return check;
    } catch (error) {
      await refetchCheck(checkId);
      throw error;
    }
  });
}

export function confirmOrder(checkId: string, orderId: string) {
  return enqueue(checkId, async () => {
    try {
      const { check } = await api.post<{ check: CheckDetail }>(`/pos/orders/${orderId}/confirm`, {});
      applyCheck(check);
      return check;
    } catch (error) {
      await refetchCheck(checkId);
      throw error;
    }
  });
}

export function rejectOrder(checkId: string, orderId: string) {
  return enqueue(checkId, async () => {
    try {
      await api.post(`/pos/orders/${orderId}/reject`, {});
    } finally {
      await refetchCheck(checkId);
    }
  });
}

/* ─────────────────────────── Правки чека ─────────────────────────── */

async function fetchOpenCheck(checkId: string): Promise<CheckDetail> {
  const { check } = await api.get<{ check: CheckDetail }>(`/pos/checks/${checkId}`);
  if (check.status !== 'open') throw new Error('Чек уже закрыт');
  return check;
}

/** Ручная скидка на весь чек. Не идемпотентно: при ошибке перечитываем чек. */
export function applyDiscount(checkId: string, input: { type: 'percent' | 'fixed'; value: number }) {
  return enqueue(checkId, async () => {
    try {
      const name = input.type === 'percent' ? `Скидка ${input.value}%` : `Скидка ${input.value} ₽`;
      const { check } = await api.post<{ check: CheckDetail }>(`/pos/checks/${checkId}/discount`, {
        name,
        type: input.type,
        value: input.value,
        target: 'check',
      });
      applyCheck(check);
      return check;
    } catch (error) {
      await refetchCheck(checkId);
      throw error;
    }
  });
}

/** Снять скидку: ручная удаляется, авто- и тировая исключается для этого чека. */
export function removeDiscount(checkId: string, discountRowId: string) {
  return enqueue(checkId, async () => {
    try {
      const { check } = await api.delete<{ check: CheckDetail }>(`/pos/checks/${checkId}/discount/${discountRowId}`);
      applyCheck(check);
      return check;
    } catch (error) {
      await refetchCheck(checkId);
      throw error;
    }
  });
}

/** Вернуть снятую авто-скидку — применится, только если чек всё ещё под неё подходит. */
export function restoreDiscount(checkId: string, discountId: string) {
  return enqueue(checkId, async () => {
    try {
      const { check } = await api.post<{ check: CheckDetail }>(`/pos/checks/${checkId}/discount/${discountId}/restore`);
      applyCheck(check);
      return check;
    } catch (error) {
      await refetchCheck(checkId);
      throw error;
    }
  });
}

/**
 * Плательщик чека. У PATCH на сервере нет проверки статуса, а смена плательщика
 * пересчитывает сумму — на закрытом чеке это испортит выручку. Поэтому сначала перечитываем чек.
 */
export function setCheckPlayer(checkId: string, playerId: string | null) {
  return enqueue(checkId, async () => {
    try {
      await fetchOpenCheck(checkId);
      const { check } = await api.patch<{ check: CheckDetail }>(`/pos/checks/${checkId}`, { playerId });
      applyCheck(check);
      return check;
    } catch (error) {
      await refetchCheck(checkId);
      throw error;
    }
  });
}

/** Доп. участники чека («один платит за двоих») — полная замена списка имён. */
export function setCheckGuests(checkId: string, guestNames: string[]) {
  return enqueue(checkId, async () => {
    try {
      await fetchOpenCheck(checkId);
      const { check } = await api.patch<{ check: CheckDetail }>(`/pos/checks/${checkId}`, { guestNames });
      applyCheck(check);
      return check;
    } catch (error) {
      await refetchCheck(checkId);
      throw error;
    }
  });
}

/** Время аренды зоны. `spaceEndAt: null` — снова живой счётчик до оплаты. */
export function setCheckRental(checkId: string, rental: { spaceStartAt: string; spaceEndAt: string | null }) {
  return enqueue(checkId, async () => {
    try {
      await fetchOpenCheck(checkId);
      const { check } = await api.patch<{ check: CheckDetail }>(`/pos/checks/${checkId}`, rental);
      applyCheck(check);
      return check;
    } catch (error) {
      await refetchCheck(checkId);
      throw error;
    }
  });
}

/** Отмена чека без оплаты: остатки склада возвращаются, позиции остаются в истории. */
export function cancelCheck(checkId: string) {
  return enqueue(checkId, async () => {
    const host = useSession.getState().club?.host ?? 'none';
    try {
      await api.delete(`/pos/checks/${checkId}`);
    } finally {
      // Отмена чека мероприятия возвращает его в «Запланировано», отмена последнего
      // счёта участника может завершить миникап — мероприятия тоже перечитываем.
      for (const key of [['pos', 'checks'], ['pos', 'check', checkId], ['pos', 'shift-summary'], ['events'], ['event']]) {
        void queryClient.invalidateQueries({ queryKey: [host, ...key] });
      }
    }
  });
}

/**
 * Тариф входа — позиция меню в только что открытом чеке. Его ошибка не отменяет чек
 * (как в вебе), но молча её не глотаем: кассир должен знать, что тариф не добавлен.
 */
export async function addEntryTariff(checkId: string, itemId: string): Promise<void> {
  try {
    await api.post(`/pos/checks/${checkId}/items`, { itemId, quantity: 1 });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    Alert.alert('Тариф не добавлен', `Чек открыт, но тариф добавить не удалось: ${reason}. Добавьте его в чеке вручную.`);
  }
}

/** Предчек → настоящий чек: чек на игрока и тариф его статуса позицией. */
export async function openPrecheck(precheck: Precheck): Promise<CheckRow> {
  const check = await createCheck({ playerId: precheck.playerId });
  if (precheck.tariffItemId) await addEntryTariff(check.id, precheck.tariffItemId);
  const host = useSession.getState().club?.host ?? 'none';
  for (const key of [['pos', 'checks'], ['pos', 'prechecks'], ['pos', 'shift-summary']]) {
    void queryClient.invalidateQueries({ queryKey: [host, ...key] });
  }
  return check;
}
