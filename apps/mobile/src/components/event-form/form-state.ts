import {
  defaultEventStart,
  fromDateTime,
  toDateString,
  toTimeString,
  type EventBillingMode,
  type EventInput,
  type EventRow,
  type MinicapInput,
} from '@/lib/events-api';
import { moneyText, toNumber } from '@/lib/format';
import { parseAmount } from '@/lib/shift-api';

import { costAmount, costFrom, type MinicapCosts } from './minicap-section';
import { billedHours, endTimeFor, initialDuration, initialKind, parseGuests, type FormKind } from './model';

/** Всё, что вводится в форме мероприятия; меняется только целиком (`{ ...form, ...patch }`). */
export type FormState = {
  kind: FormKind;
  /** Название — только у миникапа; у мероприятия в клубе им станет заказчик, у выезда — адрес. */
  title: string;
  customerName: string;
  customerPhone: string;
  address: string;
  spaceId: string | null;
  start: Date;
  /** Длительность в минутах; у миникапа не используется. */
  minutes: number;
  billing: EventBillingMode;
  amountText: string;
  responsibleId: string | null;
  guests: string;
  comment: string;
  fee: string;
  costs: MinicapCosts;
};

export function initialForm(initial: EventRow | undefined, format: string | undefined): FormState {
  // Старые мероприятия могли хранить ручную сумму — она и есть действующий фикс.
  const amount = initial?.manualAmount ?? initial?.fixedAmount;
  return {
    kind: initialKind(initial, format),
    title: initial?.format === 'minicap' ? (initial.title ?? '') : '',
    customerName: initial?.customerName ?? '',
    customerPhone: initial?.customerPhone ?? '',
    address: initial?.type === 'exit' ? (initial.location ?? '') : '',
    spaceId: initial?.spaceId ?? null,
    start: initial ? fromDateTime(initial.date, initial.startTime) : defaultEventStart(),
    minutes: initialDuration(initial),
    billing: initial?.billingMode ?? 'amount',
    amountText: toNumber(amount) > 0 ? moneyText(amount) : '',
    responsibleId: initial?.responsibleStaffId ?? null,
    guests: initial?.maxGuests ? String(initial.maxGuests) : '',
    comment: initial?.comment ?? '',
    fee: toNumber(initial?.participationFee) > 0 ? moneyText(initial?.participationFee) : '',
    costs: { prize: costFrom(initial?.prizeFund), lunch: costFrom(initial?.lunchCost), other: costFrom(initial?.otherCost) },
  };
}

/** «По ставке» есть только в клубе: у выезда он становится фиксом. */
export const effectiveMode = (form: Pick<FormState, 'billing' | 'kind'>): EventBillingMode =>
  form.billing === 'rental' && form.kind !== 'titan' ? 'amount' : form.billing;

type Invalid = { ok: false; title: string; message?: string };
export type BuiltInput = Invalid | { ok: true; minicap: true; input: MinicapInput } | { ok: true; minicap: false; input: EventInput };

const invalid = (title: string, message?: string): Invalid => ({ ok: false, title, message });

function buildMinicap(form: FormState): BuiltInput {
  const title = form.title.trim();
  if (!title) return invalid('Укажите название миникапа');
  const fee = form.fee.trim() ? parseAmount(form.fee) : 0;
  if (fee === null) return invalid('Проверьте стоимость участия');
  const checks = [
    [form.costs.prize, 'призового фонда'],
    [form.costs.lunch, 'обеда'],
    [form.costs.other, 'иных расходов'],
  ] as const;
  for (const [cost, label] of checks) {
    if (cost.on && cost.text.trim() && parseAmount(cost.text) === null) return invalid(`Проверьте сумму ${label}`);
  }
  // Выключенный расход уходит нулём — сервер удаляет его строку из расходов клуба.
  return {
    ok: true,
    minicap: true,
    input: {
      title,
      date: toDateString(form.start),
      startTime: toTimeString(form.start),
      participationFee: fee,
      prizeFund: costAmount(form.costs.prize),
      lunchCost: costAmount(form.costs.lunch),
      otherCost: costAmount(form.costs.other),
    },
  };
}

/**
 * Проверка и сборка запроса — те же сообщения, что раньше. Название мероприятия в клубе —
 * имя заказчика, выезда — адрес (как было до единой формы). Конец — начало плюс длительность,
 * у «Пакета» ещё и часы пакета по ней.
 */
export function buildInput(form: FormState, { initial, staffAvailable }: { initial: EventRow | undefined; staffAvailable: boolean }): BuiltInput {
  if (form.kind === 'minicap') return buildMinicap(form);

  const kind = form.kind;
  const mode = effectiveMode(form);
  const name = form.customerName.trim();
  const place = form.address.trim();
  if (kind === 'exit' && staffAvailable && !form.responsibleId) return invalid('Для выезда укажите ответственного');
  if (kind === 'titan' && !name) return invalid('Укажите имя заказчика');
  if (kind === 'exit' && !place) return invalid('Укажите адрес выезда');
  if (mode === 'rental' && !form.spaceId) return invalid('Выберите зону', 'Чек посчитает аренду по ставке выбранной зоны.');
  const amount = form.amountText.trim() ? parseAmount(form.amountText) : 0;
  if (mode === 'amount' && amount === null) return invalid('Проверьте сумму');
  const guests = parseGuests(form.guests);
  if (guests === undefined) return invalid('Проверьте число гостей', 'Целое число больше нуля — или оставьте поле пустым.');

  return {
    ok: true,
    minicap: false,
    input: {
      type: kind,
      title: kind === 'titan' ? name : place,
      location: kind === 'exit' ? place : null,
      spaceId: kind === 'titan' ? form.spaceId : null,
      date: toDateString(form.start),
      startTime: toTimeString(form.start),
      endTime: endTimeFor(form.start, form.minutes),
      paymentType: 'fixed',
      billingMode: mode,
      fixedAmount: mode === 'amount' ? (amount ?? 0) : null,
      plannedHours: mode === 'hourly' ? billedHours(form.minutes) : null,
      maxGuests: guests,
      comment: form.comment.trim() || null,
      responsibleStaffId: form.responsibleId,
      customerName: name || null,
      customerPhone: form.customerPhone.trim() || null,
      ...(initial?.manualAmount != null ? { manualAmount: null } : {}),
    },
  };
}
