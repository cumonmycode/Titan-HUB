import { useQuery } from '@tanstack/react-query';

import type { ImagePickerAsset } from 'expo-image-picker';

import { api } from './api';
import { CHAT_PHOTO_FIT, compressedImage } from './photo';
import { queryClient } from './query';
import { useClubKey } from './queries';

/**
 * «Диалоги Tai» — личная переписка Tai с клиентами в боте клуба (сервер —
 * /api/tai-inbox). Персонал читает, отвечает сам и ставит Tai на паузу в чате.
 * Список и переписка обновляются вживую по SSE (`tai-inbox:updated`, lib/realtime).
 */

export type InboxRole = 'user' | 'assistant' | 'staff';

/** potential — ещё не клиент (нет в базе или ни разу не был), client — ходит в клуб, staff — команда. */
export type InboxSegment = 'potential' | 'client' | 'staff';

export type InboxChat = {
  tgId: string;
  segment: InboxSegment;
  /** Вечеров с закрытым чеком. */
  visits: number;
  name: string;
  username: string | null;
  profile: { id: string; nickname: string; photoUrl: string | null; role: string } | null;
  aiPaused: boolean;
  /** Когда Tai сам вернётся (ISO): через час после последнего ответа сотрудника. */
  resumeAt: string | null;
  needsAttention: boolean;
  dmOpen: boolean;
  unread: number;
  lastMessage: { role: InboxRole; content: string; createdAt: string } | null;
  updatedAt: string;
};

export type InboxMessage = {
  id: number | string;
  role: InboxRole;
  text: string;
  voice: boolean;
  memo: string | null;
  photoUrl?: string | null;
  staff: { id: string; nickname: string } | null;
  createdAt: string;
  /** Локальная отправка с телефона: ещё в пути или не дошла. */
  local?: 'sending' | 'failed';
};

const LIST_REFRESH_MS = 30_000;
/** Сотрудник молчит час — Tai сам возвращается (как на сервере). */
export const AUTO_RESUME_MS = 60 * 60_000;

const hm = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' });
/** «в 15:40» — когда Tai вернётся в чат. */
export const resumeText = (iso: string | null): string | null => (iso ? `в ${hm.format(new Date(iso))}` : null);
const CHAT_REFRESH_MS = 15_000;

export type InboxFilter = 'all' | 'attention' | InboxSegment;
export type InboxList = { items: InboxChat[]; attention: number; counts: Record<InboxSegment, number> };

export function useTaiChats(filter: InboxFilter = 'all') {
  const club = useClubKey();
  const query = filter === 'all' ? '' : filter === 'attention' ? '?filter=attention' : `?segment=${filter}`;
  return useQuery({
    queryKey: [club, 'tai-inbox', 'list', filter],
    queryFn: () => api.get<InboxList>(`/tai-inbox${query}`),
    refetchInterval: LIST_REFRESH_MS,
  });
}

/** Диалог клиента с Tai — для карточки клиента. */
export function useClientTaiChat(profileId: string | undefined) {
  const club = useClubKey();
  return useQuery({
    queryKey: [club, 'tai-inbox', 'profile', profileId],
    queryFn: () => api.get<{ items: InboxChat[] }>(`/tai-inbox?profileId=${profileId}`).then((r) => r.items[0] ?? null),
    enabled: !!profileId,
  });
}

export function useTaiChat(tgId: string | undefined) {
  const club = useClubKey();
  return useQuery({
    queryKey: [club, 'tai-inbox', 'chat', tgId],
    queryFn: () => api.get<{ chat: InboxChat }>(`/tai-inbox/${tgId}`).then((r) => r.chat),
    enabled: !!tgId,
  });
}

export function taiMessagesKey(club: string, tgId: string) {
  return [club, 'tai-inbox', 'messages', tgId];
}

export function useTaiMessages(tgId: string | undefined) {
  const club = useClubKey();
  const key = taiMessagesKey(club, tgId ?? '');
  return useQuery({
    queryKey: key,
    queryFn: async () => {
      const { items } = await api.get<{ items: InboxMessage[]; hasMore: boolean }>(`/tai-inbox/${tgId}/messages`);
      // Неотправленное с телефона не теряем при перезапросе.
      const failed = (queryClient.getQueryData<InboxMessage[]>(key) ?? []).filter((m) => m.local === 'failed');
      return [...items, ...failed];
    },
    enabled: !!tgId,
    refetchInterval: CHAT_REFRESH_MS,
  });
}

function invalidateInbox(club: string) {
  void queryClient.invalidateQueries({ queryKey: [club, 'tai-inbox'] });
}

export async function sendTaiReply(club: string, tgId: string, text: string): Promise<{ aiPaused: boolean }> {
  const r = await api.post<{ ok: boolean; aiPaused: boolean }>(`/tai-inbox/${tgId}/messages`, { text });
  invalidateInbox(club);
  return r;
}

export async function setTaiPaused(club: string, tgId: string, aiPaused: boolean): Promise<void> {
  queryClient.setQueryData<InboxChat | undefined>([club, 'tai-inbox', 'chat', tgId], (old) =>
    old ? { ...old, aiPaused, resumeAt: aiPaused ? new Date(Date.now() + AUTO_RESUME_MS).toISOString() : null, needsAttention: aiPaused ? old.needsAttention : false } : old,
  );
  try {
    await api.patch(`/tai-inbox/${tgId}`, { aiPaused });
  } finally {
    invalidateInbox(club);
  }
}

export async function markTaiChatRead(club: string, tgId: string): Promise<void> {
  await api.post(`/tai-inbox/${tgId}/read`, {}).catch(() => {});
  invalidateInbox(club);
}

/** Последняя реплика в списке: кто сказал. */
export function lastLine(chat: InboxChat): string {
  const m = chat.lastMessage;
  if (!m) return 'Сообщений пока нет';
  const who = m.role === 'assistant' ? 'Tai: ' : m.role === 'staff' ? 'Вы: ' : '';
  return `${who}${m.content.replace(/\s+/g, ' ')}`;
}

export type TodayPoll = { chatId: string; messageId: number; title: string; kind: string; options: string[] };

/** Сегодняшние опросы записи из игровых чатов — их можно переслать клиенту. */
export function useTodayPolls(enabled: boolean) {
  const club = useClubKey();
  return useQuery({
    queryKey: [club, 'tai-inbox', 'polls'],
    queryFn: () => api.get<{ polls: TodayPoll[] }>('/tai-inbox/polls').then((r) => r.polls),
    enabled,
    staleTime: 30_000,
  });
}

export async function sendTaiPoll(club: string, tgId: string, poll: Pick<TodayPoll, 'chatId' | 'messageId'>): Promise<void> {
  await api.post(`/tai-inbox/${tgId}/poll`, { chatId: poll.chatId, messageId: poll.messageId });
  invalidateInbox(club);
}

export async function sendTaiPhoto(club: string, tgId: string, asset: ImagePickerAsset, caption: string): Promise<void> {
  const form = new FormData();
  form.append('file', await compressedImage(asset, CHAT_PHOTO_FIT));
  if (caption.trim()) form.append('caption', caption.trim());
  await api.post(`/tai-inbox/${tgId}/photo`, form);
  invalidateInbox(club);
}
