import { useQuery } from '@tanstack/react-query';
import { create } from 'zustand';

import { api } from './api';
import { queryClient } from './query';
import { useClubKey } from './queries';
import { useSession } from './session';

/**
 * Titan Connect: свои подключения сторонних сервисов к данным клиентов клуба.
 * Владелец создаёт подключение и получает одноразовый код; сервис меняет его на
 * постоянный ключ — дальше подключение живёт, пока его не отключат.
 */

export type ConnectScopeInfo = { key: string; title: string; description: string; required: boolean };

export type ConnectConnection = {
  id: string;
  name: string;
  scopes: string[];
  status: 'pending' | 'active';
  serviceName: string | null;
  serviceUrl: string | null;
  tokenPrefix: string | null;
  codeExpiresAt: string | null;
  createdAt: string;
  connectedAt: string | null;
  lastUsedAt: string | null;
  lastIp: string | null;
  requestCount: number;
};

export type ConnectOverview = { apiBase: string; scopes: ConnectScopeInfo[]; items: ConnectConnection[] };
export type IssuedCode = { code: string; expiresAt: string };

const CODE_POLL_MS = 3000;

/** Пока у какого-то подключения живой код — опрашиваем, чтобы увидеть момент подключения сервиса. */
export function useConnect(enabled = true) {
  const club = useClubKey();
  return useQuery({
    queryKey: [club, 'connect'],
    queryFn: () => api.get<ConnectOverview>('/connect/manage'),
    enabled,
    staleTime: 30_000,
    refetchInterval: (query) => (query.state.data?.items.some((c) => c.codeExpiresAt) ? CODE_POLL_MS : false),
  });
}

function refresh() {
  const host = useSession.getState().club?.host ?? 'none';
  void queryClient.invalidateQueries({ queryKey: [host, 'connect'] });
}

async function withRefresh<T>(request: Promise<T>): Promise<T> {
  try {
    return await request;
  } finally {
    refresh();
  }
}

/**
 * Сам код сервер отдаёт только в момент выдачи (в БД — лишь хэш). Помним выданные коды
 * до конца сессии приложения, чтобы карточка подключения могла показать живой код.
 */
type IssuedCodes = { codes: Record<string, IssuedCode>; remember: (id: string, code: IssuedCode) => void; forget: (id: string) => void };

export const useIssuedCodes = create<IssuedCodes>((set) => ({
  codes: {},
  remember: (id, code) => set((s) => ({ codes: { ...s.codes, [id]: code } })),
  forget: (id) => set((s) => ({ codes: Object.fromEntries(Object.entries(s.codes).filter(([key]) => key !== id)) })),
}));

export async function createConnection(name: string, scopes: string[]) {
  const result = await withRefresh(api.post<IssuedCode & { connection: ConnectConnection }>('/connect/manage/connections', { name, scopes }));
  useIssuedCodes.getState().remember(result.connection.id, { code: result.code, expiresAt: result.expiresAt });
  return result;
}

export const updateConnection = (id: string, patch: { name?: string; scopes?: string[] }) =>
  withRefresh(api.patch<{ connection: ConnectConnection }>(`/connect/manage/connections/${id}`, patch));

export async function issueCode(id: string): Promise<IssuedCode> {
  const code = await withRefresh(api.post<IssuedCode>(`/connect/manage/connections/${id}/code`));
  useIssuedCodes.getState().remember(id, code);
  return code;
}

export async function cancelCode(id: string): Promise<void> {
  await withRefresh(api.delete(`/connect/manage/connections/${id}/code`));
  useIssuedCodes.getState().forget(id);
}

export const removeConnection = (id: string) => withRefresh(api.delete(`/connect/manage/connections/${id}`));

const TIME = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' });
const DATE = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

export const codeUntil = (iso: string) => `Действует до ${TIME.format(new Date(iso))}`;

/** «только что», «12 мин назад», «вчера в 21:40», «3 ноября, 18:05». */
export function relativeTime(iso: string | null): string {
  if (!iso) return 'ещё не было';
  const date = new Date(iso);
  const minutes = Math.round((Date.now() - date.getTime()) / 60_000);
  if (minutes < 1) return 'только что';
  if (minutes < 60) return `${minutes} мин назад`;
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === new Date().toDateString()) return `сегодня в ${TIME.format(date)}`;
  if (date.toDateString() === yesterday.toDateString()) return `вчера в ${TIME.format(date)}`;
  return DATE.format(date);
}

/** Строка подключения в списке: кто подключён и когда был в последний раз. */
export function connectionSummary(c: ConnectConnection): string {
  if (c.status === 'pending') return c.codeExpiresAt ? 'Ждёт ввода кода' : 'Не подключено — нужен новый код';
  const who = c.serviceName ? `${c.serviceName} · ` : '';
  return `${who}запрос ${relativeTime(c.lastUsedAt)}`;
}

/** Короткая памятка разработчику стороннего сервиса — уходит через «Поделиться». */
export const developerGuide = (apiBase: string) =>
  [
    'Titan Connect — API клиентов клуба',
    '',
    `1. Подключение: POST ${apiBase}/exchange`,
    '   {"code": "K7QM-3XPA", "service": {"name": "Ваш сервис"}}',
    '   → accessToken (бессрочный, сохраните у себя) и apiBase.',
    '2. Запросы: заголовок Authorization: Bearer <accessToken>.',
    `   GET ${apiBase}/clients?search=ник — клиенты (по 50, nextCursor — следующая страница).`,
    `   GET ${apiBase}/clients/<id> — один клиент.`,
    '3. Синхронизация: сохраните syncCursor из ответа и в следующий раз',
    '   передайте ?cursor=… — придут только изменённые и удалённые (deleted: true).',
    `4. GET ${apiBase}/me — права подключения; POST ${apiBase}/token/rotate — сменить ключ.`,
    '',
    'Ответ 401 invalid_token — подключение отключили в Titan HUB, нужен новый код.',
  ].join('\n');

/** Текст для «Поделиться»: код и куда его ввести. */
export const shareText = (name: string, code: string, apiBase: string) =>
  `Код подключения к Titan HUB для «${name}»: ${code}\nДействует 10 минут, вводится один раз.\nAPI: ${apiBase}/exchange`;
