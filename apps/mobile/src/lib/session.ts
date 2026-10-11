import * as Linking from 'expo-linking';
import * as SecureStore from 'expo-secure-store';
import { AppState } from 'react-native';
import { create } from 'zustand';

/**
 * Сессия приложения: выбранный клуб и вход в него.
 *
 * API определяет клуб только по заголовку Host, поэтому клуб — это его хост
 * (`kbr.titanpos.ru`), а токен привязан к клубу: токен одного клуба на другом
 * поддомене получает 401. Всё лежит в Keychain через expo-secure-store.
 */

export type Club = {
  /** Хост API клуба, например `kbr.titanpos.ru`. */
  host: string;
  /** Slug клуба; `null` на основном домене titanpos.ru. */
  slug: string | null;
  name: string;
};

export type SessionUser = {
  id: string;
  nickname: string;
  role: string;
  photoUrl: string | null;
};

type StoredAuth = { token: string; user: SessionUser };

type SessionState = {
  hydrated: boolean;
  club: Club | null;
  token: string | null;
  user: SessionUser | null;
  /** Экран закрыт до Face ID или PIN: холодный старт или долгий уход в фон. */
  locked: boolean;
  hydrate: () => Promise<void>;
  setClub: (club: Club) => Promise<void>;
  signIn: (token: string, user: SessionUser) => Promise<void>;
  /** Выход из клуба; клуб остаётся выбранным. */
  signOut: () => Promise<void>;
  /** Сменить клуб: забыть клуб и вход в него. */
  forgetClub: () => Promise<void>;
  lock: () => void;
  unlock: () => void;
};

const CLUB_KEY = 'titan.club';
/** Ключ SecureStore допускает только буквы, цифры, «.», «-», «_» — двоеточие порта заменяем. */
const authKey = (host: string) => `titan.auth.${host.replace(/[^A-Za-z0-9._-]/g, '_')}`;

/**
 * Доступ к записям — после первой разблокировки: VoIP-push будит приложение и на
 * заблокированном телефоне, а запись по умолчанию (WHEN_UNLOCKED) тогда не читается.
 */
const STORE_OPTIONS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK };

/** Запись с STORE_OPTIONS. Существующую запись Keychain при обновлении оставляет в старом
 *  классе доступа, поэтому сначала удаляем. */
async function writeSecure(key: string, value: string) {
  await SecureStore.deleteItemAsync(key).catch(() => {});
  await SecureStore.setItemAsync(key, value, STORE_OPTIONS);
}

/** `ok: false` — хранилище не прочиталось (телефон заблокирован), это не «пусто». */
type ReadResult<T> = { ok: true; value: T | null; raw: string | null } | { ok: false };

async function readJson<T>(key: string): Promise<ReadResult<T>> {
  let raw: string | null;
  try {
    raw = await SecureStore.getItemAsync(key);
  } catch {
    return { ok: false };
  }
  if (!raw) return { ok: true, value: null, raw: null };
  try {
    return { ok: true, value: JSON.parse(raw) as T, raw };
  } catch {
    return { ok: true, value: null, raw: null };
  }
}

/** Прочитанную старую запись (WHEN_UNLOCKED) переписываем в новый класс доступа. */
async function migrateEntry(key: string, read: ReadResult<unknown>) {
  if (read.ok && read.raw) await writeSecure(key, read.raw).catch(() => {});
}

/** Сколько раз повторить чтение, если хранилище недоступно при активном приложении. */
const HYDRATE_ACTIVE_RETRIES = 3;
const HYDRATE_RETRY_MS = 1_000;
let hydrateRetries = 0;
let waitingForActive = false;

/** Повторить hydrate, когда приложение станет активным (телефон разблокирован). */
function retryHydrateWhenActive(hydrate: () => Promise<void>) {
  if (waitingForActive) return;
  waitingForActive = true;
  const sub = AppState.addEventListener('change', (state) => {
    if (state !== 'active') return;
    sub.remove();
    waitingForActive = false;
    void hydrate();
  });
}

export const useSession = create<SessionState>()((set, get) => ({
  hydrated: false,
  club: null,
  token: null,
  user: null,
  locked: false,

  hydrate: async () => {
    if (get().hydrated) return;
    const clubRead = await readJson<Club>(CLUB_KEY);
    const club = clubRead.ok ? clubRead.value : null;
    const authRead: ReadResult<StoredAuth> = club ? await readJson<StoredAuth>(authKey(club.host)) : { ok: true, value: null, raw: null };
    if (!clubRead.ok || !authRead.ok) {
      // Хранилище закрыто (push разбудил приложение на заблокированном телефоне): не
      // записываем «нет клуба и входа» — иначе пришлось бы заново выбирать клуб и входить.
      if (AppState.currentState !== 'active') {
        retryHydrateWhenActive(() => get().hydrate());
        return;
      }
      if (hydrateRetries < HYDRATE_ACTIVE_RETRIES) {
        hydrateRetries += 1;
        setTimeout(() => void get().hydrate(), HYDRATE_RETRY_MS);
        return;
      }
      // Хранилище так и не открылось при активном приложении — как раньше: ко входу.
    }
    await migrateEntry(CLUB_KEY, clubRead);
    if (club) await migrateEntry(authKey(club.host), authRead);
    const auth = authRead.ok ? authRead.value : null;
    set({
      hydrated: true,
      club,
      token: auth?.token ?? null,
      user: auth?.user ?? null,
      // Как в вебе: при холодном старте с действующим входом — сначала разблокировка.
      locked: !!auth?.token,
    });
  },

  setClub: async (club) => {
    await writeSecure(CLUB_KEY, JSON.stringify(club));
    const authRead = await readJson<StoredAuth>(authKey(club.host));
    await migrateEntry(authKey(club.host), authRead);
    const auth = authRead.ok ? authRead.value : null;
    set({ club, token: auth?.token ?? null, user: auth?.user ?? null, locked: false });
  },

  signIn: async (token, user) => {
    const { club } = get();
    if (!club) return;
    await writeSecure(authKey(club.host), JSON.stringify({ token, user } satisfies StoredAuth));
    set({ token, user, locked: false });
  },

  signOut: async () => {
    const { club } = get();
    if (club) await SecureStore.deleteItemAsync(authKey(club.host)).catch(() => {});
    set({ token: null, user: null, locked: false });
  },

  forgetClub: async () => {
    const { club } = get();
    if (club) await SecureStore.deleteItemAsync(authKey(club.host)).catch(() => {});
    await SecureStore.deleteItemAsync(CLUB_KEY).catch(() => {});
    set({ club: null, token: null, user: null, locked: false });
  },

  lock: () => {
    if (get().token) set({ locked: true });
  },
  unlock: () => set({ locked: false }),
}));

/**
 * Локальный стенд разработчика (`localhost:3901`, http): только в dev-сборке или в сборке
 * с `EXPO_PUBLIC_LOCAL_STACK=1` для симулятора. Обычный релиз ходит лишь по https.
 */
const LOCAL_HOST = /^(localhost|127\.0\.0\.1)(:\d+)?$/;
const LOCAL_STACK = __DEV__ || process.env.EXPO_PUBLIC_LOCAL_STACK === '1';

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

/**
 * Локальный стенд без ввода: токен и хост задаются при сборке (`EXPO_PUBLIC_LOCAL_TOKEN`,
 * `EXPO_PUBLIC_LOCAL_HOST`). В симуляторе, где нечем нажимать, сборка входит сама.
 */
export async function localAutoLogin() {
  if (!LOCAL_STACK) return;
  const token = process.env.EXPO_PUBLIC_LOCAL_TOKEN;
  const host = process.env.EXPO_PUBLIC_LOCAL_HOST ?? 'localhost:3901';
  if (!token || !LOCAL_HOST.test(host)) return;
  const role = process.env.EXPO_PUBLIC_LOCAL_ROLE === 'staff' ? 'staff' : 'owner';
  await useSession.getState().setClub({ host, slug: null, name: 'Локальный стенд' });
  await useSession.getState().signIn(token, { id: '', nickname: 'local', role, photoUrl: null });
}

/**
 * Вход на локальный стенд по ссылке `titanhub://dev-login?host=localhost:3901&token=…&role=owner`:
 * сборку в симуляторе можно проверять без ввода адреса и PIN. Работает только при LOCAL_STACK —
 * в обычном релизе условие известно при сборке, ветка вырезается, и ссылка ничего не делает.
 */
export async function devLogin(url: string | null) {
  if (!LOCAL_STACK || !url || !url.includes('dev-login')) return;
  const { queryParams } = Linking.parse(url);
  const host = typeof queryParams?.host === 'string' ? queryParams.host : '';
  const token = typeof queryParams?.token === 'string' ? queryParams.token : '';
  if (!LOCAL_HOST.test(host) || !token) return;
  const role = queryParams?.role === 'staff' ? 'staff' : 'owner';
  await useSession.getState().setClub({ host, slug: null, name: 'Локальный стенд' });
  await useSession.getState().signIn(token, { id: '', nickname: 'local', role, photoUrl: null });
}
