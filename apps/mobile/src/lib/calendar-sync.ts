import * as Calendar from 'expo-calendar';
import { Platform } from 'react-native';

import { eventKind, eventTitle, isUpcoming, STATUS_LOOK, type EventRow } from './events-api';
import { formatMoney, toNumber } from './format';
import { useSession } from './session';

/**
 * Мероприятия в календаре телефона.
 *
 * Приложение ведёт СВОЙ календарь («Titan HUB · <клуб>»): туда кладутся мероприятия
 * клуба, оттуда же они правятся и удаляются. Чужие календари не трогаем.
 *
 * Связь «мероприятие клуба ↔ запись календаря» хранится не в приложении, а в самой
 * записи — служебной строкой в заметках (`MARKER`). Это самовосстанавливающийся приём:
 * даже после переустановки приложения синхронизация найдёт свои записи и не наделает дублей.
 */

const CALENDAR_COLOR = '#8B5CF6';
/** Напоминания: за час и за полчаса до начала. */
const ALARMS: Calendar.Alarm[] = [{ relativeOffset: -60 }, { relativeOffset: -30 }];
/** Окно синхронизации: прошлые мероприятия календарю уже не интересны. */
const WINDOW_BACK_DAYS = 1;
const WINDOW_FORWARD_DAYS = 180;

const marker = (eventId: string) => `titan-event:${eventId}`;
const markerOf = (notes: string | null | undefined) => /titan-event:([0-9a-f-]{36})/i.exec(notes ?? '')?.[1] ?? null;

const calendarTitle = () => `Titan HUB · ${useSession.getState().club?.name ?? 'клуб'}`;

/** Длительность по умолчанию, если у мероприятия не указан конец. */
const DEFAULT_HOURS = 4;

const HOUR_MS = 3_600_000;

/**
 * Момент «дата + время» клуба. Время мероприятий — московское (бизнес-время клуба),
 * а не часовой пояс телефона: в поездке запись иначе съезжала бы на разницу поясов.
 */
const clubMoment = (date: string, time: string) => new Date(`${date}T${time.slice(0, 5)}:00+03:00`);

/** Начало и конец мероприятия (абсолютные моменты; календарь сам покажет их в поясе телефона). */
export function eventWindow(event: EventRow): { start: Date; end: Date } {
  const start = clubMoment(event.date, event.startTime);
  if (!event.endTime) return { start, end: new Date(start.getTime() + (event.plannedHours ?? DEFAULT_HOURS) * HOUR_MS) };
  let end = clubMoment(event.date, event.endTime);
  // Конец раньше начала — мероприятие уходит за полночь.
  if (end <= start) end = new Date(end.getTime() + 24 * HOUR_MS);
  return { start, end };
}

/** Подробности мероприятия для заметок записи календаря. */
function notesFor(event: EventRow): string {
  const kind = eventKind(event);
  const money = (value: string | null) => (value && toNumber(value) > 0 ? formatMoney(toNumber(value)) : null);
  const lines = [
    `${kind.label} · ${STATUS_LOOK[event.status].label}`,
    event.customerName ? `Заказчик: ${event.customerName}${event.customerPhone ? ` · ${event.customerPhone}` : ''}` : null,
    event.attendeesCount > 0 ? `Гостей: ${event.attendeesCount}${event.maxGuests ? ` из ${event.maxGuests}` : ''}` : null,
    event.plannedHours ? `Часов: ${event.plannedHours}` : null,
    money(event.fixedAmount) ? `Стоимость: ${money(event.fixedAmount)}` : null,
    money(event.participationFee) ? `Взнос: ${money(event.participationFee)}` : null,
    money(event.prizeFund) ? `Призовой фонд: ${money(event.prizeFund)}` : null,
    event.comment,
    '',
    marker(event.id),
  ];
  return lines.filter((line) => line !== null).join('\n');
}

const locationFor = (event: EventRow) => event.location ?? (event.type === 'exit' ? 'Выезд' : null);

/** Права на календарь. Нужен полный доступ: свои записи мы ещё и правим, и удаляем. */
export async function ensureCalendarAccess(): Promise<boolean> {
  const current = await Calendar.getCalendarPermissions();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  const asked = await Calendar.requestCalendarPermissions();
  return asked.granted;
}

/** Календарь клуба: находим свой по названию или заводим новый. */
async function clubCalendar(): Promise<Calendar.ExpoCalendar | null> {
  const title = calendarTitle();
  const calendars = await Calendar.getCalendars(Calendar.EntityTypes.EVENT);
  const mine = calendars.find((c) => c.title === title && c.allowsModifications);
  if (mine) return mine;

  // iOS: источник берём у календаря по умолчанию — локальный источник есть не на всех устройствах.
  // Android: только локальный аккаунт. Календарь, заведённый в чужом аккаунте (Google),
  // его синхронизация считает лишним и удаляет при следующем обмене с сервером.
  const source =
    Platform.OS === 'android'
      ? { isLocalAccount: true, name: 'Titan HUB', type: 'LOCAL' }
      : calendars.find((c) => c.allowsModifications && c.source)?.source;
  try {
    return await Calendar.createCalendar({
      title,
      color: CALENDAR_COLOR,
      entityType: Calendar.EntityTypes.EVENT,
      name: title,
      ownerAccount: 'Titan HUB',
      accessLevel: Calendar.CalendarAccessLevel.OWNER,
      ...(source ? { sourceId: 'id' in source ? source.id : undefined, source } : {}),
    });
  } catch {
    return null;
  }
}

type SyncResult = { added: number; updated: number; removed: number };

/**
 * Синхронизации идут строго по очереди: две параллельные (экран мероприятий + сохранение
 * формы) обе не находили запись и обе её создавали — в календаре появлялся дубль.
 */
let syncQueue: Promise<unknown> = Promise.resolve();

/**
 * Приводит календарь клуба в соответствие со списком мероприятий: добавляет новые,
 * обновляет изменившиеся и убирает отменённые. Безопасно вызывать часто — лишних
 * записей не создаёт, чужие не трогает.
 */
export function syncEventsToCalendar(events: EventRow[], options: { prune?: boolean } = {}): Promise<SyncResult | null> {
  const run = syncQueue.then(() => runSync(events, options));
  syncQueue = run.catch(() => undefined);
  return run;
}

async function runSync(events: EventRow[], options: { prune?: boolean }): Promise<SyncResult | null> {
  if (!(await ensureCalendarAccess())) return null;
  const calendar = await clubCalendar();
  if (!calendar) return null;

  const now = new Date();
  const from = new Date(now);
  from.setDate(from.getDate() - WINDOW_BACK_DAYS);
  const to = new Date(now);
  to.setDate(to.getDate() + WINDOW_FORWARD_DAYS);

  const result: SyncResult = { added: 0, updated: 0, removed: 0 };

  const existing = await calendar.listEvents(from, to);
  const byEventId = new Map<string, Calendar.ExpoCalendarEvent>();
  for (const entry of existing) {
    const id = markerOf(entry.notes);
    if (!id) continue;
    // Дубли одного мероприятия (остались от прежних параллельных синхронизаций) —
    // оставляем первую запись, лишние удаляем.
    if (byEventId.has(id)) {
      await entry.delete();
      result.removed += 1;
      continue;
    }
    byEventId.set(id, entry);
  }

  const wanted = events.filter((event) => {
    if (!isUpcoming(event)) return false;
    const { start } = eventWindow(event);
    return start >= from && start <= to;
  });

  for (const event of wanted) {
    const { start, end } = eventWindow(event);
    const details = {
      title: eventTitle(event),
      startDate: start,
      endDate: end,
      location: locationFor(event),
      notes: notesFor(event),
      alarms: ALARMS,
    };
    const entry = byEventId.get(event.id);
    if (!entry) {
      await calendar.createEvent(details);
      result.added += 1;
      continue;
    }
    // Правим только при реальных изменениях: лишний update дёргает системный календарь.
    const sameTime = new Date(entry.startDate).getTime() === start.getTime() && new Date(entry.endDate).getTime() === end.getTime();
    if (!sameTime || entry.title !== details.title || entry.notes !== details.notes || (entry.location ?? null) !== details.location) {
      await entry.update(details);
      result.updated += 1;
    }
  }

  // Отменённые и удалённые мероприятия убираем из календаря — но только при полной
  // синхронизации: при отправке одной записи остальные не наши «лишние», а просто не в списке.
  if (options.prune !== false) {
    const keep = new Set(wanted.map((event) => event.id));
    for (const [eventId, entry] of byEventId) {
      if (keep.has(eventId)) continue;
      await entry.delete();
      result.removed += 1;
    }
  }

  return result;
}

/** Одно мероприятие сразу после создания или правки — не дожидаясь общей синхронизации. */
export async function pushEventToCalendar(event: EventRow): Promise<boolean> {
  const synced = await syncEventsToCalendar([event], { prune: false }).catch(() => null);
  return synced !== null;
}

/** Убрать все записи клуба из календаря — когда владелец выключает синхронизацию. */
export async function clearClubCalendar(): Promise<void> {
  if (!(await Calendar.getCalendarPermissions()).granted) return;
  const calendar = await clubCalendar();
  await calendar?.delete().catch(() => {});
}
