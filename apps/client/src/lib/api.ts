// HTTP-клиент приложения. Сервер — основной клуб Titan (titanpos.ru), бот входа
// Tai (@tigran_ai_bot). В демо-режиме запросы обслуживает lib/demo.ts без сети.
import Constants from 'expo-constants';

import { demoRequest } from './demo';
import { useSession } from './session';

export const API_URL: string =
  (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl ?? 'https://titanpos.ru';

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
  /** false — запрос без токена (вход); 401 тогда не разлогинивает. */
  auth?: boolean;
  timeoutMs?: number;
}

function messageFor(status: number, data: unknown): string {
  const err = (data as { error?: unknown } | null)?.error;
  if (typeof err === 'string' && /[а-яё]/i.test(err)) return err;
  if (status === 429) return 'Слишком много попыток. Подождите немного.';
  if (status === 403) return 'Недостаточно прав';
  if (status === 404) return 'Не найдено';
  if (status >= 500) return 'Сервер временно недоступен. Попробуйте позже.';
  return 'Что-то пошло не так';
}

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const method = opts.method ?? 'GET';
  if (useSession.getState().status === 'demo') return demoRequest<T>(method, path, opts.body);

  const auth = opts.auth !== false;
  const token = useSession.getState().token;
  const isForm = typeof FormData !== 'undefined' && opts.body instanceof FormData;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
  if (auth && token) headers.Authorization = `Bearer ${token}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20_000);
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api${path}`, {
      method,
      headers,
      body: opts.body === undefined ? undefined : isForm ? (opts.body as FormData) : JSON.stringify(opts.body),
      signal: controller.signal,
    });
  } catch {
    throw new ApiError(0, 'Нет соединения. Проверьте интернет.');
  } finally {
    clearTimeout(timer);
  }

  const data = await res.json().catch(() => null);
  if (res.status === 401 && auth) {
    // Токен истёк или отозван — возвращаемся на экран входа.
    await useSession.getState().signOut();
    throw new ApiError(401, 'Сессия истекла — войдите снова', data);
  }
  if (!res.ok) throw new ApiError(res.status, messageFor(res.status, data), data);
  return data as T;
}

export const api = {
  get: <T>(path: string, opts?: Omit<RequestOptions, 'method' | 'body'>) => request<T>(path, { ...opts, method: 'GET' }),
  post: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...opts, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  delete: <T>(path: string, body?: unknown) => request<T>(path, { method: 'DELETE', body }),
};

export function errorText(e: unknown): string {
  return e instanceof Error && e.message ? e.message : 'Что-то пошло не так';
}
