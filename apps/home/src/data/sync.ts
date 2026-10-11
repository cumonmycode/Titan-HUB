// Синхронизация состояния кабинки: один запрос /tablet/state. Его просят события
// потока зоны (склеиваются за 150 мс), запасной таймер и возврат экрана на
// передний план. Параллельные просьбы не плодят запросы: пока идёт один,
// следующий выполнится сразу после него.
import { useVisit } from '@/features/visit/store';

import { api } from './api';
import { readCached, writeCached } from './cache';
import { useSession } from './session';
import type { TabletState } from './types';

/** Состояние из кэша показываем при запуске, только если оно свежее. */
const CACHE_MAX_AGE_MS = 15 * 60_000;

let inflight: Promise<void> | null = null;
let again = false;
let timer: ReturnType<typeof setTimeout> | null = null;

function cacheKey(): string | null {
  const { club, space } = useSession.getState();
  return club && space ? `state:${club.host}:${space.id}` : null;
}

async function fetchOnce() {
  const { token, space } = useSession.getState();
  if (!token || !space) return;
  const { phase } = useVisit.getState();
  const checkId = phase.kind === 'session' ? phase.checkId : null;
  try {
    const state = await api.get<TabletState>(`/tablet/state${checkId ? `?checkId=${checkId}` : ''}`);
    useVisit.getState().applyState(state);
    const key = cacheKey();
    if (key) writeCached(key, state);
  } catch {
    /* нет связи — экран показывает последнее состояние и значок «нет связи» */
  }
}

export function syncNow(): Promise<void> {
  if (inflight) {
    again = true;
    return inflight;
  }
  inflight = (async () => {
    do {
      again = false;
      await fetchOnce();
    } while (again);
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

export function requestSync(delayMs = 150) {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    void syncNow();
  }, delayMs);
}

export function hydrateStateFromCache() {
  const key = cacheKey();
  const cached = key ? readCached<TabletState>(key) : undefined;
  if (cached && Date.now() - cached.at < CACHE_MAX_AGE_MS) useVisit.getState().applyState(cached.value, true);
}
