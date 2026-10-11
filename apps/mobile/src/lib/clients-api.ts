import { useInfiniteQuery, useQuery } from '@tanstack/react-query';

import { api, ApiError } from './api';
import { formatMoney, toNumber } from './format';
import { queryClient } from './query';
import { useClubKey } from './queries';
import { useSession } from './session';
import { invalidateShift } from './shift-api';
import type { NumericString } from './types';

/**
 * «Управление» → Клиенты, Депозиты и долги, Заказчики. Контракт — mobile-api-manage-clients.md.
 * Сервер отвечает 500 на дубль ника, битый UUID и пустой PATCH, права сотрудника не проверяет —
 * клиент валидирует заранее и прячет действия владельца по роли.
 */

export type Client = {
  id: string;
  nickname: string;
  fullName: string | null;
  role: 'owner' | 'staff' | 'tablet' | 'client';
  clientTier: string;
  /** > 0 — депозит, < 0 — долг. */
  balance: NumericString;
  bonusPoints: NumericString;
  tgId: string | null;
  tgUsername: string | null;
  phone: string | null;
  /** Свободный текст; веб пишет YYYY-MM-DD. */
  birthday: string | null;
  photoUrl: string | null;
  tgPhotoUrl: string | null;
  gomafiaPhotoUrl: string | null;
  /** Ручные теги и служебные `gomafia:<id>`, `gmnick:<login>`. */
  searchTags: string[] | null;
  manualVisits: number;
  createdAt: string;
  /** Не null — клиент в архиве. */
  deletedAt: string | null;
};

export type ClientTierRow = { key: string; label: string; color: string; sortOrder: number; isSystem: boolean; price: NumericString };

export type TxType = 'deposit' | 'withdrawal' | 'payment' | 'refund' | 'bonus_accrual' | 'bonus_spend' | 'visit_adjust';

export type ClientTransaction = {
  id: string;
  type: TxType;
  /** По модулю; направление задаёт `type`. Со знаком — только у `visit_adjust`. */
  amount: NumericString;
  description: string | null;
  checkId: string | null;
  createdAt: string;
};

export type VisitProgress = { tier: string; visits: number; threshold: number; remaining: number; isResident: boolean };

export type GomafiaPlayer = {
  gomafiaId: string;
  login: string;
  fullName: string | null;
  elo: number | null;
  avatar: string | null;
  clubTitle: string | null;
  city: string | null;
  inClub?: boolean;
};

export type ClientSection = 'all' | 'resident' | 'student' | 'newbie' | 'guest' | 'archived';
export type ClientSort = 'last_check' | 'recent' | 'name' | 'balance' | 'bonus';

const PAGE = 30;
const host = () => useSession.getState().club?.host ?? 'none';

/* ─────────────────────────── Представление ─────────────────────────── */

/** Фото по приоритету, как в вебе: ручное → Telegram → GoMafia. */
export const clientPhoto = (c: Pick<Client, 'photoUrl' | 'tgPhotoUrl' | 'gomafiaPhotoUrl'>) => c.photoUrl || c.tgPhotoUrl || c.gomafiaPhotoUrl || null;

const isServiceTag = (tag: string) => tag.startsWith('gomafia:') || tag.startsWith('gmnick:');
export const gomafiaIdOf = (c: Pick<Client, 'searchTags'>) => c.searchTags?.find((t) => t.startsWith('gomafia:'))?.slice('gomafia:'.length) ?? null;
export const userTags = (c: Pick<Client, 'searchTags'>) => (c.searchTags ?? []).filter((t) => !isServiceTag(t));
/** PATCH заменяет массив тегов целиком — служебные метки GoMafia возвращаем на место. */
export const mergeTags = (c: Pick<Client, 'searchTags'>, tags: string[]) => [...tags, ...(c.searchTags ?? []).filter(isServiceTag)];

const FALLBACK_TIERS: Record<string, { label: string; color: string }> = {
  resident: { label: 'Резидент', color: '#8B5CF6' },
  student: { label: 'Студент', color: '#3B82F6' },
  newbie: { label: 'Новичок', color: '#06B6D4' },
  guest: { label: 'Гость', color: '#94A3B8' },
};

/** Подпись и hex-цвет статуса. Цвет из справочника бывает `rgba(…)` — тогда берём встроенный. */
export function tierLook(key: string, tiers: ClientTierRow[] | undefined): { label: string; color: string } {
  const row = tiers?.find((t) => t.key === key);
  const fallback = FALLBACK_TIERS[key] ?? { label: key, color: '#94A3B8' };
  const color = row && /^#[0-9a-f]{6}$/i.test(row.color) ? row.color : fallback.color;
  return { label: row?.label ?? fallback.label, color };
}

/** «депозит 1 500 ₽» / «долг 300 ₽» / null. */
export function balanceText(balance: NumericString | number): string | null {
  const b = toNumber(balance);
  if (Math.abs(b) < 0.005) return null;
  return b > 0 ? `депозит ${formatMoney(b, { kopecks: 'auto' })}` : `долг ${formatMoney(-b, { kopecks: 'auto' })}`;
}

/** Направление денежной строки истории: + пополнение, − списание, ± операция по чеку. */
export function transactionLook(tx: ClientTransaction): { title: string; sign: 1 | -1 | 0; symbol: 'arrow.down.circle.fill' | 'arrow.up.circle.fill' | 'receipt' | 'arrow.uturn.backward.circle.fill' | 'figure.walk' } {
  const fallback: Record<TxType, string> = {
    deposit: 'Пополнение',
    withdrawal: 'Списание',
    payment: 'Оплата чека',
    refund: 'Возврат',
    bonus_accrual: 'Начисление бонусов',
    bonus_spend: 'Списание бонусов',
    visit_adjust: 'Посещение',
  };
  const title = tx.description || fallback[tx.type];
  switch (tx.type) {
    case 'deposit':
      return { title, sign: 1, symbol: 'arrow.down.circle.fill' };
    case 'withdrawal':
      return { title, sign: -1, symbol: 'arrow.up.circle.fill' };
    case 'refund':
      return { title, sign: 0, symbol: 'arrow.uturn.backward.circle.fill' };
    case 'visit_adjust':
      return { title, sign: 0, symbol: 'figure.walk' };
    default:
      return { title, sign: 0, symbol: 'receipt' };
  }
}

/** Относительное время для истории: «сегодня, 14:05», «вчера, 21:30», «12 сент., 18:00». */
const dayMonth = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', timeZone: 'Europe/Moscow' });
const dayMonthYear = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Moscow' });
const hm = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' });
const mskDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' });

export function whenText(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const day = mskDay.format(date);
  const today = mskDay.format(new Date());
  const yesterday = mskDay.format(new Date(Date.now() - 86_400_000));
  const time = hm.format(date);
  if (day === today) return `сегодня, ${time}`;
  if (day === yesterday) return `вчера, ${time}`;
  const sameYear = day.slice(0, 4) === today.slice(0, 4);
  return `${(sameYear ? dayMonth : dayMonthYear).format(date).replace(' г.', '')}, ${time}`;
}

/* ─────────────────────────── Запросы ─────────────────────────── */

export function useClientTiers() {
  const club = useClubKey();
  return useQuery({
    queryKey: [club, 'clients', 'tiers'],
    queryFn: () => api.get<{ tiers: ClientTierRow[] }>('/clients/tiers').then((r) => r.tiers),
    staleTime: 10 * 60_000,
  });
}

export function useClientList(section: ClientSection, sort: ClientSort, search: string) {
  const club = useClubKey();
  const q = search.trim();
  return useInfiniteQuery({
    queryKey: [club, 'clients', 'list', section, sort, q],
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({ page: String(pageParam), sort });
      if (q) params.set('search', q);
      if (section === 'archived') params.set('filter', 'archived');
      else if (section !== 'all') params.set('tier', section);
      return api.get<{ clients: Client[]; total: number }>(`/clients?${params.toString()}`, { signal });
    },
    getNextPageParam: (last, pages) => (pages.length * PAGE < last.total ? pages.length + 1 : undefined),
    staleTime: 30_000,
  });
}

/** Клиент из уже загруженных списков — карточка открывается мгновенно, архивный сервер не отдаёт. */
function findCachedClient(club: string, clientId: string): Client | undefined {
  const own = queryClient.getQueryData<Client>([club, 'client', clientId]);
  if (own) return own;
  for (const [, data] of queryClient.getQueriesData<{ pages: { clients: Client[] }[] }>({ queryKey: [club, 'clients', 'list'] })) {
    const hit = data?.pages.flatMap((p) => p.clients).find((c) => c.id === clientId);
    if (hit) return hit;
  }
  return queryClient.getQueryData<Client[]>([club, 'clients', 'balances'])?.find((c) => c.id === clientId);
}

export function useClient(clientId: string | undefined) {
  const club = useClubKey();
  return useQuery({
    queryKey: [club, 'client', clientId],
    enabled: !!clientId,
    queryFn: async () => {
      try {
        return (await api.get<{ client: Client }>(`/clients/${clientId}`)).client;
      } catch (error) {
        // GET /clients/:id не отдаёт архивных — показываем их по данным списка.
        const cached = findCachedClient(club, clientId!);
        if (error instanceof ApiError && error.status === 404 && cached?.deletedAt) return cached;
        throw error;
      }
    },
    initialData: () => (clientId ? findCachedClient(club, clientId) : undefined),
    staleTime: 15_000,
  });
}

export function useClientTransactions(clientId: string) {
  const club = useClubKey();
  return useQuery({
    queryKey: [club, 'client', clientId, 'transactions'],
    queryFn: () => api.get<{ transactions: ClientTransaction[] }>(`/clients/${clientId}/transactions`).then((r) => r.transactions),
    staleTime: 15_000,
  });
}

export function useVisitProgress(clientId: string, enabled: boolean) {
  const club = useClubKey();
  return useQuery({
    queryKey: [club, 'client', clientId, 'visits'],
    queryFn: () => api.get<VisitProgress>(`/clients/${clientId}/visit-progress`),
    enabled,
    staleTime: 30_000,
  });
}

/** Все неархивные клиенты с ненулевым балансом — одним ответом, итоги считаем сами. */
export function useBalances() {
  const club = useClubKey();
  return useQuery({
    queryKey: [club, 'clients', 'balances'],
    queryFn: () => api.get<{ clients: Client[] }>('/clients?filter=balances').then((r) => r.clients),
    staleTime: 15_000,
  });
}

export function useGomafiaSearch(query: string) {
  const club = useClubKey();
  const q = query.trim();
  return useQuery({
    queryKey: [club, 'gomafia', q],
    queryFn: ({ signal }) => api.get<{ players: GomafiaPlayer[] }>(`/gomafia/search?q=${encodeURIComponent(q)}`, { signal }).then((r) => r.players),
    enabled: q.length >= 2,
    staleTime: 5 * 60_000,
  });
}

/* ─────────────────────────── Telegram клиента ─────────────────────────── */

/** Один человек может завести несколько Telegram: основной — в профиле, остальные — алиасы. */
export type TgAccount = { tgId: string; username: string | null; primary: boolean };

export function useClientTgAccounts(clientId: string | undefined) {
  const club = useClubKey();
  return useQuery({
    queryKey: [club, 'client', clientId, 'tg'],
    queryFn: () => api.get<{ accounts: TgAccount[] }>(`/clients/${clientId!}/tg-accounts`).then((r) => r.accounts),
    enabled: !!clientId,
    staleTime: 30_000,
  });
}

/**
 * Подписанная ссылка и QR для привязки: гость открывает её в Telegram или сканирует QR,
 * бот My Titan связывает аккаунт с профилем. Ссылка живёт 15 минут.
 */
export function useClientTelegramLink(clientId: string | undefined) {
  const club = useClubKey();
  return useQuery({
    queryKey: [club, 'client', clientId, 'tg-link'],
    queryFn: () => api.post<{ deepLink: string; qrDataUrl: string; expiresIn: number }>(`/clients/${clientId!}/telegram-link`, {}),
    enabled: !!clientId,
    // Ссылка подписана на 15 минут — перевыпускаем при следующем открытии шторки.
    staleTime: 10 * 60_000,
    gcTime: 0,
    retry: false,
  });
}

/** Участник чатов клуба, которого видел бот: из него можно привязать Telegram клиенту. */
export type TgRosterUser = {
  tgId: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  chatId: string | null;
  lastSeen: string;
  /** Ник клиента, к которому этот Telegram уже привязан (основным или дополнительным). */
  linkedTo: string | null;
};

export function useTgRoster() {
  const club = useClubKey();
  return useQuery({
    queryKey: [club, 'clients', 'tg-roster'],
    queryFn: () => api.get<{ users: TgRosterUser[] }>('/clients/tg-roster').then((r) => r.users),
    staleTime: 60_000,
  });
}

/** Добавить клиенту Telegram из ростера — не перезаписывает, а добавляет аккаунт. 409 — занят другим. */
export async function linkClientTg(clientId: string, user: Pick<TgRosterUser, 'tgId' | 'username'>): Promise<void> {
  await api.post(`/clients/${clientId}/tg-link`, { tgId: user.tgId, tgUsername: user.username ?? undefined });
  const club = host();
  void queryClient.invalidateQueries({ queryKey: [club, 'client', clientId, 'tg'] });
  void queryClient.invalidateQueries({ queryKey: [club, 'client', clientId] });
  void queryClient.invalidateQueries({ queryKey: [club, 'clients', 'tg-roster'] });
}

export async function unlinkClientTg(clientId: string, tgId: string): Promise<void> {
  await api.delete(`/clients/${clientId}/tg-link`, { tgId });
  const club = host();
  void queryClient.invalidateQueries({ queryKey: [club, 'client', clientId, 'tg'] });
  void queryClient.invalidateQueries({ queryKey: [club, 'client', clientId] });
}

/* ─────────────────────────── Изменения ─────────────────────────── */

/** Новые данные клиента — в карточку и во все списки. */
function applyClient(client: Client) {
  const club = host();
  queryClient.setQueryData([club, 'client', client.id], client);
  void queryClient.invalidateQueries({ queryKey: [club, 'clients'] });
  void queryClient.invalidateQueries({ queryKey: [club, 'pos', 'players'] });
}

function patchCachedClient(clientId: string, patch: Partial<Client>) {
  const club = host();
  const current = findCachedClient(club, clientId);
  if (current) queryClient.setQueryData<Client>([club, 'client', clientId], { ...current, ...patch });
  void queryClient.invalidateQueries({ queryKey: [club, 'clients'] });
  void queryClient.invalidateQueries({ queryKey: [club, 'client', clientId, 'transactions'] });
  void queryClient.invalidateQueries({ queryKey: [club, 'pos', 'players'] });
}

/** Сервер не различает дубль ника и сбой — оба 500. */
function clientErrorMessage(error: unknown): Error {
  if (error instanceof ApiError && error.status >= 500 && error.message === 'Internal error') {
    return new Error('Такой ник или Telegram уже занят — или сервер недоступен');
  }
  return error instanceof Error ? error : new Error(String(error));
}

export type ClientInput = {
  nickname: string;
  fullName: string | null;
  phone: string | null;
  birthday: string | null;
  clientTier: string;
  tags: string[];
};

export async function createClientProfile(input: ClientInput, gomafia: GomafiaPlayer | null): Promise<Client> {
  try {
    const { client } = await api.post<{ client: Client }>('/clients', {
      nickname: input.nickname.trim(),
      fullName: input.fullName,
      // POST не принимает null в телефоне и дне рождения — пустые поля не шлём.
      phone: input.phone ?? undefined,
      birthday: input.birthday ?? undefined,
      clientTier: input.clientTier,
      gomafiaPhotoUrl: gomafia?.avatar ?? undefined,
      searchTags: [...input.tags, ...(gomafia ? [`gomafia:${gomafia.gomafiaId}`, `gmnick:${gomafia.login}`] : [])],
    });
    applyClient(client);
    return client;
  } catch (error) {
    throw clientErrorMessage(error);
  }
}

export async function updateClient(clientId: string, patch: Partial<Omit<Client, 'id'>>): Promise<Client> {
  try {
    const { client } = await api.patch<{ client: Client }>(`/clients/${clientId}`, patch);
    applyClient(client);
    return client;
  } catch (error) {
    throw clientErrorMessage(error);
  }
}

/**
 * В архив. Веб архивирует PATCH-ем в обход проверки баланса — у нас баланс проверяется всегда:
 * владелец идёт через DELETE (сервер вернёт 409 с текстом), сотрудник — через проверку здесь.
 */
export async function archiveClient(client: Client, isOwner: boolean): Promise<void> {
  const balance = toNumber(client.balance);
  if (Math.abs(balance) >= 0.005) {
    throw new Error(`У клиента ${balanceText(balance)}. Сначала закройте баланс в «Депозитах и долгах».`);
  }
  if (isOwner) {
    await api.delete(`/clients/${client.id}`);
    patchCachedClient(client.id, { deletedAt: new Date().toISOString() });
  } else {
    await updateClient(client.id, { deletedAt: new Date().toISOString() });
  }
}

export const restoreClient = (clientId: string) => updateClient(clientId, { deletedAt: null });

/** «Удалить навсегда» — обезличивание архивного клиента (только владелец). */
export async function purgeClient(clientId: string): Promise<void> {
  await api.delete(`/clients/${clientId}/permanent`);
  const club = host();
  queryClient.removeQueries({ queryKey: [club, 'client', clientId] });
  void queryClient.invalidateQueries({ queryKey: [club, 'clients'] });
}

/**
 * Депозит или долг: `amount` > 0 — пополнить/погасить, < 0 — снять/в долг.
 * Ключ идемпотентности создаётся один раз на намерение и повторяется при ретраях.
 * `method` — чем прошли деньги; наличные сервер проводит через кассу открытой смены
 * (`cashOperation: null` — смена не открыта). «В долг» без денег — без `method`.
 */
export async function changeBalance(
  clientId: string,
  amount: number,
  reason: string,
  idempotencyKey: string,
  method?: BalanceMethod,
): Promise<{ balance: number; duplicate: boolean; cashOperation: { id: string } | null }> {
  const r = await api.post<{ balance: number; duplicate?: boolean; cashOperation?: { id: string } | null }>(`/clients/${clientId}/balance`, {
    amount,
    reason,
    idempotencyKey,
    method,
  });
  patchCachedClient(clientId, { balance: String(Math.round(r.balance * 100) / 100) });
  // Наличные изменили ожидаемый остаток кассы смены.
  if (method === 'cash') invalidateShift();
  return { balance: r.balance, duplicate: !!r.duplicate, cashOperation: r.cashOperation ?? null };
}

/** Бонусы ±; без идемпотентности на сервере — кнопку блокируем до ответа. */
export async function changeBonus(clientId: string, amount: number, reason: string): Promise<number> {
  const r = await api.post<{ bonusPoints: number }>(`/clients/${clientId}/bonus`, { amount, reason });
  patchCachedClient(clientId, { bonusPoints: String(r.bonusPoints) });
  return r.bonusPoints;
}

/** Ручное посещение ±1 у новичка; на 10-м сервер сам повышает до резидента. */
export async function adjustVisits(clientId: string, delta: 1 | -1): Promise<VisitProgress & { promoted: boolean }> {
  const r = await api.post<VisitProgress & { promoted: boolean }>(`/clients/${clientId}/visits`, { delta });
  const club = host();
  queryClient.setQueryData([club, 'client', clientId, 'visits'], r);
  if (r.promoted) patchCachedClient(clientId, { clientTier: r.tier });
  return r;
}

export async function linkGomafia(clientId: string, gomafiaId: string): Promise<Client> {
  const { client } = await api.post<{ client: Client }>(`/clients/${clientId}/gomafia-link`, { gomafiaId });
  applyClient(client);
  return client;
}

export async function unlinkGomafia(clientId: string): Promise<Client> {
  const { client } = await api.delete<{ client: Client }>(`/clients/${clientId}/gomafia-link`);
  applyClient(client);
  return client;
}

export async function fetchGomafiaFullName(gomafiaId: string): Promise<string | null> {
  try {
    const { player } = await api.get<{ player: GomafiaPlayer }>(`/gomafia/player/${gomafiaId}`);
    return player.fullName;
  } catch {
    return null;
  }
}

/* ─────────────────────────── Депозиты и долги ─────────────────────────── */

export type BalanceOp = 'deposit_add' | 'deposit_sub' | 'debt_repay' | 'debt_lend';

/** Чем прошли деньги депозита/долга; «В долг» денег не двигает и способа не имеет. */
export type BalanceMethod = 'cash' | 'transfer' | 'card';
export const BALANCE_METHOD_LABEL: Record<BalanceMethod, string> = { cash: 'Наличные', transfer: 'Перевод', card: 'Карта' };

export const BALANCE_OPS: Record<BalanceOp, { title: string; reason: string; symbol: 'plus.circle.fill' | 'minus.circle.fill' | 'checkmark.circle.fill' | 'creditcard.and.123'; color: string }> = {
  deposit_add: { title: 'Пополнить депозит', reason: 'Пополнение депозита', symbol: 'plus.circle.fill', color: '#06B6D4' },
  deposit_sub: { title: 'Снять с депозита', reason: 'Списание депозита', symbol: 'minus.circle.fill', color: '#64748B' },
  debt_repay: { title: 'Погасить долг', reason: 'Погашение долга', symbol: 'checkmark.circle.fill', color: '#10B981' },
  debt_lend: { title: 'Выдать в долг', reason: 'Долг (ручное начисление)', symbol: 'creditcard.and.123', color: '#F43F5E' },
};

/** Знак и ограничение суммы операции — как в веб-экране балансов. */
export function balanceDelta(op: BalanceOp, value: number, balance: number): number {
  const deposit = Math.max(balance, 0);
  const debt = Math.max(-balance, 0);
  switch (op) {
    case 'deposit_add':
      return value;
    case 'deposit_sub':
      return -Math.min(value, deposit);
    case 'debt_repay':
      return Math.min(value, debt);
    case 'debt_lend':
      return -value;
  }
}

/* ─────────────────────────── Заказчики ─────────────────────────── */

export type CustomerRow = { id: string; name: string | null; phone: string | null; createdAt: string };

/** Без запроса — до 200 последних, с запросом сервер отдаёт не больше 8. */
export function useCustomerList(query: string) {
  const club = useClubKey();
  const q = query.trim();
  return useQuery({
    queryKey: [club, 'customers', 'list', q],
    queryFn: ({ signal }) => api.get<{ customers: CustomerRow[] }>(`/customers${q ? `?q=${encodeURIComponent(q)}` : ''}`, { signal }).then((r) => r.customers),
    staleTime: 30_000,
  });
}

function invalidateCustomers() {
  void queryClient.invalidateQueries({ queryKey: [host(), 'customers'] });
}

export async function saveCustomer(customerId: string | null, input: { name: string | null; phone: string | null }): Promise<CustomerRow> {
  const { customer } = customerId
    ? await api.patch<{ customer: CustomerRow }>(`/customers/${customerId}`, input)
    : await api.post<{ customer: CustomerRow }>('/customers', input);
  invalidateCustomers();
  return customer;
}

export async function deleteCustomer(customerId: string): Promise<void> {
  await api.delete(`/customers/${customerId}`);
  invalidateCustomers();
}
