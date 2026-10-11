import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';

/**
 * Сессия киоска: клуб, зона (кабинка) и узкий tablet-токен этой зоны.
 *
 * API определяет клуб по заголовку Host, поэтому клуб — это его хост
 * (`kbr.titanpos.ru`). Токен выдаёт /auth/tablet-session после PIN сотрудника и
 * продлевает /auth/tablet-refresh — работающий планшет PIN больше не просит.
 * Всё хранится в Keystore через expo-secure-store.
 */

export type Club = { host: string; slug: string | null; name: string };
export type Space = { id: string; name: string };

type Stored = {
  club: Club | null;
  space: Space | null;
  token: string | null;
  /** Кто из сотрудников подтвердил планшет (для панели сотрудника). */
  staff: string | null;
  refreshedAt: number;
};

type SessionState = Stored & {
  hydrated: boolean;
  hydrate: () => Promise<void>;
  setClub: (club: Club) => Promise<void>;
  setSpace: (space: Space | null) => Promise<void>;
  signIn: (token: string, space: Space, staff: string | null) => Promise<void>;
  replaceToken: (token: string) => Promise<void>;
  /** Токен недействителен: зона и клуб остаются, нужен только PIN. */
  signOut: () => Promise<void>;
  /** Сменить клуб: забыть всё. */
  forgetClub: () => Promise<void>;
};

const KEY = 'titan.home.session';
const EMPTY: Stored = { club: null, space: null, token: null, staff: null, refreshedAt: 0 };

async function persist(state: Stored) {
  try {
    await SecureStore.setItemAsync(KEY, JSON.stringify(state));
  } catch {
    /* следующая запись повторит */
  }
}

const pick = (s: SessionState): Stored => ({
  club: s.club, space: s.space, token: s.token, staff: s.staff, refreshedAt: s.refreshedAt,
});

export const useSession = create<SessionState>()((set, get) => ({
  ...EMPTY,
  hydrated: false,

  hydrate: async () => {
    let stored: Stored = EMPTY;
    try {
      const raw = await SecureStore.getItemAsync(KEY);
      if (raw) stored = { ...EMPTY, ...(JSON.parse(raw) as Partial<Stored>) };
    } catch {
      /* пустая сессия */
    }
    set({ ...stored, hydrated: true });
  },

  setClub: async (club) => {
    set({ ...EMPTY, club });
    await persist(pick(get()));
  },

  setSpace: async (space) => {
    set({ space, token: null, staff: null });
    await persist(pick(get()));
  },

  signIn: async (token, space, staff) => {
    set({ token, space, staff, refreshedAt: Date.now() });
    await persist(pick(get()));
  },

  replaceToken: async (token) => {
    set({ token, refreshedAt: Date.now() });
    await persist(pick(get()));
  },

  signOut: async () => {
    set({ token: null });
    await persist(pick(get()));
  },

  forgetClub: async () => {
    set({ ...EMPTY });
    await SecureStore.deleteItemAsync(KEY).catch(() => {});
  },
}));

/** Пора продлить токен (раз в 3 дня). */
export function tokenRefreshDue(): boolean {
  const at = useSession.getState().refreshedAt;
  return !at || Date.now() - at > 3 * 24 * 3600 * 1000;
}

/**
 * Локальный стенд разработчика (http): только в dev-сборке или в сборке с
 * `EXPO_PUBLIC_LOCAL_STACK=1`. Эмулятор Android видит Mac как 10.0.2.2, планшет в
 * Wi-Fi — по адресу Mac в локальной сети.
 */
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|10\.0\.2\.2|192\.168\.\d{1,3}\.\d{1,3})(:\d+)?$/;
export const LOCAL_STACK = __DEV__ || process.env.EXPO_PUBLIC_LOCAL_STACK === '1';

/** Схема запросов к хосту клуба: в релизе всегда https. */
export function hostOrigin(host: string): string {
  return `${LOCAL_STACK && LOCAL_HOST.test(host) ? 'http' : 'https'}://${host}`;
}

/** Хост клуба из того, что ввёл человек: `kbr` → `kbr.titanpos.ru`. */
export function normalizeClubHost(input: string): string | null {
  const raw = input.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!raw) return null;
  if (LOCAL_STACK && LOCAL_HOST.test(raw)) return raw;
  if (raw.includes('.')) return /^[a-z0-9.-]+$/.test(raw) ? raw : null;
  return /^[a-z][a-z0-9-]{1,30}$/.test(raw) ? `${raw}.titanpos.ru` : null;
}
