// Игровые вечера клиента: подсчёты для карточки на главной и шторки «Игровые вечера».
// Сервер считает визиты (lib/clientAttendance в apps/api); здесь — только то, что
// показываем клиенту: «Без вечера» (купил, но не играл) в игровые вечера не входит.
import { colors } from './theme';
import type { EveningKey, Evenings } from './types';

export type GameKey = Exclude<EveningKey, 'none'>;

/** Виды, которые считаются игровыми вечерами, в порядке показа. */
export const GAME_KEYS: GameKey[] = ['city', 'sport', 'board', 'other'];

/** Свой цвет у каждого вида — одинаковый в полосе, легенде и столбиках по месяцам. */
export const EVENING_COLORS: Record<GameKey, string> = {
  city: colors.amber,
  sport: colors.violetLight,
  board: colors.green,
  other: colors.pink,
};

export interface EveningShare {
  key: GameKey;
  label: string;
  count: number;
  share: number;
  lastAt: string | null;
}

export interface EveningsSummary {
  games: number;
  shares: EveningShare[];
  favorite: EveningShare | null;
  thisMonth: number;
  lastGameAt: string | null;
}

const isGame = (key: EveningKey): key is GameKey => key !== 'none';
const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

export function monthGames(m: Evenings['months'][number]): number {
  return GAME_KEYS.reduce((s, k) => s + (m[k] ?? 0), 0);
}

export function summarize(data: Evenings, now = new Date()): EveningsSummary {
  const games = data.categories.filter((c) => isGame(c.key) && c.count > 0);
  const total = games.reduce((s, c) => s + c.count, 0);
  const shares: EveningShare[] = GAME_KEYS.flatMap((key) => {
    const c = games.find((g) => g.key === key);
    return c ? [{ key, label: c.label, count: c.count, share: total ? c.count / total : 0, lastAt: c.lastAt }] : [];
  });
  const favorite = shares.reduce<EveningShare | null>((best, s) => (!best || s.count > best.count ? s : best), null);
  const month = data.months.find((m) => m.month === monthKey(now));
  const lastGameAt = shares.reduce<string | null>((last, s) => (s.lastAt && (!last || s.lastAt > last) ? s.lastAt : last), null);
  return { games: total, shares, favorite, thisMonth: month ? monthGames(month) : 0, lastGameAt };
}

const monthShort = new Intl.DateTimeFormat('ru-RU', { month: 'short', timeZone: 'UTC' });

/** «нояб» из «2026-11». */
export function monthLabel(month: string): string {
  return monthShort.format(new Date(`${month}-01T00:00:00Z`)).replace('.', '');
}
