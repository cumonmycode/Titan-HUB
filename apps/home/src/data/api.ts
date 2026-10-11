// HTTP-клиент киоска: https://<клуб>/api/..., Bearer tablet-токен зоны.
import { create } from 'zustand';

import { hostOrigin, useSession } from './session';

export class ApiError extends Error {
  status: number;
  data: unknown;
  constructor(status: number, message: string, data?: unknown) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

interface RequestOptions {
  method?: Method;
  body?: unknown;
  /** false — запрос без токена (настройка); 401 тогда не сбрасывает сессию. */
  auth?: boolean;
  /** Хост клуба, если он ещё не сохранён (шаг выбора клуба). */
  host?: string;
  /** Служебный токен сотрудника вместо tablet-токена (кабинки, перенос планшета). */
  token?: string;
  timeoutMs?: number;
  /** Доп. заголовки (If-None-Match для меню). 304 возвращает null. */
  headers?: Record<string, string>;
}

/** Связь с сервером клуба: значок «нет связи» на экране гостя. */
export const useNetwork = create<{ online: boolean; set: (online: boolean) => void }>()((set, get) => ({
  online: true,
  set: (online) => {
    if (get().online !== online) set({ online });
  },
}));

function messageFor(status: number, data: unknown): string {
  const err = (data as { error?: unknown } | null)?.error;
  if (typeof err === 'string' && /[а-яё]/i.test(err)) return err;
  if (status === 429) return 'Слишком много попыток. Подождите немного.';
  if (status === 403) return 'Недостаточно прав';
  if (status === 404) return 'Не найдено';
  if (status >= 500) return 'Сервер клуба временно недоступен';
  return 'Что-то пошло не так';
}

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const session = useSession.getState();
  const host = opts.host ?? session.club?.host;
  if (!host) throw new ApiError(0, 'Клуб не выбран');
  const auth = opts.auth !== false;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  const bearer = opts.token ?? session.token;
  if (auth && bearer) headers.Authorization = `Bearer ${bearer}`;
  Object.assign(headers, opts.headers);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15_000);
  let res: Response;
  try {
    res = await fetch(`${hostOrigin(host)}/api${path}`, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: controller.signal,
    });
  } catch {
    useNetwork.getState().set(false);
    throw new ApiError(0, 'Нет связи с сервером клуба');
  } finally {
    clearTimeout(timer);
  }
  useNetwork.getState().set(true);
  if (res.status === 304) return null as T;

  const data = await res.json().catch(() => null);
  if ((res.status === 401 || res.status === 403) && opts.token) {
    // Истёк служебный токен сотрудника — планшет не трогаем, просим PIN заново.
    throw new ApiError(res.status, 'Подтвердите PIN сотрудника ещё раз', data);
  }
  if (res.status === 401 && auth && session.token) {
    // Токен истёк, отозван или зону выключили — планшет просит PIN сотрудника.
    await useSession.getState().signOut();
    throw new ApiError(401, 'Планшет нужно подтвердить заново', data);
  }
  if (!res.ok) throw new ApiError(res.status, messageFor(res.status, data), data);
  return data as T;
}

export const api = {
  get: <T>(path: string, opts?: Omit<RequestOptions, 'method' | 'body'>) => request<T>(path, { ...opts, method: 'GET' }),
  post: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...opts, method: 'POST', body }),
  put: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...opts, method: 'PUT', body }),
};

export function errorText(e: unknown): string {
  return e instanceof Error && e.message ? e.message : 'Что-то пошло не так';
}
