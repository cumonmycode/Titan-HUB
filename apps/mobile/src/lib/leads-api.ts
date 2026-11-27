import { useQuery } from '@tanstack/react-query';

import { api } from './api';
import type { BookingRequest } from './events-api';
import type { PlayerSearchItem } from './pos-api';
import { queryClient } from './query';
import { useClubKey } from './queries';
import { useSession } from './session';

/**
 * Раздел «Заявки» (сервер — /api/leads): новые люди, которые ещё не клиенты.
 * Записи на игру и обращения (сайт, Tai, вручную), регистрации из My Titan и те,
 * кто писал Tai в Telegram, но в базе их нет. Заявки на мероприятия — в «Событиях».
 */

export type LeadsSummary = { requests: number; registrations: number; newcomers: number };

export type Newcomer = {
  tgId: string;
  name: string;
  username: string | null;
  lastMessage: string | null;
  lastAt: string | null;
  messages: number;
  needsAttention: boolean;
};

export type LeadChat = { tgId: string; messages: number; aiPaused: boolean; needsAttention: boolean };

export type LeadRegistration = {
  id: string;
  nickname: string;
  fullName: string | null;
  phone: string | null;
  birthday: string | null;
  photoUrl: string | null;
  tgUsername: string | null;
  createdAt: string | null;
  status: string | null;
  /** ios | android | web — с чего регистрировался в My Titan. */
  platform: string | null;
  device: string | null;
  chat: LeadChat | null;
};

export type LeadRequestRef = { id: string; title: string | null; kind: string; status: string; source: string; startsAt: string | null; createdAt: string | null };

const REFRESH_MS = 60_000;
const club = () => useSession.getState().club?.host ?? 'none';

export function useLeadsSummary() {
  const key = useClubKey();
  return useQuery({
    queryKey: [key, 'leads', 'summary'],
    queryFn: () => api.get<LeadsSummary>('/leads/summary'),
    refetchInterval: REFRESH_MS,
  });
}

/** Записи на игру и обращения — то, что раньше было «Заявками с сайта» в «Событиях». */
export function useLeadRequests() {
  const key = useClubKey();
  return useQuery({
    queryKey: [key, 'bookings', 'leads'],
    queryFn: () => api.get<{ bookings: BookingRequest[] }>('/bookings?status=new&kind=game,message').then((r) => r.bookings),
    refetchInterval: REFRESH_MS,
  });
}

export function useLeadRegistrations() {
  const key = useClubKey();
  return useQuery({
    queryKey: [key, 'leads', 'registrations'],
    queryFn: () => api.get<{ items: LeadRegistration[] }>('/leads/registrations').then((r) => r.items),
    refetchInterval: REFRESH_MS,
  });
}

export function useLeadRegistration(id: string | undefined) {
  const key = useClubKey();
  return useQuery({
    queryKey: [key, 'leads', 'registration', id],
    queryFn: () => api.get<{ registration: LeadRegistration; requests: LeadRequestRef[] }>(`/leads/registrations/${id}`),
    enabled: !!id,
  });
}

/** Писали Tai, но в базе их нет. q — поиск по имени или @нику (касса). */
export function useNewcomers(q = '', enabled = true) {
  const key = useClubKey();
  const query = q.trim();
  return useQuery({
    queryKey: [key, 'leads', 'newcomers', query],
    queryFn: () => api.get<{ items: Newcomer[] }>(`/leads/newcomers${query ? `?q=${encodeURIComponent(query)}` : ''}`).then((r) => r.items),
    enabled,
    staleTime: 30_000,
  });
}

/** Новичок из Telegram → клиент клуба (Telegram привязан). Возвращает игрока для кассы. */
export async function newcomerToClient(tgId: string, body: { nickname?: string; clientTier?: string } = {}): Promise<PlayerSearchItem> {
  const { client } = await api.post<{ client: PlayerSearchItem }>(`/leads/newcomers/${tgId}/client`, body);
  const key = club();
  void queryClient.invalidateQueries({ queryKey: [key, 'leads'] });
  void queryClient.invalidateQueries({ queryKey: [key, 'tai-inbox'] });
  void queryClient.invalidateQueries({ queryKey: [key, 'clients'] });
  void queryClient.invalidateQueries({ queryKey: [key, 'pos', 'players'] });
  return client;
}

export function invalidateLeads(): void {
  void queryClient.invalidateQueries({ queryKey: [club(), 'leads'] });
}

/** «iPhone · Kai's iPhone» — с чего регистрировался. */
export function deviceText(r: Pick<LeadRegistration, 'platform' | 'device'>): string | null {
  const platform = r.platform === 'ios' ? 'iPhone' : r.platform === 'android' ? 'Android' : r.platform === 'web' ? 'браузер' : r.platform;
  return [platform, r.device].filter(Boolean).join(' · ') || null;
}
