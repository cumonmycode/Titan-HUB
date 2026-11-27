import { useQuery } from '@tanstack/react-query';

import { api } from './api';
import { queryClient } from './query';
import { useClubKey } from './queries';
import { useSession } from './session';

/**
 * Расписание клуба (сервер — /api/schedule, lib/schedule.ts): одно на всё — сайт,
 * Tai, касса (тип вечера при открытии смены → статистика) и опросы в Telegram.
 */

export type SlotPoll = { on: boolean; configId?: string | null; chatId?: string | null; threadId?: number | null; postTime?: string };

export type ScheduleSlot = {
  id: string;
  /** weekly — каждую неделю; once — разовое событие в дату. */
  repeat: 'weekly' | 'once';
  /** 1 = понедельник … 7 = воскресенье. */
  day?: number | null;
  /** YYYY-MM-DD. */
  date?: string | null;
  /** Ключ типа вечера: city_mafia, sport_mafia, board_games, свой. */
  evening: string;
  title: string;
  time: string;
  end?: string | null;
  onSite: boolean;
  note?: string | null;
  poll: SlotPoll;
};

export type ScheduledNight = { slotId: string; date: string; dow: number; evening: string; kind: string; title: string; time: string; once: boolean; offset: number };
export type EveningType = { key: string; label: string; color: string };
export type ScheduleChat = { id: string; title: string | null; topics: { threadId: string; name: string | null }[] };

export type Schedule = {
  slots: ScheduleSlot[];
  /** true — ещё не сохраняли: собрано из расписания сайта и опросов. */
  derived: boolean;
  upcoming: ScheduledNight[];
  eveningTypes: EveningType[];
  chats: ScheduleChat[];
};

const key = (club: string) => [club, 'schedule'];

export function useSchedule() {
  const club = useClubKey();
  return useQuery({ queryKey: key(club), queryFn: () => api.get<Schedule>('/schedule') });
}

/** Сегодняшний вечер по расписанию — касса подставляет его при открытии смены. */
export function useScheduleToday() {
  const club = useClubKey();
  return useQuery({
    queryKey: [...key(club), 'today'],
    queryFn: () => api.get<{ night: ScheduledNight | null }>('/schedule/today').then((r) => r.night),
    staleTime: 60_000,
  });
}

export async function saveSchedule(slots: ScheduleSlot[]): Promise<void> {
  const club = useSession.getState().club?.host ?? 'none';
  const saved = await api.put<Pick<Schedule, 'slots' | 'derived' | 'upcoming'>>('/schedule', { slots });
  queryClient.setQueryData<Schedule>(key(club), (old) => (old ? { ...old, ...saved } : old));
  void queryClient.invalidateQueries({ queryKey: key(club) });
  // Сайт и Tai берут расписание с сервера; в приложении — карточка сайта.
  void queryClient.invalidateQueries({ queryKey: [club, 'system', 'site-config'] });
}

export const WEEKDAY_NAMES = ['', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];

let seq = 0;
export const newSlotId = (): string => `slot-${Date.now().toString(36)}-${++seq}`;

const dayMonth = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', weekday: 'short', timeZone: 'UTC' });
export const dateLabel = (date: string): string => dayMonth.format(new Date(`${date}T12:00:00Z`));

/** Как вечер выглядит в списке: «Пятница · 19:00» или «31 октября, пт · 20:00». */
export function slotWhen(s: ScheduleSlot): string {
  const day = s.repeat === 'weekly' ? (WEEKDAY_NAMES[s.day ?? 0] ?? '') : s.date ? dateLabel(s.date) : '';
  return `${day} · ${s.time}${s.end ? `–${s.end}` : ''}`;
}
