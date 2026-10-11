import { eventMinutes, packagePrice, type EventBillingMode, type EventRate, type EventRow } from '@/lib/events-api';
import { toNumber } from '@/lib/format';

/**
 * Модель формы мероприятия: вид, длительность и итог. Чистые функции — экран и секции
 * формы считают по ним одно и то же.
 */

/** Вид в переключателе формы: миникап — отдельный формат, хотя на сервере это тоже «Титан». */
export type FormKind = 'titan' | 'exit' | 'minicap';

export const KIND_LABEL: Record<FormKind, string> = { titan: 'В клубе', exit: 'Выезд', minicap: 'Миникап' };

/** Быстрые длительности; остальное — «Другое» с выбором времени окончания. */
export const DURATION_HOURS = [1, 2, 3, 4, 5, 6] as const;

const DAY_MINUTES = 24 * 60;
/** Новое мероприятие — на 2 часа: столько же сервер считает событию без конца. */
const DEFAULT_DURATION = 120;

const pad = (n: number) => String(n).padStart(2, '0');

const minutesOfDate = (date: Date) => date.getHours() * 60 + date.getMinutes();

/** Минуты от полуночи → «ЧЧ:ММ», по модулю суток. */
const timeOf = (total: number) => {
  const t = ((total % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  return `${pad(Math.floor(t / 60))}:${pad(t % 60)}`;
};

export function initialKind(event: EventRow | undefined, format: string | undefined): FormKind {
  if (event) return event.format === 'minicap' ? 'minicap' : event.type;
  return format === 'minicap' ? 'minicap' : 'titan';
}

/** Длительность в минутах: из конца (через полночь — на следующие сутки), иначе из часов пакета. */
export const initialDuration = (event: EventRow | undefined): number => (event ? eventMinutes(event) : null) ?? DEFAULT_DURATION;

/** Длительность не из быстрых — выбрана «Другим». */
export const isCustomDuration = (minutes: number) => !DURATION_HOURS.some((h) => h * 60 === minutes);

/** Конец по началу и длительности, «ЧЧ:ММ» — то, что уходит в endTime. */
export const endTimeFor = (start: Date, minutes: number) => timeOf(minutesOfDate(start) + minutes);

/** Время окончания с системного пикера → длительность; не позже начала — значит, следующий день. */
export function durationUntil(start: Date, end: Date): number {
  const diff = minutesOfDate(end) - minutesOfDate(start);
  return diff > 0 ? diff : diff + DAY_MINUTES;
}

/** Дата конца для пикера «Окончание» (часы и минуты — остальное пикер не показывает). */
export const endDateFor = (start: Date, minutes: number) => new Date(start.getTime() + minutes * 60_000);

/** «до 22:00» или «до 02:00, след. день». */
export function endLabel(start: Date, minutes: number): string {
  const nextDay = minutesOfDate(start) + minutes >= DAY_MINUTES;
  return `до ${endTimeFor(start, minutes)}${nextDay ? ', след. день' : ''}`;
}

/** Часы для пакета и аренды: начатый час — целый (как hoursBetween на сервере). */
export const billedHours = (minutes: number) => Math.min(24, Math.max(1, Math.ceil(minutes / 60)));

/** Режимы оплаты: «По ставке» — только в клубе, у выезда зоны нет. */
export const billingModesFor = (kind: FormKind): EventBillingMode[] => (kind === 'titan' ? ['amount', 'hourly', 'rental'] : ['amount', 'hourly']);

export const BILLING_SHORT: Record<EventBillingMode, string> = { amount: 'Фикс', hourly: 'Пакет', rental: 'По ставке' };

/** Пакет на эти часы: цена и есть ли точный тариф (иначе цена досчитана от соседнего). */
export function packageQuote(hours: number, rates: EventRate[] | undefined): { price: number; exact: boolean; hasRates: boolean } {
  const list = (rates ?? []).filter((r) => r.hours > 0 && toNumber(r.price) > 0);
  return { price: packagePrice(hours, rates), exact: list.some((r) => r.hours === hours), hasRates: list.length > 0 };
}

/** Сумма для кнопки: фикс, цена пакета или оценка аренды; 0 — не показываем. */
export function formTotal({
  mode,
  amount,
  minutes,
  rates,
  hourlyRate,
}: {
  mode: EventBillingMode;
  amount: number | null;
  minutes: number;
  rates: EventRate[] | undefined;
  hourlyRate: number | null;
}): { value: number; approximate: boolean } {
  if (mode === 'amount') return { value: amount ?? 0, approximate: false };
  if (mode === 'hourly') return { value: packagePrice(billedHours(minutes), rates), approximate: false };
  return { value: (hourlyRate ?? 0) * billedHours(minutes), approximate: true };
}

/** Число гостей: пусто — не указано, иначе целое больше нуля; мусор — undefined. */
export function parseGuests(text: string): number | null | undefined {
  const value = text.trim();
  if (!value) return null;
  return /^\d{1,4}$/.test(value) && Number(value) > 0 ? Number(value) : undefined;
}
