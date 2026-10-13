import type { SFSymbol } from 'sf-symbols-typescript';

import type { AppNotification } from './types';

type NamedColor = 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | 'pink' | 'gray' | 'mint' | 'teal' | 'cyan' | 'indigo' | 'brown';

/** Символ и цвет уведомления по типу — как NOTIF_ICONS/NOTIF_COLORS в вебе. */
const LOOK: Record<string, { icon: SFSymbol; color: NamedColor }> = {
  staff_call: { icon: 'hand.raised.fill', color: 'orange' },
  request_bill: { icon: 'doc.text.fill', color: 'green' },
  client_order: { icon: 'takeoutbag.and.cup.and.straw.fill', color: 'purple' },
  chat_message: { icon: 'bubble.left.fill', color: 'cyan' },
  check_paid: { icon: 'checkmark.circle.fill', color: 'green' },
  large_check: { icon: 'banknote.fill', color: 'mint' },
  check_opened: { icon: 'doc.text', color: 'purple' },
  rental_started: { icon: 'timer', color: 'purple' },
  low_stock: { icon: 'exclamationmark.triangle.fill', color: 'red' },
  refund: { icon: 'arrow.uturn.backward.circle', color: 'orange' },
  large_refund: { icon: 'arrow.uturn.backward.circle.fill', color: 'red' },
  supply_received: { icon: 'shippingbox.fill', color: 'mint' },
  shift_open: { icon: 'clock', color: 'cyan' },
  shift_close: { icon: 'clock.badge.checkmark', color: 'cyan' },
  cash_discrepancy: { icon: 'exclamationmark.triangle', color: 'orange' },
  birthday: { icon: 'gift.fill', color: 'pink' },
  event_created: { icon: 'calendar.badge.plus', color: 'indigo' },
  event_completed: { icon: 'calendar.badge.checkmark', color: 'indigo' },
  new_client: { icon: 'person.badge.plus', color: 'blue' },
  client_registration: { icon: 'person.crop.circle.badge.questionmark', color: 'purple' },
  smm: { icon: 'sparkles', color: 'purple' },
  debt_created: { icon: 'wallet.bifold', color: 'red' },
  deposit_topup: { icon: 'wallet.bifold.fill', color: 'green' },
  certificate_used: { icon: 'giftcard.fill', color: 'teal' },
  booking: { icon: 'calendar.badge.clock', color: 'indigo' },
  guest_feedback: { icon: 'star.fill', color: 'yellow' },
};

export function notificationLook(type: string) {
  return LOOK[type] ?? { icon: 'bell.fill' as SFSymbol, color: 'purple' as NamedColor };
}

/** Типы, при которых карточка чека просит внимания: вызов, счёт, заказ, чат. */
const ATTENTION = new Set(['staff_call', 'request_bill', 'client_order', 'chat_message']);

export function checkNeedsAttention(
  notifications: AppNotification[] | undefined,
  check: { id: string; spaceId: string | null },
): boolean {
  if (!notifications) return false;
  return notifications.some(
    (n) =>
      !n.isRead &&
      ATTENTION.has(n.type) &&
      (n.meta?.checkId === check.id ||
        (n.type === 'staff_call' && !!check.spaceId && n.meta?.spaceId === check.spaceId)),
  );
}

const time = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' });
const dayTime = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** «только что», «12 мин назад», «19:40», «14 сент., 19:40» — как колокольчик в вебе. */
export function relativeTime(iso: string, now = Date.now()): string {
  const d = new Date(iso);
  const minutes = Math.floor((now - d.getTime()) / 60_000);
  if (minutes < 1) return 'только что';
  if (minutes < 60) return `${minutes} мин назад`;
  const today = new Date(now);
  if (d.toDateString() === today.toDateString()) return time.format(d);
  return dayTime.format(d);
}
