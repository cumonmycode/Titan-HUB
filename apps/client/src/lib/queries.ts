// Данные приложения через react-query: ключи и хуки в одном месте.
import { QueryClient, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from './api';
import type {
  CheckDetail, CreatedPayment, Evenings, FeedPage, NotificationsPage, PaymentStatus, PayPurpose, Prefs, StreamView, Wallet,
} from './types';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, error) => count < 2 && !((error as { status?: number }).status === 401),
      staleTime: 15_000,
    },
  },
});

export const keys = {
  wallet: ['wallet'] as const,
  feed: (kind: string) => ['feed', kind] as const,
  notifications: ['notifications'] as const,
  check: (id: string) => ['check', id] as const,
  evenings: ['evenings'] as const,
  stream: ['stream'] as const,
};

/** Сколько и каких игровых вечеров у клиента. Меняется только после закрытого чека. */
export function useEvenings() {
  return useQuery({
    queryKey: keys.evenings,
    queryFn: () => api.get<Evenings>('/resident/evenings'),
    staleTime: 5 * 60_000,
  });
}

/** Эфир клуба и площадки. Пока приложение открыто — проверяем раз в минуту, не начался ли. */
export function useStream() {
  return useQuery({
    queryKey: keys.stream,
    queryFn: () => api.get<StreamView>('/resident/stream'),
    refetchInterval: 60_000,
  });
}

export function useWallet() {
  return useQuery({
    queryKey: keys.wallet,
    queryFn: () => api.get<Wallet>('/resident/wallet'),
    // Баланс меняется на кассе — держим свежим, пока приложение открыто.
    refetchInterval: 30_000,
  });
}

export type FeedKind = 'all' | 'money' | 'bonus';

export function useFeed(kind: FeedKind, limit = 30) {
  return useInfiniteQuery({
    queryKey: [...keys.feed(kind), limit],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api.get<FeedPage>(`/resident/feed?kind=${kind}&limit=${limit}${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`),
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function useNotifications() {
  return useInfiniteQuery({
    queryKey: keys.notifications,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api.get<NotificationsPage>(`/resident/notifications?limit=30${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`),
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function useCheck(id: string) {
  return useQuery({
    queryKey: keys.check(id),
    queryFn: () => api.get<CheckDetail>(`/auth/me/checks/${id}`),
    staleTime: Infinity,
  });
}

/** Обновить всё, что зависит от денег (после оплаты, push, возврата в приложение). */
export function refreshMoney(qc: QueryClient = queryClient) {
  void qc.invalidateQueries({ queryKey: keys.wallet });
  void qc.invalidateQueries({ queryKey: ['feed'] });
  void qc.invalidateQueries({ queryKey: keys.notifications });
  void qc.invalidateQueries({ queryKey: keys.evenings });
  void qc.invalidateQueries({ queryKey: keys.stream });
}

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids?: string[]) => api.post<{ unread: number }>('/resident/notifications/read', ids ? { ids } : {}),
    onSuccess: (r) => {
      qc.setQueryData<Wallet>(keys.wallet, (w) => (w ? { ...w, unreadNotifications: r.unread } : w));
    },
  });
}

export function useUpdatePrefs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<Prefs>) => api.patch<Prefs>('/resident/prefs', patch),
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: keys.wallet });
      const prev = qc.getQueryData<Wallet>(keys.wallet);
      if (prev) qc.setQueryData<Wallet>(keys.wallet, { ...prev, prefs: { ...prev.prefs, ...patch } });
      return { prev };
    },
    onError: (_e, _p, ctx) => {
      if (ctx?.prev) qc.setQueryData(keys.wallet, ctx.prev);
    },
    onSuccess: (prefs) => {
      qc.setQueryData<Wallet>(keys.wallet, (w) => (w ? { ...w, prefs } : w));
    },
  });
}

export function createPayment(input: { purpose: PayPurpose; amount: number; collectionId?: string }) {
  return api.post<CreatedPayment>('/auth/me/payments', input, { timeoutMs: 30_000 });
}

export async function paymentStatus(id: string): Promise<PaymentStatus> {
  const r = await api.get<{ status: PaymentStatus }>(`/auth/me/payments/${id}`);
  return r.status;
}
