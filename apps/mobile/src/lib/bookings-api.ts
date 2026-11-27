import { useQuery } from '@tanstack/react-query';
import type { SFSymbol } from 'sf-symbols-typescript';

import { api } from './api';
import type { BookingRequest } from './events-api';
import { queryClient } from './query';
import { useClubKey } from './queries';

/**
 * Карточка заявки: откуда пришла, кто создал и решил, журнал, клиент клуба и диалог
 * гостя с Tai (сервер — bookings/bookingDetails.ts). Плюс заявка вручную (звонок,
 * Instagram, пришёл в клуб) и заметка персонала.
 */

export type SourceKey = 'site' | 'tai' | 'widget' | 'manual' | 'other';

export type BookingSource = { key: SourceKey; label: string; detail: string | null };

export type ManualChannel = 'phone' | 'walk_in' | 'instagram' | 'whatsapp' | 'telegram' | 'vk' | 'other';

export const MANUAL_CHANNELS: { key: ManualChannel; label: string; icon: SFSymbol }[] = [
  { key: 'phone', label: 'Звонок', icon: 'phone.fill' },
  { key: 'walk_in', label: 'Пришёл в клуб', icon: 'figure.walk' },
  { key: 'instagram', label: 'Instagram', icon: 'camera.fill' },
  { key: 'whatsapp', label: 'WhatsApp', icon: 'message.fill' },
  { key: 'telegram', label: 'Telegram (вручную)', icon: 'paperplane.fill' },
  { key: 'vk', label: 'ВКонтакте', icon: 'person.2.fill' },
  { key: 'other', label: 'Другое', icon: 'ellipsis.circle.fill' },
];

/** Как выглядит источник: иконка и цвет плашки на карточке и в списке. */
export const SOURCE_LOOK: Record<SourceKey, { label: string; icon: SFSymbol; color: string }> = {
  site: { label: 'Сайт', icon: 'globe', color: '#007AFF' },
  tai: { label: 'Telegram · Tai', icon: 'sparkles', color: '#8B5CF6' },
  widget: { label: 'Виджет брони', icon: 'calendar.badge.plus', color: '#30B0C7' },
  manual: { label: 'Вручную', icon: 'hand.raised.fill', color: '#FF9500' },
  other: { label: 'Другое', icon: 'questionmark.circle', color: '#8E8E93' },
};

/** Источник по полю source из списка (там нет готовой подписи). */
export function sourceKeyOf(source: string | null | undefined): SourceKey {
  return source === 'site' || source === 'tai' || source === 'widget' || source === 'manual' ? source : 'other';
}

export function channelLabel(booking: Pick<BookingRequest, 'meta'>): string | null {
  const key = booking.meta?.['channel'];
  return MANUAL_CHANNELS.find((c) => c.key === key)?.label ?? null;
}

export type BookingLogEntry = { id: number; action: string; actor_name: string | null; note: string | null; created_at: string };

export type BookingDetail = {
  booking: BookingRequest & {
    created_at: string;
    created_by_name: string | null;
    decided_by_name: string | null;
    decided_at: string | null;
    staff_note: string | null;
    event_title: string | null;
    event_status: string | null;
    event_date: string | null;
    event_start: string | null;
    guest_tg_id: string | null;
  };
  source: BookingSource;
  client: { id: string; nickname: string; full_name: string | null; client_tier: string; phone: string | null; photo_url: string | null } | null;
  previousRequests: number;
  guestChat: { tgId: string; aiPaused: boolean; needsAttention: boolean; dmOpen: boolean; messages: number } | null;
  log: BookingLogEntry[];
};

export function useBookingDetail(id: string | undefined) {
  const club = useClubKey();
  return useQuery({
    queryKey: [club, 'bookings', 'detail', id],
    queryFn: () => api.get<BookingDetail>(`/bookings/${id}`),
    enabled: !!id,
  });
}

function invalidateBookings(club: string) {
  void queryClient.invalidateQueries({ queryKey: [club, 'bookings'] });
}

export type ManualBooking = {
  kind: 'event' | 'game' | 'message';
  channel: ManualChannel;
  name: string;
  phone?: string;
  title?: string;
  date?: string;
  time?: string;
  guests?: number;
  location?: 'titan' | 'exit';
  address?: string;
  comment?: string;
};

export async function createManualBooking(club: string, body: ManualBooking): Promise<string> {
  const r = await api.post<{ ok: boolean; id: string }>('/bookings', body);
  invalidateBookings(club);
  return r.id;
}

export async function saveBookingNote(club: string, id: string, note: string): Promise<void> {
  await api.patch(`/bookings/${id}/note`, { note });
  invalidateBookings(club);
}

/** Строка журнала по-человечески. */
export const LOG_ACTION: Record<string, string> = {
  created: 'Заявка получена',
  confirmed: 'Подтверждена',
  cancelled: 'Отклонена',
  done: 'Обработана',
  new: 'Возвращена в новые',
  note: 'Заметка',
  client: 'Клиент заведён',
};
