// Меню планшета с версией: перекачивается только после изменений (ETag → 304),
// лежит в кэше на диске и показывается сразу, даже без сети.
import { useQuery } from '@tanstack/react-query';

import { api } from './api';
import { readCached, writeCached } from './cache';
import { queryClient, useHost, useSignedIn } from './query';
import type { Menu } from './types';

export function useMenu() {
  const host = useHost();
  const signedIn = useSignedIn();
  const cacheKey = `menu:${host}`;
  return useQuery({
    queryKey: [host, 'menu'],
    queryFn: async () => {
      const prev = queryClient.getQueryData<Menu>([host, 'menu']) ?? readCached<Menu>(cacheKey)?.value;
      const res = await api.get<Menu | null>('/tablet/menu', prev ? { headers: { 'If-None-Match': `"${prev.version}"` } } : undefined);
      if (res === null && prev) return prev;
      if (!res) throw new Error('Меню не загрузилось');
      writeCached(cacheKey, res);
      return res;
    },
    enabled: signedIn && !!host,
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
    initialData: () => readCached<Menu>(cacheKey)?.value,
    initialDataUpdatedAt: () => readCached<Menu>(cacheKey)?.at ?? 0,
  });
}
