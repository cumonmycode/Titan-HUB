// Поток событий своей зоны (/tablet/stream): один SSE на планшет вместо опросов.
// Переподключается сам; «зависшее» соединение (нет даже пингов 70 с) рвём и
// открываем заново. Пока потока нет, запасной таймер опрашивает чаще.
import { useEffect, useEffectEvent } from 'react';
import { AppState } from 'react-native';
import EventSource from 'react-native-sse';
import { create } from 'zustand';

import { hostOrigin, useSession } from './session';
import type { ZoneEvent } from './types';

export const useStream = create<{ connected: boolean }>()(() => ({ connected: false }));

const STALE_MS = 70_000;

export function useZoneStream(onEvent: (event: ZoneEvent) => void) {
  const host = useSession((s) => s.club?.host ?? null);
  const token = useSession((s) => s.token);
  const handle = useEffectEvent(onEvent);

  useEffect(() => {
    if (!host || !token) return;
    let es: EventSource<'ping'> | null = null;
    let lastSeen = Date.now();

    const close = () => {
      es?.removeAllEventListeners();
      es?.close();
      es = null;
      useStream.setState({ connected: false });
    };
    const connect = () => {
      close();
      lastSeen = Date.now();
      es = new EventSource<'ping'>(`${hostOrigin(host)}/api/tablet/stream`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
        pollingInterval: 3000,
        timeoutBeforeConnection: 0,
      });
      es.addEventListener('open', () => {
        lastSeen = Date.now();
        useStream.setState({ connected: true });
      });
      es.addEventListener('ping', () => {
        lastSeen = Date.now();
      });
      es.addEventListener('message', (e) => {
        lastSeen = Date.now();
        if (!e.data) return;
        try {
          handle(JSON.parse(e.data) as ZoneEvent);
        } catch {
          /* битое событие — пропускаем */
        }
      });
      es.addEventListener('error', () => useStream.setState({ connected: false }));
      es.addEventListener('close', () => useStream.setState({ connected: false }));
    };

    connect();
    const watchdog = setInterval(() => {
      if (Date.now() - lastSeen > STALE_MS) connect();
    }, 20_000);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') connect();
    });
    return () => {
      clearInterval(watchdog);
      sub.remove();
      close();
    };
  }, [host, token]);
}
