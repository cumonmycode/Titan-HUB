// Фоновые обязанности вошедшего планшета:
//  - поток событий зоны → синхронизация состояния (+ запасной таймер: 60 с при
//    живом потоке, 10 с без него — пока идёт аренда, итог тоже обновляется);
//  - подсказки гостю (заказ подтверждён, новое сообщение) и «оплачено» сразу;
//  - возврат к счёту, если гость ушёл посреди меню, и автовыключение комнаты;
//  - скользящее продление токена планшета;
//  - heartbeat для Titan HUB («Управление → Экраны»): версия, связь с HA и потоком.
import * as Application from 'expo-application';
import { useEffect, useEffectEvent } from 'react';
import { AppState } from 'react-native';

import { api } from '@/data/api';
import { useMenu } from '@/data/menu';
import { invalidate } from '@/data/query';
import { tokenRefreshDue, useSession } from '@/data/session';
import { useSmartHome } from '@/data/smart-home';
import { useStream, useZoneStream } from '@/data/stream';
import { requestSync, syncNow } from '@/data/sync';
import type { ZoneEvent } from '@/data/types';
import { useCart } from '@/features/menu/cart';
import { useHa } from '@/features/room/ha';
import { roomAllOff } from '@/features/room/room';
import { useRoomConnection } from '@/features/room/use-room';
import { useStaff } from '@/features/staff/staff';
import { idleFor } from '@/lib/activity';
import { haptic } from '@/lib/haptics';
import { usePrefs } from '@/lib/prefs';
import { getScreenSize } from '@/ui/screen';
import { toast } from '@/ui/toast';

import { Kiosk } from '../../../modules/titan-kiosk';

import { useVisit } from './store';

/** Гость ушёл посреди меню или чата — вернуться к счёту. */
const LAYER_IDLE_MS = 2 * 60_000;
/** Панель «Свет и климат» закрывается сама. */
const ROOM_IDLE_MS = 45_000;
const REFRESH_EVERY_MS = 6 * 3600_000;
const HEARTBEAT_MS = 5 * 60_000;
const FIRST_HEARTBEAT_MS = 15_000;

export function useGuestDriver() {
  useRoomConnection();
  useMenu(); // меню всегда под рукой: открывается мгновенно, даже без сети

  useZoneStream((e: ZoneEvent) => {
    if (e.type === 'ready') {
      void syncNow();
      return;
    }
    requestSync();
    const { phase, snapshot, layer } = useVisit.getState();
    const current = phase.kind === 'session' && phase.checkId === e.checkId;
    switch (e.event) {
      case 'check:paid':
        if (current) {
          haptic.success();
          useVisit.getState().dispatch({ type: 'paid', checkId: e.checkId, total: snapshot?.check?.totals.total ?? null });
        }
        break;
      case 'order:resolved':
        if (!current) break;
        if (e.status === 'confirmed') {
          haptic.success();
          toast('Заказ подтверждён — уже готовим');
        } else if (e.status === 'rejected') {
          haptic.warning();
          toast('Заказ отклонён. Администратор подойдёт уточнить', 'warning');
        }
        break;
      case 'chat:message':
        void invalidate('chat', e.checkId);
        if (current && e.sender === 'staff' && layer !== 'admin') {
          haptic.success();
          toast('Новое сообщение от администратора', 'info');
        }
        break;
      case 'chat:read':
        void invalidate('chat', e.checkId);
        break;
    }
  });

  // Запасной таймер: поток жив — раз в минуту (живой итог аренды), нет — чаще.
  const connected = useStream((s) => s.connected);
  useEffect(() => {
    void syncNow();
    const t = setInterval(() => void syncNow(), connected ? 60_000 : 10_000);
    return () => clearInterval(t);
  }, [connected]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void syncNow();
    });
    return () => sub.remove();
  }, []);

  // После счёта — гасим свет и выключаем кондиционер (если включено в панели сотрудника).
  const smartHome = useSmartHome();
  const phaseKind = useVisit((s) => s.phase.kind);
  const onPhase = useEffectEvent((kind: string) => {
    const room = smartHome.data?.room;
    if (kind === 'finish' && room && usePrefs.getState().roomAutoOff) void roomAllOff(room);
  });
  useEffect(() => {
    onPhase(phaseKind);
  }, [phaseKind]);

  // Гость ушёл посреди меню/переписки — через 2 минуты без касаний возвращаемся к счёту.
  // Окно оплаты не трогаем: гость сканирует QR телефоном и может не касаться планшета.
  useEffect(() => {
    const t = setInterval(() => {
      const idle = idleFor();
      const visit = useVisit.getState();
      if ((visit.layer === 'menu' || visit.layer === 'admin') && idle >= LAYER_IDLE_MS) {
        visit.close();
        useCart.getState().clear();
      }
      if (visit.roomOpen && idle >= ROOM_IDLE_MS) visit.setRoom(false);
      if (idle >= LAYER_IDLE_MS) useStaff.getState().lock();
    }, 10_000);
    return () => clearInterval(t);
  }, []);

  // Скользящая сессия: работающий планшет раз в 3 дня меняет токен на свежий.
  const refresh = useEffectEvent(async () => {
    if (!tokenRefreshDue()) return;
    try {
      const { token } = await api.post<{ token: string }>('/auth/tablet-refresh');
      await useSession.getState().replaceToken(token);
    } catch {
      /* продлим в следующий раз; 401 сам вернёт планшет к PIN */
    }
  });
  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), REFRESH_EVERY_MS);
    return () => clearInterval(t);
  }, []);

  // Heartbeat: в Titan HUB видно, что планшет жив, его версия и связь.
  const beat = useEffectEvent(() => {
    const { width, height } = getScreenSize();
    const kiosk = Kiosk.getStatus();
    void api
      .post('/tablet/heartbeat', {
        app: `${Application.nativeApplicationVersion ?? '?'} (${Application.nativeBuildVersion ?? '?'})`,
        ha: useHa.getState().status,
        stream: useStream.getState().connected,
        orientation: width >= height ? 'landscape' : 'portrait',
        model: kiosk.model.slice(0, 80),
        android: kiosk.androidVersion.slice(0, 20),
      })
      .catch(() => {});
  });
  useEffect(() => {
    const first = setTimeout(beat, FIRST_HEARTBEAT_MS);
    const t = setInterval(beat, HEARTBEAT_MS);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, []);
}
