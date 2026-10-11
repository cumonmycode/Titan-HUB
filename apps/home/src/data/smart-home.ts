// Конфигурация умного дома кабинки (адрес и токен HA из Titan HUB + устройства).
// Хранится на планшете в Keystore: панель «Свет и климат» работает, даже если
// сервер Titan недоступен (связь с HA идёт напрямую по LAN).
import { useQuery } from '@tanstack/react-query';
import * as SecureStore from 'expo-secure-store';

import { api } from './api';
import { useHost, useSignedIn } from './query';
import type { SmartHomeConfig } from './types';

const KEY = 'titan.home.smart-home';
let cache: SmartHomeConfig | undefined;

export async function hydrateSmartHome() {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    cache = raw ? (JSON.parse(raw) as SmartHomeConfig) : undefined;
  } catch {
    cache = undefined;
  }
}

export async function clearSmartHomeCache() {
  cache = undefined;
  await SecureStore.deleteItemAsync(KEY).catch(() => {});
}

export function useSmartHome() {
  const host = useHost();
  const signedIn = useSignedIn();
  return useQuery({
    queryKey: [host, 'smart-home'],
    queryFn: async () => {
      const config = await api.get<SmartHomeConfig>('/pos/tablet/smart-home');
      cache = config;
      await SecureStore.setItemAsync(KEY, JSON.stringify(config)).catch(() => {});
      return config;
    },
    enabled: signedIn,
    initialData: () => cache,
    initialDataUpdatedAt: 0,
    staleTime: 5 * 60_000,
    refetchInterval: 15 * 60_000,
    retry: false,
  });
}
