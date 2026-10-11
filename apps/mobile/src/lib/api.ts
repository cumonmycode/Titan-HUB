import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { hostOrigin, useSession } from './session';

/**
 * Клиент API Titan HUB.
 *
 * Клуб выбирается хостом: `https://<slug>.titanpos.ru/api/...`. Токен — Bearer.
 * Ответы об ошибках приходят как `{ error: string }` или как ошибка zod
 * `{ success: false, error: { issues } }`; nginx может отдать HTML или текст.
 */

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public data?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Хост клуба; по умолчанию — выбранный. Нужен, чтобы проверить клуб до выбора. */
  host?: string;
  /** `false` — запрос без токена (вход). 401 такого запроса не разлогинивает. */
  auth?: boolean;
  signal?: AbortSignal;
};

const APP_VERSION = Constants.expoConfig?.version ?? '0.0.0';

/** Название модуля клуба для текста «модуль выключен». */
const MODULE_NAMES: Record<string, string> = {
  analytics: 'Аналитика',
  events: 'Мероприятия',
  certificates: 'Сертификаты',
  discounts: 'Скидки и бонусы',
  ai: 'Tai',
  platega: 'Приём оплат',
};

/** Коды, которые сервер отдаёт вместо текста, — переводим, иначе латиница уходит в Alert. */
function codeMessage(body: unknown): string | null {
  const code = body && typeof body === 'object' ? (body as { error?: unknown }).error : null;
  if (typeof code !== 'string') return null;
  if (code === 'module_disabled') {
    const key = (body as { module?: unknown }).module;
    const name = typeof key === 'string' ? (MODULE_NAMES[key] ?? key) : null;
    return name ? `Модуль «${name}» выключен для клуба.` : 'Модуль выключен для клуба.';
  }
  if (code === 'ai_subscription_required') return 'Tai не подключён для этого клуба.';
  if (code === 'subscription_required' || code === 'subscription_expired') return 'Подписка клуба закончилась.';
  return null;
}

function errorMessage(status: number, body: unknown): string {
  const code = codeMessage(body);
  if (code) return code;
  // API отвечает «Payload Too Large», nginx — HTML: в Alert ни то, ни другое.
  if (status === 413) return 'Файл слишком большой';
  if (body && typeof body === 'object') {
    const b = body as { error?: unknown; message?: unknown };
    if (typeof b.error === 'string') return b.error;
    if (b.error && typeof b.error === 'object') {
      const e = b.error as { issues?: { message?: string }[]; message?: string };
      if (e.issues?.[0]?.message) return e.issues[0].message;
      if (e.message) return e.message;
    }
    if (typeof b.message === 'string') return b.message;
  }
  if (status === 402) return 'Подписка клуба закончилась';
  if (status === 429) return 'Слишком много попыток, подождите немного';
  if (status >= 500) return 'Сервер не отвечает, попробуйте позже';
  return `Ошибка ${status}`;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const session = useSession.getState();
  const host = options.host ?? session.club?.host;
  if (!host) throw new ApiError(0, 'Клуб не выбран');

  const useAuth = options.auth !== false;
  // Токен, с которым ушёл запрос: поздний 401 по старому токену не должен выкинуть
  // сотрудника, который уже вошёл заново.
  const sentToken = useAuth ? session.token : null;
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-App-Platform': Platform.OS,
    'X-App-Version': APP_VERSION,
  };
  // FormData (загрузка фото) сериализует и размечает сам fetch — свой Content-Type сломал бы boundary.
  const isForm = options.body instanceof FormData;
  if (options.body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
  if (sentToken) headers.Authorization = `Bearer ${sentToken}`;

  let res: Response;
  try {
    res = await fetch(`${hostOrigin(host)}/api${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : isForm ? (options.body as FormData) : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch {
    throw new ApiError(0, 'Нет соединения с сервером');
  }

  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      // HTML-страницу ошибки nginx (502/503) не показываем человеку — сработает текст по статусу.
      const html = text.trimStart().startsWith('<');
      body = { error: res.ok || html ? undefined : text.slice(0, 200) };
    }
  }

  if (!res.ok) {
    if (res.status === 401 && sentToken && useSession.getState().token === sentToken) {
      // Токен истёк или отозван — возвращаемся ко входу в тот же клуб.
      void useSession.getState().signOut();
    }
    throw new ApiError(res.status, errorMessage(res.status, body), body);
  }
  return body as T;
}

export const api = {
  get: <T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'PUT', body }),
  delete: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'DELETE', body }),
};
