import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { QueryClient, focusManager, onlineManager } from '@tanstack/react-query';
import Constants from 'expo-constants';
import * as Network from 'expo-network';
import Storage from 'expo-sqlite/kv-store';
import { AppState } from 'react-native';

import { ApiError } from './api';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 30 * 60_000,
      retry: (failureCount, error) => {
        // Нет смысла повторять отказ в доступе, отсутствие клуба или подписки.
        if (error instanceof ApiError && [400, 401, 402, 403, 404].includes(error.status)) return false;
        return failureCount < 2;
      },
    },
  },
});

/**
 * Кэш переживает перезапуск: без сети касса открывается с последними данными —
 * меню, клиенты, остатки, вчерашние отчёты. Деньги офлайн НЕ проводятся: запросы на
 * запись честно падают с «Нет соединения», чтобы не создать ощущение проведённой операции.
 */
export const queryPersister = createAsyncStoragePersister({
  storage: Storage,
  key: 'titan.query-cache',
  // Реже пишем на диск: касса обновляет чеки каждые несколько секунд.
  throttleTime: 3_000,
});

/** Дольше суток кэш не показываем — вчерашние остатки хуже, чем честное «нет данных». */
export const CACHE_MAX_AGE = 24 * 60 * 60_000;

/**
 * Новая сборка начинает с чистого кэша: данные, сохранённые прошлой версией, могут быть
 * в старом формате (так 0.3.0 (14) падала на экранах, сохранённых сборкой 13).
 */
const config = Constants.expoConfig;
export const CACHE_BUSTER = `${config?.version ?? '0'}-${config?.ios?.buildNumber ?? config?.android?.versionCode ?? '0'}`;

/** Перезапрашивать данные при возвращении в приложение, как refetchOnWindowFocus в вебе. */
export function subscribeAppFocus() {
  const sub = AppState.addEventListener('change', (state) => {
    focusManager.setFocused(state === 'active');
  });
  return () => sub.remove();
}

const reachable = (state: Network.NetworkState) => state.isInternetReachable ?? state.isConnected ?? true;

/**
 * Состояние сети для react-query: офлайн запросы не уходят в бесконечные ретраи,
 * а при возвращении связи данные подтягиваются сами.
 */
export function subscribeNetwork() {
  void Network.getNetworkStateAsync()
    .then((state) => onlineManager.setOnline(reachable(state)))
    .catch(() => onlineManager.setOnline(true));
  const sub = Network.addNetworkStateListener((state) => onlineManager.setOnline(reachable(state)));
  return () => sub.remove();
}
