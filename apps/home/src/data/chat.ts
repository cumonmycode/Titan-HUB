// Переписка гостя с администратором в рамках счёта. Запрашивается, только пока
// открыто окно «Администратор»; новые сообщения приносит поток зоны.
import { useQuery } from '@tanstack/react-query';

import { api } from './api';
import { useHost } from './query';
import { useStream } from './stream';
import type { ChatMessage } from './types';

export function useChat(checkId: string | null, open: boolean) {
  const host = useHost();
  const streamUp = useStream((s) => s.connected);
  return useQuery({
    queryKey: [host, 'chat', checkId],
    queryFn: () => api.get<{ messages: ChatMessage[] }>(`/pos/checks/${checkId}/chat`).then((r) => r.messages),
    enabled: !!checkId && open,
    staleTime: 0,
    refetchInterval: open && !streamUp ? 15_000 : false,
  });
}
