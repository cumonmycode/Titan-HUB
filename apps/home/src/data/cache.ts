// Кэш на диске: меню и последнее состояние кабинки переживают перезапуск и
// отсутствие сети. Ключи включают хост клуба и кабинку — данные не смешиваются.
import AsyncStorage from '@react-native-async-storage/async-storage';

const PREFIX = 'titan.home.cache.';

export type Cached<T> = { at: number; value: T };

const memory = new Map<string, Cached<unknown>>();

/** Прочитать кэш в память при запуске (до первого кадра). */
export async function preloadCache(): Promise<void> {
  try {
    const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(PREFIX));
    const pairs = await AsyncStorage.multiGet(keys);
    for (const [k, raw] of pairs) {
      if (!raw) continue;
      try {
        memory.set(k.slice(PREFIX.length), JSON.parse(raw) as Cached<unknown>);
      } catch {
        /* битая запись — пропускаем */
      }
    }
  } catch {
    /* без кэша — просто с сети */
  }
}

export function readCached<T>(key: string): Cached<T> | undefined {
  return memory.get(key) as Cached<T> | undefined;
}

export function writeCached<T>(key: string, value: T): void {
  const entry: Cached<T> = { at: Date.now(), value };
  memory.set(key, entry);
  AsyncStorage.setItem(PREFIX + key, JSON.stringify(entry)).catch(() => {});
}

export async function clearCached(): Promise<void> {
  memory.clear();
  try {
    const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(PREFIX));
    await AsyncStorage.multiRemove(keys);
  } catch {
    /* следующая запись перезапишет */
  }
}
