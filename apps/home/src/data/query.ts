import { QueryClient } from '@tanstack/react-query';

import { useSession } from './session';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000, refetchOnWindowFocus: false, refetchOnReconnect: true },
  },
});

/** Ключи с хостом клуба: данные разных клубов не смешиваются. */
export const useHost = () => useSession((s) => s.club?.host ?? '');
export const useSignedIn = () => useSession((s) => !!s.token && !!s.space);

export function invalidate(...key: unknown[]) {
  const host = useSession.getState().club?.host ?? '';
  return queryClient.invalidateQueries({ queryKey: [host, ...key] });
}
