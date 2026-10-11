import { create } from 'zustand';

import { api, ApiError } from '@/data/api';
import { clearCached } from '@/data/cache';
import { queryClient } from '@/data/query';
import { useSession } from '@/data/session';
import { clearSmartHomeCache } from '@/data/smart-home';
import type { SmartRoom } from '@/data/types';
import { useCart } from '@/features/menu/cart';
import { useVisit } from '@/features/visit/store';

/**
 * Панель сотрудника открывается PIN-ом и закрывается сама через 3 минуты без
 * действий (или при уходе на экран гостя). PIN проверяет сервер тем же
 * /auth/tablet-session — заодно планшет получает свежий токен и служебный токен
 * сотрудника (15 мин): им переносят планшет в другую кабинку и настраивают
 * устройства всех кабинок. Служебный токен живёт только в памяти.
 */
const UNLOCK_MS = 3 * 60_000;

type StaffState = {
  until: number;
  nickname: string | null;
  token: string | null;
  touch: () => void;
  lock: () => void;
  set: (nickname: string | null, token: string | null) => void;
};

export const useStaff = create<StaffState>()((set) => ({
  until: 0,
  nickname: null,
  token: null,
  set: (nickname, token) => set({ until: Date.now() + UNLOCK_MS, nickname, token }),
  touch: () => set((s) => (s.until > Date.now() ? { until: Date.now() + UNLOCK_MS } : s)),
  lock: () => set({ until: 0, nickname: null, token: null }),
}));

export const staffUnlocked = () => useStaff.getState().until > Date.now();

type TabletSession = { token: string; staffToken?: string; space: { id: string; name: string }; staff?: { nickname: string } };

/** Проверить PIN сотрудника для зоны; null — успех, иначе текст ошибки. */
export async function verifyStaffPin(spaceId: string, pin: string, host?: string): Promise<string | null> {
  try {
    const res = await api.post<TabletSession>('/auth/tablet-session', { spaceId, pin }, { auth: false, host });
    await useSession.getState().signIn(res.token, res.space, res.staff?.nickname ?? null);
    useStaff.getState().set(res.staff?.nickname ?? null, res.staffToken ?? null);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : 'Неверный PIN';
  }
}

/** Служебный токен сотрудника; истёк — панель закрывается, нужен PIN. */
function staffToken(): string {
  const token = useStaff.getState().token;
  if (!token || !staffUnlocked()) {
    useStaff.getState().lock();
    throw new ApiError(403, 'Подтвердите PIN сотрудника ещё раз');
  }
  return token;
}

function onStaffError(e: unknown): never {
  if (e instanceof ApiError && (e.status === 401 || e.status === 403)) useStaff.getState().lock();
  throw e;
}

export type Booth = { id: string; name: string; room: SmartRoom };

export async function fetchBooths(): Promise<Booth[]> {
  return api.get<{ booths: Booth[] }>('/pos/tablet/booths', { token: staffToken() }).then((r) => r.booths, onStaffError);
}

export async function saveBoothRoom(spaceId: string, room: SmartRoom): Promise<void> {
  await api.put('/pos/tablet/booths/' + spaceId + '/smart-home', room, { token: staffToken() }).catch(onStaffError);
}

/**
 * Перенести планшет в другую кабинку без повторной настройки: новый tablet-токен
 * зоны, визит гостя с нуля, умный дом — устройства новой кабинки (нативное
 * соединение с Home Assistant переключится, как только придут её устройства).
 */
export async function switchBooth(spaceId: string): Promise<void> {
  const res = await api
    .post<TabletSession>('/auth/tablet-switch', { spaceId }, { token: staffToken() })
    .catch(onStaffError);
  useVisit.getState().reset();
  useCart.getState().clear();
  await clearSmartHomeCache();
  await clearCached();
  queryClient.clear();
  await useSession.getState().signIn(res.token, res.space, res.staff?.nickname ?? null);
  useStaff.getState().set(res.staff?.nickname ?? useStaff.getState().nickname, res.staffToken ?? null);
}
