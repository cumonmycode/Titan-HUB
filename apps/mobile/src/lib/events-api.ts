import { useQuery } from '@tanstack/react-query';
import type { SFSymbol } from 'sf-symbols-typescript';

import { api } from './api';
import { toNumber } from './format';
import { queryClient } from './query';
import { useClubKey } from './queries';
import { useSession } from './session';
import type { NumericString } from './types';

/**
 * Мероприятия: брони зала «Титан», выезды и миникапы. Контракт — mobile-api-events-analytics.md.
 * Сервер не проверяет формат дат — клиент шлёт только корректные значения. Переходы статусов
 * сервер ограничивает: создаётся только «Запланировано»/«Уточнить», завершённое не возвращается в работу (409).
 */

export type EventType = 'titan' | 'exit';
export type EventFormat = 'regular' | 'minicap';
export type EventStatus = 'planned' | 'needs_clarification' | 'active' | 'completed' | 'cancelled';
/** amount — фикс-сумма; hourly — пакет мероприятия по часам; rental — аренда зоны по её ставке. */
export type EventBillingMode = 'amount' | 'hourly' | 'rental';

export type EventRow = {
  id: string;
  type: EventType;
  title: string | null;
  location: string | null;
  spaceId: string | null;
  /** Календарная дата YYYY-MM-DD. */
  date: string;
  /** HH:MM. */
  startTime: string;
  /** HH:MM; меньше начала — событие идёт через полночь. */
  endTime: string | null;
  paymentType: 'fixed' | 'per_head' | 'free';
  billingMode: EventBillingMode;
  fixedAmount: NumericString | null;
  plannedHours: number | null;
  manualAmount: NumericString | null;
  maxGuests: number | null;
  attendeesCount: number;
  /** Игроков в составе миникапа (сервер отдаёт только для миникапов). */
  playersCount?: number;
  format: EventFormat;
  participationFee: NumericString | null;
  prizeFund: NumericString | null;
  lunchCost: NumericString | null;
  otherCost: NumericString | null;
  status: EventStatus;
  comment: string | null;
  customerName: string | null;
  customerPhone: string | null;
  responsibleStaffId: string | null;
  checkId: string | null;
  createdBy: string;
  createdAt: string;
};

/** Заявка на бронь с сайта — raw SQL, ключи в snake_case, время в формате Postgres. */
export type BookingRequest = {
  id: string;
  space_id: string | null;
  zone_name: string | null;
  name: string;
  phone: string;
  guests: number | null;
  title: string | null;
  starts_at: string;
  duration_hours: NumericString | null;
  tariff_hours: number | null;
  location: 'titan' | 'exit' | null;
  address: string | null;
  comment: string | null;
  status: 'new' | 'confirmed' | 'cancelled' | 'done';
  event_id: string | null;
};

/** Старая бронь: зона штаба, мероприятие по ней завершено. `check_total` — итог вечера. */
export type ArchivedBooking = Omit<BookingRequest, 'duration_hours'> & { event_status: EventStatus; check_total: NumericString | null };

export type EventRate = { hours: number; price: NumericString };
export type Customer = { id: string; name: string | null; phone: string | null };
export type StaffMember = { id: string; nickname: string; role: string; photoUrl: string | null };

export const STATUS_LOOK: Record<EventStatus, { label: string; color: string; symbol: SFSymbol }> = {
  planned: { label: 'Запланировано', color: '#3B82F6', symbol: 'clock' },
  needs_clarification: { label: 'Уточнить', color: '#F59E0B', symbol: 'questionmark.circle' },
  active: { label: 'Идёт', color: '#10B981', symbol: 'play.circle.fill' },
  completed: { label: 'Завершено', color: '#94A3B8', symbol: 'checkmark.circle' },
  cancelled: { label: 'Отменено', color: '#F43F5E', symbol: 'xmark.circle' },
};

export function eventKind(event: Pick<EventRow, 'type' | 'format'>): { label: string; symbol: SFSymbol; color: string } {
  if (event.format === 'minicap') return { label: 'Миникап', symbol: 'trophy', color: '#A855F7' };
  if (event.type === 'exit') return { label: 'Выезд', symbol: 'car', color: '#06B6D4' };
  return { label: 'Titan клуб', symbol: 'building.2', color: '#8B5CF6' };
}

export const eventTitle = (event: EventRow) => event.title || eventKind(event).label;
export const isUpcoming = (event: EventRow) => event.status !== 'completed' && event.status !== 'cancelled';

/** База мероприятия — как `computeEventBase` на сервере. «По ставке зоны» — 0: считает аренда в чеке. */
export function eventBase(event: EventRow, rates: EventRate[] | undefined): number {
  if (event.billingMode === 'rental') return 0;
  if (event.billingMode === 'hourly') return packagePrice(event.plannedHours ?? 0, rates);
  if (event.manualAmount !== null) return toNumber(event.manualAmount);
  return toNumber(event.fixedAmount);
}

/**
 * Цена пакета на h часов — как `hourlyPackagePrice` на сервере: точный тариф, иначе
 * ближайший меньший пакет плюс остаток по его цене часа (раньше выходило 0 ₽).
 */
export function packagePrice(h: number, rates: EventRate[] | undefined): number {
  if (!h) return 0;
  const list = (rates ?? []).map((r) => ({ hours: r.hours, price: toNumber(r.price) })).filter((r) => r.hours > 0).sort((a, b) => a.hours - b.hours);
  const exact = list.find((r) => r.hours === h);
  if (exact) return exact.price;
  const lower = list.filter((r) => r.hours < h).pop();
  if (lower) return Math.round(lower.price + (h - lower.hours) * (lower.price / lower.hours));
  const upper = list.find((r) => r.hours > h);
  return upper ? Math.round(h * (upper.price / upper.hours)) : 0;
}

/** Подпись режима оплаты мероприятия. */
export const BILLING_LABEL: Record<EventBillingMode, string> = {
  amount: 'Фикс',
  hourly: 'Пакет по часам',
  rental: 'По ставке зоны',
};

export const timeRange = (event: Pick<EventRow, 'startTime' | 'endTime'>) =>
  event.endTime ? `${event.startTime}–${event.endTime}` : `с ${event.startTime}`;

/* ─────────────────────────── Даты (бизнес-время клуба — Москва) ─────────────────────────── */

const MSK = 'Europe/Moscow';

/** Сегодняшняя дата по Москве, YYYY-MM-DD. */
export function todayMsk(offsetDays = 0): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: MSK, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(
    new Date(Date.now() + offsetDays * 86_400_000),
  );
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

const utcDate = (date: string) => new Date(`${date}T12:00:00Z`);
const dayFormat = new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const monthFormat = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const shortMonth = new Intl.DateTimeFormat('ru-RU', { month: 'short', timeZone: 'UTC' });

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** «Сегодня», «Завтра», «Вчера» или «Пятница, 19 сентября». */
export function dayLabel(date: string): string {
  if (date === todayMsk()) return 'Сегодня';
  if (date === todayMsk(1)) return 'Завтра';
  if (date === todayMsk(-1)) return 'Вчера';
  return capitalize(dayFormat.format(utcDate(date)));
}

/** «Сентябрь 2026». */
export const monthLabel = (monthKey: string) => capitalize(monthFormat.format(utcDate(`${monthKey}-01`)).replace(/\s*г\.?$/, ''));
export const dayNumber = (date: string) => String(Number(date.slice(8, 10)));
export const monthShort = (date: string) => shortMonth.format(utcDate(date)).replace('.', '');

/** Время Postgres «2026-09-17 15:00:00+00» → Date (Hermes не всегда понимает этот формат). */
export function parsePgTimestamp(value: string): Date {
  const iso = value.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00');
  return new Date(iso);
}

/**
 * Дата из сырого SQL («2026-09-17 09:12:34.123456+00») или ISO. Hermes не разбирает
 * больше трёх знаков долей секунды — микросекунды Postgres режем. Мусор → null.
 */
export function parseServerDate(value: string | null): Date | null {
  if (!value) return null;
  const date = value.includes('T') ? new Date(value) : parsePgTimestamp(value.replace(/(\.\d{3})\d+/, '$1'));
  return Number.isNaN(date.getTime()) ? null : date;
}

const mskDateTime = new Intl.DateTimeFormat('ru-RU', { timeZone: MSK, day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
export const formatMskDateTime = (date: Date) => mskDateTime.format(date);

const pad = (n: number) => String(n).padStart(2, '0');

/** Дата и время с системного пикера (часы устройства) → поля мероприятия YYYY-MM-DD и HH:MM. */
export const toDateString = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const toTimeString = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

export function fromDateTime(date: string, time: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return new Date(y ?? 2026, (m ?? 1) - 1, d ?? 1, hh ?? 18, mm ?? 0);
}

/** Мероприятия по умолчанию начинаются в 18:00 сегодняшнего дня. */
export function defaultEventStart(): Date {
  const d = new Date();
  d.setHours(18, 0, 0, 0);
  return d;
}

/* ─────────────────────────── Контакты ─────────────────────────── */

/** Телефон в международном виде без «+»: 8 (999) → 7999…, как в веб-кассе. */
export function normalizePhone(phone: string): string | null {
  let digits = phone.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('8')) digits = `7${digits.slice(1)}`;
  if (digits.length === 10) digits = `7${digits}`;
  return digits.length >= 11 ? digits : null;
}

/* ─────────────────────────── Запросы ─────────────────────────── */

export function useEvents() {
  const club = useClubKey();
  return useQuery({
    queryKey: [club, 'events'],
    queryFn: () => api.get<{ events: EventRow[] }>('/events').then((r) => r.events),
    staleTime: 30_000,
  });
}

export function useEvent(eventId: string | undefined) {
  const club = useClubKey();
  return useQuery({
    queryKey: [club, 'event', eventId],
    queryFn: () => api.get<{ event: EventRow }>(`/events/${eventId}`).then((r) => r.event),
    enabled: !!eventId,
    // Из списка карточка открывается мгновенно, свежие данные догружаются следом.
    initialData: () => queryClient.getQueryData<EventRow[]>([club, 'events'])?.find((e) => e.id === eventId),
    initialDataUpdatedAt: () => queryClient.getQueryState([club, 'events'])?.dataUpdatedAt,
    staleTime: 15_000,
  });
}

/** Новые заявки на бронь — веб опрашивает раз в минуту. */
export function useBookingRequests() {
  const club = useClubKey();
  return useQuery({
    queryKey: [club, 'bookings', 'new'],
    queryFn: () => api.get<{ bookings: BookingRequest[] }>('/bookings?status=new').then((r) => r.bookings),
    refetchInterval: 60_000,
  });
}

/** «Старые брони» — как вкладка «Старые» в веб-мероприятиях (последние 200). */
export function useArchivedBookings(enabled: boolean) {
  const club = useClubKey();
  return useQuery({
    queryKey: [club, 'bookings', 'archive'],
    queryFn: () => api.get<{ bookings: ArchivedBooking[] }>('/bookings/archive').then((r) => r.bookings),
    enabled,
    staleTime: 5 * 60_000,
  });
}

export function useEventRates() {
  const club = useClubKey();
  return useQuery({
    queryKey: [club, 'pricing', 'event-rates'],
    queryFn: () => api.get<{ rates: EventRate[] }>('/pricing/event-rates').then((r) => r.rates),
    staleTime: 10 * 60_000,
  });
}

/** Список сотрудников — только владельцу; у сотрудника сервер ответит 403, выбор ответственного скрываем. */
export function useStaffList() {
  const club = useClubKey();
  const isOwner = useSession((s) => s.user?.role === 'owner');
  return useQuery({
    queryKey: [club, 'staff'],
    queryFn: () => api.get<{ staff: StaffMember[] }>('/staff').then((r) => r.staff),
    enabled: isOwner,
    staleTime: 10 * 60_000,
  });
}

export function useCustomers(query: string) {
  const club = useClubKey();
  const q = query.trim();
  return useQuery({
    queryKey: [club, 'customers', q],
    queryFn: ({ signal }) => api.get<{ customers: Customer[] }>(`/customers?q=${encodeURIComponent(q)}`, { signal }).then((r) => r.customers),
    enabled: q.length >= 2,
    staleTime: 30_000,
  });
}

/** Зона на время мероприятия: свободна или чем занята (GET /events/availability). */
export type SpaceAvailability = {
  id: string;
  name: string;
  hourlyRate: NumericString;
  free: boolean;
  conflict: { id: string; title: string | null; date: string; startTime: string; endTime: string | null } | null;
};

export type AvailabilityRequest = { date: string; startTime: string; endTime: string | null; plannedHours: number | null; excludeEventId?: string };

/**
 * Свободные и занятые зоны на выбранное время. Проверка та же, что при сохранении, —
 * «свободна» значит, что сервер не ответит 409. Пока параметры меняются, показываем
 * прошлый ответ, а не пустой список.
 */
export function useEventAvailability(request: AvailabilityRequest | null) {
  const club = useClubKey();
  const params = request
    ? [
        `date=${request.date}`,
        `startTime=${encodeURIComponent(request.startTime)}`,
        request.endTime ? `endTime=${encodeURIComponent(request.endTime)}` : null,
        request.plannedHours ? `plannedHours=${request.plannedHours}` : null,
        request.excludeEventId ? `excludeEventId=${request.excludeEventId}` : null,
      ]
        .filter(Boolean)
        .join('&')
    : '';
  return useQuery({
    queryKey: [club, 'event-availability', params],
    queryFn: ({ signal }) => api.get<{ spaces: SpaceAvailability[] }>(`/events/availability?${params}`, { signal }).then((r) => r.spaces),
    enabled: !!request,
    placeholderData: (previous) => previous,
    staleTime: 15_000,
  });
}

/* ─────────────────────────── Изменения ─────────────────────────── */

export type EventInput = {
  type: EventType;
  title: string | null;
  location: string | null;
  spaceId: string | null;
  date: string;
  startTime: string;
  endTime: string | null;
  paymentType: 'fixed';
  billingMode: EventBillingMode;
  fixedAmount: number | null;
  /** Ручная сумма старых мероприятий перекрывает фикс; форма сбрасывает её в null, сумма — в fixedAmount. */
  manualAmount?: number | null;
  plannedHours: number | null;
  /** Сколько гостей ждут; null — не указано. */
  maxGuests?: number | null;
  comment: string | null;
  responsibleStaffId: string | null;
  customerName: string | null;
  customerPhone: string | null;
};

function invalidateEvents(eventId?: string) {
  const host = useSession.getState().club?.host ?? 'none';
  void queryClient.invalidateQueries({ queryKey: [host, 'events'] });
  if (eventId) void queryClient.invalidateQueries({ queryKey: [host, 'event', eventId] });
}

function applyEvent(event: EventRow) {
  const host = useSession.getState().club?.host ?? 'none';
  queryClient.setQueryData([host, 'event', event.id], event);
  void queryClient.invalidateQueries({ queryKey: [host, 'events'] });
}

export async function createEvent(input: EventInput): Promise<EventRow> {
  const { event } = await api.post<{ event: EventRow }>('/events', input);
  applyEvent(event);
  return event;
}

export async function updateEvent(
  eventId: string,
  input: (Partial<EventInput> | Partial<MinicapInput>) & { status?: EventStatus },
): Promise<EventRow> {
  const { event } = await api.patch<{ event: EventRow }>(`/events/${eventId}`, input);
  applyEvent(event);
  // Смена статуса открывает (старт) или отменяет (отмена) чеки мероприятия, правка
  // идущего — меняет базу/зону его чека: касса должна увидеть это сразу.
  if (input.status !== undefined || event.status === 'active') refreshLineup(eventId);
  return event;
}

/** Состав миникапа и кассовые чеки меняются вместе: взнос, предоплата и старт пишут в чеки участников. */
function refreshLineup(eventId: string) {
  const host = useSession.getState().club?.host ?? 'none';
  void queryClient.invalidateQueries({ queryKey: [host, 'event', eventId, 'participants'] });
  for (const key of [['pos', 'checks'], ['pos', 'shift-summary']]) void queryClient.invalidateQueries({ queryKey: [host, ...key] });
}

/**
 * Старт открывает чек мероприятия в кассе, у миникапа — по счёту каждому участнику.
 * Нужна открытая смена, иначе сервер ответит 400.
 */
export async function startEvent(eventId: string): Promise<EventRow> {
  const event = await updateEvent(eventId, { status: 'active' });
  refreshLineup(eventId);
  return event;
}

/** Удаление навсегда (только владелец и только отменённое). */
export async function purgeEvent(eventId: string): Promise<void> {
  await api.delete(`/events/${eventId}?purge=true`);
  invalidateEvents(eventId);
}

/** Подтверждение заявки создаёт мероприятие; возвращает его id. */
export async function resolveBooking(bookingId: string, status: 'confirmed' | 'cancelled'): Promise<string | null> {
  const r = await api.patch<{ ok: boolean; eventId: string | null }>(`/bookings/${bookingId}`, { status });
  const host = useSession.getState().club?.host ?? 'none';
  void queryClient.invalidateQueries({ queryKey: [host, 'bookings'] });
  invalidateEvents();
  return r.eventId;
}

/* ─────────────────────────── Миникап ─────────────────────────── */

export const MINICAP_MAX_PLAYERS = 10;

export type ParticipantRole = 'player' | 'judge';

export type EventParticipant = {
  id: string;
  profileId: string;
  nickname: string | null;
  clientTier: string | null;
  role: ParticipantRole;
  prepaid: boolean;
  checkId: string | null;
  checkStatus: 'open' | 'closed' | 'cancelled' | null;
  /** У открытого чека — только позиции минус скидки, без взноса; у закрытого — полный итог. */
  checkTotal: NumericString | null;
  eventBaseAmount: NumericString | null;
  prepaidAmount: NumericString | null;
};

export type MinicapInput = {
  title: string;
  date: string;
  startTime: string;
  participationFee: number | null;
  prizeFund: number | null;
  lunchCost: number | null;
  otherCost: number | null;
};

/** Счёт участника в кассе: у открытого чека к оплате позиции + взнос − предоплата. */
export function participantBill(p: EventParticipant): { state: 'none' | 'open' | 'closed' | 'cancelled'; amount: number } {
  if (!p.checkId || !p.checkStatus) return { state: 'none', amount: 0 };
  if (p.checkStatus === 'closed') return { state: 'closed', amount: toNumber(p.checkTotal) };
  if (p.checkStatus === 'cancelled') return { state: 'cancelled', amount: 0 };
  const total = toNumber(p.checkTotal) + toNumber(p.eventBaseAmount);
  return { state: 'open', amount: Math.max(0, total - Math.min(toNumber(p.prepaidAmount), total)) };
}

/** `live` — пока миникап идёт: счета участников меняются в кассе, список обновляется сам. */
export function useEventParticipants(eventId: string | undefined, live = false) {
  const club = useClubKey();
  return useQuery({
    queryKey: [club, 'event', eventId, 'participants'],
    queryFn: () => api.get<{ participants: EventParticipant[] }>(`/events/${eventId}/participants`).then((r) => r.participants),
    enabled: !!eventId,
    staleTime: 10_000,
    refetchInterval: live ? 15_000 : false,
  });
}

export type EventParticipantsQuery = ReturnType<typeof useEventParticipants>;

/** Миникап всегда в клубе: сервер сам ставит «Титан», локацию TITAN и снимает зону. */
export async function createMinicap(input: MinicapInput): Promise<EventRow> {
  const { event } = await api.post<{ event: EventRow }>('/events', {
    ...input,
    format: 'minicap',
    type: 'titan',
    location: 'TITAN',
    paymentType: 'fixed',
    billingMode: 'amount',
  });
  applyEvent(event);
  return event;
}

export async function updateMinicap(eventId: string, input: MinicapInput): Promise<EventRow> {
  const event = await updateEvent(eventId, input);
  refreshLineup(eventId);
  return event;
}

/** У идущего миникапа сервер сразу открывает участнику счёт — если открыта смена. */
export async function addParticipant(eventId: string, profileId: string, role: ParticipantRole): Promise<void> {
  try {
    await api.post(`/events/${eventId}/participants`, { profileId, role });
  } finally {
    refreshLineup(eventId);
  }
}

/** Тумблер «Оплатил»: интерфейс меняется сразу, при ошибке — откат. */
export async function setParticipantPrepaid(eventId: string, participantId: string, prepaid: boolean): Promise<void> {
  const host = useSession.getState().club?.host ?? 'none';
  const key = [host, 'event', eventId, 'participants'];
  await queryClient.cancelQueries({ queryKey: key });
  const previous = queryClient.getQueryData<EventParticipant[]>(key);
  queryClient.setQueryData<EventParticipant[]>(key, (list) =>
    list?.map((p) =>
      p.id === participantId
        ? { ...p, prepaid, prepaidAmount: p.checkStatus === 'open' ? (prepaid ? p.eventBaseAmount : '0') : p.prepaidAmount }
        : p,
    ),
  );
  try {
    await api.patch(`/events/${eventId}/participants/${participantId}`, { prepaid });
  } catch (error) {
    queryClient.setQueryData(key, previous);
    throw error;
  } finally {
    refreshLineup(eventId);
  }
}

/** Открытый пустой счёт участника отменяется вместе с ним; с позициями сервер откажет. */
export async function removeParticipant(eventId: string, participantId: string): Promise<void> {
  const host = useSession.getState().club?.host ?? 'none';
  const key = [host, 'event', eventId, 'participants'];
  await queryClient.cancelQueries({ queryKey: key });
  const previous = queryClient.getQueryData<EventParticipant[]>(key);
  queryClient.setQueryData<EventParticipant[]>(key, (list) => list?.filter((p) => p.id !== participantId));
  try {
    await api.delete(`/events/${eventId}/participants/${participantId}`);
  } catch (error) {
    queryClient.setQueryData(key, previous);
    throw error;
  } finally {
    refreshLineup(eventId);
  }
}

export function eventErrorMessage(message: string): string {
  if (message === 'Not found') return 'Мероприятие не найдено — возможно, его удалили.';
  if (message === 'Forbidden') return 'Это действие доступно только владельцу.';
  return message;
}

/* ─────────────────────────── Лента событий ─────────────────────────── */

const weekdayShort = new Intl.DateTimeFormat('ru-RU', { weekday: 'short', timeZone: 'UTC' });
const dayAndMonth = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: 'UTC' });

/** Заголовок дня в ленте: «Сегодня», «Завтра», «Вчера» или «Пт, 10 октября» (другой год — с годом). */
export function dayHeader(date: string): string {
  const today = todayMsk();
  if (date === today) return 'Сегодня';
  if (date === todayMsk(1)) return 'Завтра';
  if (date === todayMsk(-1)) return 'Вчера';
  const day = utcDate(date);
  const year = date.slice(0, 4) === today.slice(0, 4) ? '' : ` ${date.slice(0, 4)}`;
  return `${capitalize(weekdayShort.format(day).replace('.', ''))}, ${dayAndMonth.format(day)}${year}`;
}

const minutesOf = (time: string) => {
  const [h, m] = time.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/** Длительность в минутах: по началу и концу (через полночь — тоже), без конца — по пакету часов. */
export function eventMinutes(event: Pick<EventRow, 'startTime' | 'endTime' | 'plannedHours'>): number | null {
  if (event.endTime) {
    const diff = minutesOf(event.endTime) - minutesOf(event.startTime);
    if (diff === 0) return null;
    return diff > 0 ? diff : diff + 24 * 60;
  }
  return event.plannedHours ? event.plannedHours * 60 : null;
}

/** «3 ч», «2 ч 30 мин», «45 мин». */
export function durationText(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} мин`;
  return m === 0 ? `${h} ч` : `${h} ч ${m} мин`;
}
