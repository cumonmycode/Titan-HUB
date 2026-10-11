// Действия гостя. Каждое — одно место в интерфейсе (см. docs/HOME_REFACTOR_PLAN.md).
import { create } from 'zustand';

import { haptic } from '@/lib/haptics';
import { toast } from '@/ui/toast';

import { api, errorText } from './api';
import { invalidate } from './query';
import { requestSync } from './sync';

/** Сколько ждать до повторного вызова администратора. */
const CALL_COOLDOWN_MS = 30_000;

export const useCallState = create<{ calledAt: number }>()(() => ({ calledAt: 0 }));

export async function callStaff(): Promise<void> {
  if (Date.now() - useCallState.getState().calledAt < CALL_COOLDOWN_MS) {
    toast('Администратор уже знает — сейчас подойдёт', 'info');
    return;
  }
  try {
    await api.post('/notifications/staff-call', {});
    useCallState.setState({ calledAt: Date.now() });
    haptic.success();
    toast('Администратор уже идёт к вам');
  } catch (e) {
    toast(errorText(e), 'error');
  }
}

export async function requestBill(checkId: string): Promise<boolean> {
  try {
    await api.post('/notifications/request-bill', { checkId });
    haptic.success();
    toast('Администратор принесёт счёт');
    return true;
  } catch (e) {
    toast(errorText(e), 'error');
    return false;
  }
}

export async function sendOrder(checkId: string, lines: { itemId: string; quantity: number }[]): Promise<boolean> {
  try {
    await api.post(`/pos/checks/${checkId}/orders`, { items: lines });
    haptic.success();
    requestSync(0);
    return true;
  } catch (e) {
    haptic.error();
    toast(errorText(e), 'error');
    return false;
  }
}

export async function cancelOrder(orderId: string): Promise<void> {
  try {
    await api.post(`/pos/orders/${orderId}/cancel`, {});
    toast('Заказ отменён', 'info');
    requestSync(0);
  } catch (e) {
    toast(errorText(e), 'error');
  }
}

export async function sendChat(checkId: string, text: string): Promise<boolean> {
  const body = text.trim();
  if (!body) return false;
  try {
    await api.post(`/pos/checks/${checkId}/chat`, { text: body });
    haptic.tap();
    await invalidate('chat', checkId);
    return true;
  } catch (e) {
    toast(errorText(e), 'error');
    return false;
  }
}

export function markChatRead(checkId: string): void {
  void api
    .post(`/pos/checks/${checkId}/chat/read`, { as: 'guest' })
    .then(() => {
      void invalidate('chat', checkId);
      requestSync();
    })
    .catch(() => {});
}

export type Qr = { qrDataUrl?: string; chargedAmount?: number; baseAmount?: number; tip?: number };

/** QR СБП: сумму и чаевые (процент от серверного итога) считает сервер. */
export function createQr(checkId: string, tipPercent: number): Promise<Qr> {
  return api.post<Qr>(`/pos/checks/${checkId}/qr`, { tipPercent });
}

export async function sendFeedback(checkId: string, rating: number, tags: string[], comment: string): Promise<void> {
  try {
    await api.post(`/pos/checks/${checkId}/feedback`, { rating, tags, comment: comment.trim() || undefined });
  } catch {
    /* оценка не критична — гостю всё равно спасибо */
  }
}
