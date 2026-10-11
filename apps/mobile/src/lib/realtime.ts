import { onlineManager } from '@tanstack/react-query';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import EventSource, { type EventSourceEvent } from 'react-native-sse';

import { useBanner } from './banner';
import { isChatOnScreen } from './chat';
import { checkTitle } from './checks';
import { haptic } from './haptics';
import { queryClient } from './query';
import { hostOrigin, useSession } from './session';
import type { AppNotification, CheckListItem } from './types';

/**
 * Живые обновления клуба по SSE (react-native-sse, Bearer-токен):
 * - /system/update — события чеков и заказов → мгновенный перезапрос данных;
 * - /notifications/stream — уведомления персоналу → лента и баннер.
 *
 * Заказы и чат из кабинок берём из /system/update: в клубных поддоменах сервер пока
 * публикует эти уведомления не в канал клуба (баг прода, вынесен в отдельную задачу).
 */

type UpdateEvent =
  | 'connected'
  | 'ping'
  | 'check:created'
  | 'check:updated'
  | 'check:deleted'
  | 'check:paid'
  | 'check:closed'
  | 'order:created'
  | 'order:resolved'
  | 'chat:message'
  | 'chat:read'
  | 'smart-home:updated';

const ATTENTION = new Set(['staff_call', 'request_bill', 'client_order', 'chat_message']);

/**
 * Переподключение после ошибки: react-native-sse сам не переподключается после
 * сетевого сбоя (статус 0 — так на iOS при первом же неудачном подключении), и
 * поток умирал до перезапуска. Пауза растёт 1 → 2 → 4 … 30 с.
 */
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

function parse<T>(data: string | null): T | null {
  if (!data) return null;
  try {
    return JSON.parse(data) as T;
  } catch {
    return null;
  }
}

function checkName(host: string, checkId: string): string | null {
  const checks = queryClient.getQueryData<CheckListItem[]>([host, 'pos', 'checks']);
  const check = checks?.find((c) => c.id === checkId);
  if (!check) return null;
  return check.spaceName ? `${checkTitle(check)} · ${check.spaceName}` : checkTitle(check);
}

export function useRealtime() {
  const host = useSession((s) => s.club?.host ?? null);
  const token = useSession((s) => s.token);

  useEffect(() => {
    if (!host || !token) return;

    let updates: EventSource<UpdateEvent> | null = null;
    let notifications: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;

    const invalidate = (...keys: string[][]) => {
      for (const key of keys) void queryClient.invalidateQueries({ queryKey: [host, ...key] });
    };

    const clearReconnect = () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = null;
    };

    const close = () => {
      updates?.removeAllEventListeners();
      updates?.close();
      notifications?.removeAllEventListeners();
      notifications?.close();
      updates = null;
      notifications = null;
    };

    const scheduleReconnect = () => {
      if (reconnectTimer) return; // оба потока упали разом — переподключаемся один раз
      const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * 2 ** attempt);
      attempt += 1;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delay);
    };

    /** Ошибка потока: закрыть его и переподключиться с паузой (кроме отказа во входе). */
    const onStreamError = (source: { removeAllEventListeners: () => void; close: () => void }, event: EventSourceEvent<'error'>) => {
      // Закрываем на следующем тике: сразу после 'error' библиотека сама ставит таймер
      // повторного open() — close() его снимет, иначе остался бы поток-«зомби» без слушателей.
      setTimeout(() => {
        source.removeAllEventListeners();
        source.close();
      }, 0);
      // 401/403 — вход недействителен: не долбим сервер (запросы API разлогинят сами).
      const status = event.type === 'error' ? event.xhrStatus : 0;
      if (status === 401 || status === 403) return;
      scheduleReconnect();
    };

    const connect = () => {
      close();
      clearReconnect();
      const options = {
        headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
        pollingInterval: 4000,
        timeoutBeforeConnection: 0,
      };

      const updatesSource = new EventSource<UpdateEvent>(`${hostOrigin(host)}/api/system/update`, options);
      updates = updatesSource;
      updates.addEventListener('open', () => {
        attempt = 0;
      });
      updates.addEventListener('error', (e) => onStreamError(updatesSource, e));

      const onCheckChanged = (data: string | null) => {
        const payload = parse<{ checkId?: string }>(data);
        invalidate(['pos', 'checks'], ['pos', 'shift-summary']);
        if (payload?.checkId) invalidate(['pos', 'check', payload.checkId]);
      };
      // Открытие/закрытие/отмена чека может менять статус мероприятия (старт, оплата —
      // «Завершено», отмена — «Запланировано»): ленту мероприятий перечитываем тоже.
      const onCheckLifecycle = (data: string | null) => {
        onCheckChanged(data);
        invalidate(['events'], ['event']);
      };
      updates.addEventListener('check:created', (e) => onCheckLifecycle(e.data));
      updates.addEventListener('check:updated', (e) => onCheckChanged(e.data));
      updates.addEventListener('check:deleted', (e) => onCheckLifecycle(e.data));
      updates.addEventListener('check:paid', (e) => onCheckChanged(e.data));
      updates.addEventListener('check:closed', (e) => onCheckLifecycle(e.data));
      updates.addEventListener('order:resolved', (e) => onCheckChanged(e.data));
      // Владелец поменял помещения или токен Home Assistant — шторка кассы перечитает их.
      updates.addEventListener('smart-home:updated', () => invalidate(['smart-home']));
      updates.addEventListener('chat:read', (e) => {
        const payload = parse<{ checkId: string }>(e.data);
        if (payload) invalidate(['pos', 'chat', payload.checkId]);
      });

      updates.addEventListener('order:created', (e) => {
        onCheckChanged(e.data);
        const payload = parse<{ checkId: string; orderId: string }>(e.data);
        if (!payload) return;
        haptic.warning();
        useBanner.getState().show({
          key: payload.orderId,
          type: 'client_order',
          title: 'Заказ из кабинки',
          body: checkName(host, payload.checkId) ?? 'Гость ждёт подтверждения',
          checkId: payload.checkId,
        });
      });

      updates.addEventListener('chat:message', (e) => {
        const payload = parse<{ checkId: string; messageId: string; sender: 'guest' | 'staff' }>(e.data);
        if (!payload) return;
        invalidate(['pos', 'chat', payload.checkId]);
        if (payload.sender !== 'guest') return;
        invalidate(['pos', 'check', payload.checkId]);
        haptic.light();
        // Чат открыт — сообщение и так на экране.
        if (isChatOnScreen(payload.checkId)) return;
        useBanner.getState().show({
          key: payload.messageId,
          type: 'chat_message',
          title: 'Сообщение из кабинки',
          body: checkName(host, payload.checkId) ?? 'Откройте чат чека',
          checkId: payload.checkId,
        });
      });

      const notificationsSource = new EventSource(`${hostOrigin(host)}/api/notifications/stream`, options);
      notifications = notificationsSource;
      notifications.addEventListener('open', () => {
        attempt = 0;
      });
      notifications.addEventListener('error', (e) => onStreamError(notificationsSource, e));
      notifications.addEventListener('message', (e) => {
        const incoming = parse<Omit<AppNotification, 'isRead'>>(e.data);
        if (!incoming?.id) return;
        const notification: AppNotification = { ...incoming, isRead: false };

        // Группы уведомлений приходят с тем же id — обновляем запись и поднимаем её наверх.
        queryClient.setQueryData<AppNotification[]>([host, 'notifications'], (old) => [
          notification,
          ...(old ?? []).filter((n) => n.id !== notification.id),
        ]);

        const onScreen = notification.type === 'chat_message' && isChatOnScreen(notification.meta?.checkId as string | undefined);
        if (ATTENTION.has(notification.type) && !onScreen) {
          if (notification.type === 'staff_call' || notification.type === 'request_bill') haptic.warning();
          const checkId = typeof notification.meta?.checkId === 'string' ? notification.meta.checkId : undefined;
          useBanner.getState().show({
            key: notification.id,
            type: notification.type,
            title: notification.title,
            body: notification.body,
            checkId,
          });
        }
      });
    };

    connect();

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        attempt = 0;
        connect();
        invalidate(['pos'], ['notifications']);
      } else if (state === 'background') {
        clearReconnect();
        close();
      }
    });

    // Вернулась сеть — переподключаемся сразу, не дожидаясь паузы (в фоне потоки закрыты).
    const unsubscribeOnline = onlineManager.subscribe((online) => {
      if (!online || AppState.currentState === 'background') return;
      attempt = 0;
      connect();
    });

    return () => {
      sub.remove();
      unsubscribeOnline();
      clearReconnect();
      close();
    };
  }, [host, token]);
}
