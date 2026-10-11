import { useEffect } from 'react';
import { AppState } from 'react-native';

import { useSmartHome } from '@/data/smart-home';

import { connectHa, disconnectHa, kickHa } from './ha';
import { roomEntityIds } from './room';

/**
 * Передаёт нативному соединению с Home Assistant адрес и токен из Titan HUB и
 * устройства этой кабинки. Само соединение живёт в Android-сервисе и сохраняет
 * конфигурацию на планшете: если сервер Titan недоступен, связь с HA не рвётся.
 * Отключаем только когда Home Assistant явно убрали из интеграций клуба.
 */
export function useRoomConnection() {
  const { data, isSuccess } = useSmartHome();
  const url = data?.connection?.url ?? null;
  const token = data?.connection?.token ?? null;
  const ids = roomEntityIds(data?.room).join(',');

  useEffect(() => {
    if (!isSuccess) return;
    if (!url || !token) {
      disconnectHa();
      return;
    }
    connectHa(url, token, ids ? ids.split(',') : []);
  }, [isSuccess, url, token, ids]);

  // Экран снова на переднем плане — если связи нет, пробуем сразу, не дожидаясь паузы.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') kickHa();
    });
    return () => sub.remove();
  }, []);
}

/** Комната настроена: есть подключение и хотя бы одно устройство. */
export function useRoom() {
  const { data } = useSmartHome();
  const room = data?.room ?? null;
  const configured = !!data?.connection && !!room && (room.lights.length > 0 || !!room.climate);
  return { room, configured, hasConnection: !!data?.connection };
}
