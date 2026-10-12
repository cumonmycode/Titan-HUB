import { fetch } from 'expo/fetch';
import { Platform } from 'react-native';

import { useQuery } from '@tanstack/react-query';

import { api, ApiError } from './api';
import { useClubKey } from './queries';
import { hostOrigin, useSession } from './session';

/**
 * Tai — ассистент кассы и аналитики. `POST /ai/assistant` отвечает потоком SSE:
 * текст модели кусками, статусы («Ищу «Саид»…»), интерактивные блоки с данными клуба
 * и карточки действий. Контракт — apps/api/src/modules/ai/tai/blocks.ts.
 * Модуль платный: без подписки сервер отвечает 403 `ai_subscription_required`.
 */

export type TaiRoute =
  | { screen: 'pos' }
  | { screen: 'check'; checkId: string }
  | { screen: 'pay'; checkId: string }
  | { screen: 'shift' }
  | { screen: 'analytics'; from: string; to: string }
  | { screen: 'analytics-checks'; from: string; to: string; hour?: number; method?: string }
  | { screen: 'analytics-check'; checkId: string }
  | { screen: 'analytics-products'; from: string; to: string }
  | { screen: 'analytics-players'; from: string; to: string }
  | { screen: 'player'; playerId: string }
  | { screen: 'inventory' }
  | { screen: 'events' }
  | { screen: 'supply'; supplyId: string; draft?: boolean };

export type TaiLink = { label: string; to: TaiRoute };
export type TaiMetric = { label: string; value: string; delta?: number; invert?: boolean; hint?: string };
export type TaiRow = { id: string; title: string; subtitle?: string; value?: string; avatar?: { name: string; url?: string | null }; to?: TaiRoute };
export type TaiPoint = { key: string; label: string; value: number; detail?: string; to?: TaiRoute; toLabel?: string };
export type TaiPart = { key: string; label: string; value: number; share: number; color?: string; to?: TaiRoute };

export type TaiActionCard = {
  id: string;
  kind: 'open_check' | 'add_items' | 'change_item' | 'discount' | 'cancel_check' | 'send_poll';
  title: string;
  rows: { label: string; value: string }[];
  total?: string;
  confirmLabel: string;
  destructive?: boolean;
  status: 'pending' | 'done' | 'failed' | 'cancelled';
  result?: string;
  to?: TaiRoute;
};

/** Строка поставки, собранной Tai со слов (количество — в базовой единице склада). */
export type TaiSupplyLine = {
  index: number;
  itemId: string | null;
  name: string;
  said?: string;
  quantity: number;
  unit: string;
  packs?: number;
  packName?: string | null;
  packSize?: number | null;
  costPerUnit: number;
  sum: number;
  uncertain?: boolean;
  alternatives?: { itemId: string; name: string }[];
};

export type TaiSupplyCard = {
  id: string;
  status: 'draft' | 'posted' | 'cancelled';
  supplier?: string | null;
  fromRegister: boolean;
  lines: TaiSupplyLine[];
  total: number;
  result?: string;
};

export type TaiSupplyOp =
  | { op: 'quantity'; line: number; quantity: number }
  | { op: 'step'; line: number; direction: 1 | -1 }
  | { op: 'price'; line: number; costPerUnit: number }
  | { op: 'remove'; line: number }
  | { op: 'match'; line: number; itemId: string }
  | { op: 'payment'; fromRegister: boolean };

export const editTaiSupply = (id: string, ops: TaiSupplyOp[]) =>
  api.post<{ supply: TaiSupplyCard }>(`/ai/assistant/supply/${id}/edit`, { ops }).then((r) => r.supply);
export const acceptTaiSupply = (id: string) => api.post<{ supply: TaiSupplyCard }>(`/ai/assistant/supply/${id}/accept`).then((r) => r.supply);
export const cancelTaiSupply = (id: string) => api.post<{ supply: TaiSupplyCard | null }>(`/ai/assistant/supply/${id}/cancel`).then((r) => r.supply);

export type TaiBlock =
  | { type: 'metrics'; title?: string; items: TaiMetric[]; link?: TaiLink }
  | { type: 'chart'; title: string; unit: 'money' | 'count'; points: TaiPoint[]; caption?: string }
  | { type: 'breakdown'; title: string; parts: TaiPart[]; total: string }
  | { type: 'list'; title: string; rows: TaiRow[]; more?: TaiLink; empty?: string }
  | { type: 'action'; action: TaiActionCard }
  | { type: 'choice'; question: string; options: { label: string; subtitle?: string; reply: string }[] }
  | { type: 'links'; links: TaiLink[] }
  | { type: 'supply'; supply: TaiSupplyCard };

export type TaiEvent =
  | { type: 'status'; text: string }
  | { type: 'delta'; text: string }
  | { type: 'block'; block: TaiBlock }
  | { type: 'suggestions'; items: string[] }
  /** Голосовой режим: озвученная фраза ответа (base64), по порядку seq. */
  | { type: 'audio'; seq: number; format: 'mp3' | 'wav'; data: string; upTo: number }
  /** Начат новый чат истории (запрос с chatId: 'new'). */
  | { type: 'chat'; chat: { id: string; title: string } }
  | { type: 'done'; memo: string }
  | { type: 'error'; message: string };

export type TaiContext = {
  screen?: 'pos' | 'check' | 'analytics' | 'other';
  checkId?: string;
  period?: { from: string; to: string };
};

export type TaiTurn = { role: 'user' | 'assistant'; content: string; memo?: string };

/**
 * Задать вопрос и получать события по мере ответа. Повторов нет: каждый запрос —
 * новый ход модели. Ошибка до начала потока бросается как ApiError (403 — нет подписки).
 */
export async function streamTai(
  body: { messages: TaiTurn[]; context?: TaiContext; voice?: boolean; chatId?: string; display?: string },
  onEvent: (event: TaiEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const { club, token } = useSession.getState();
  if (!club?.host || !token) throw new ApiError(401, 'Нет входа');
  let res: Awaited<ReturnType<typeof fetch>>;
  try {
    res = await fetch(`${hostOrigin(club.host)}/api/ai/assistant`, {
      method: 'POST',
      headers: {
        Accept: 'text/event-stream',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'X-App-Platform': Platform.OS,
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (signal.aborted) return;
    throw new ApiError(0, 'Нет соединения с сервером', error);
  }
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => null);
    const code = (data as { error?: string } | null)?.error;
    throw new ApiError(
      res.status,
      code === 'ai_subscription_required' ? 'Tai не подключён для этого клуба.' : typeof code === 'string' ? code : `Ошибка ${res.status}`,
      data,
    );
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf('\n\n');
    while (boundary >= 0) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf('\n\n');
      const data = frame
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n');
      if (!data) continue;
      try {
        onEvent(JSON.parse(data) as TaiEvent);
      } catch {
        // Неполный или чужой кадр — пропускаем, поток продолжается.
      }
    }
  }
}

/* ─────────────────────────── История чатов ─────────────────────────── */

export type TaiChatSummary = { id: string; title: string; updatedAt: string };
export type TaiChatTurn = { id: number; role: 'user' | 'assistant'; content: string; blocks: TaiBlock[]; memo: string | null; createdAt: string };

/** Чаты сотрудника, свежие сверху; q — поиск по заголовку и тексту. */
export function useTaiChats(q: string, enabled = true) {
  const club = useClubKey();
  const query = q.trim();
  return useQuery({
    queryKey: [club, 'ai', 'chats', query],
    queryFn: ({ signal }) => api.get<{ chats: TaiChatSummary[] }>(`/ai/chats${query ? `?q=${encodeURIComponent(query)}` : ''}`, { signal }).then((r) => r.chats),
    enabled,
    staleTime: 15_000,
  });
}

export const getTaiChat = (id: string) => api.get<{ chat: TaiChatSummary; turns: TaiChatTurn[] }>(`/ai/chats/${id}`);
export const renameTaiChat = (id: string, title: string) => api.patch<{ chat: TaiChatSummary }>(`/ai/chats/${id}`, { title }).then((r) => r.chat);
export const deleteTaiChat = (id: string) => api.delete(`/ai/chats/${id}`);

/** Нажатие кнопки карточки: сервер выполняет действие от имени сотрудника. */
export async function confirmTaiAction(id: string): Promise<TaiActionCard> {
  const { action } = await api.post<{ action: TaiActionCard }>(`/ai/assistant/actions/${id}`);
  return action;
}

/** Озвучить короткую фразу голосом Tai (итог карточки после голосового «да»). */
export async function speakTai(text: string, voice?: { voice?: string; speed?: number }): Promise<{ format: 'mp3' | 'wav'; data: string } | null> {
  return api.post<{ format: 'mp3' | 'wav'; data: string }>('/ai/assistant/speech', { text, ...voice }).catch(() => null);
}

/* ─────────────────────────── Настройки ─────────────────────────── */

export type TaiSettings = { voice: string; speed: number; profanity: boolean; outreach: boolean };
export type TaiVoiceOption = { id: string; label: string; hint: string; tunable: boolean };
export type TaiSettingsResponse = { settings: TaiSettings; clubBrief: string; voices: TaiVoiceOption[]; speeds: { value: number; label: string }[] };

export const getTaiSettings = () => api.get<TaiSettingsResponse>('/ai/settings');
export const saveTaiSettings = (patch: Partial<TaiSettings>) => api.put<{ settings: TaiSettings }>('/ai/settings', patch).then((r) => r.settings);
/** Что Tai рассказывает клиентам в Telegram о форматах клуба. */
export const saveTaiClubBrief = (clubBrief: string) => api.put<{ clubBrief: string }>('/ai/settings', { clubBrief }).then((r) => r.clubBrief);

/* ───────────────────── Tai в групповых чатах Telegram ───────────────────── */

export type TaiChatMode = 'game' | 'work';
export type TaiHarshness = 'soft' | 'medium' | 'savage';
export type TaiChatPreset = { key: string; label: string; desc: string };
export type TaiChat = { id: number | string; title: string; type: string; mode: TaiChatMode; enabled: boolean; profanity: boolean; harshness: TaiHarshness; preset: string };
export type TaiChatConfig = { enabled: boolean; presets: TaiChatPreset[]; chats: TaiChat[]; botReady: boolean; aiReady: boolean };

export const getTaiChatConfig = () => api.get<TaiChatConfig>('/system/tai-chat-config');
export const saveTaiChatConfig = (patch: { enabled?: boolean; chats?: TaiChat[] }) => api.put('/system/tai-chat-config', patch);

export async function dismissTaiAction(id: string): Promise<void> {
  await api.post(`/ai/assistant/actions/${id}/dismiss`).catch(() => undefined);
}

/** 403 ai_subscription_required — клуб без подписки на Tai. */
export const isTaiLocked = (error: unknown) =>
  error instanceof ApiError && error.status === 403 && (error.data as { error?: string } | null)?.error === 'ai_subscription_required';

export function taiErrorText(error: unknown): string {
  if (error instanceof ApiError && error.status === 502) return 'Модель не ответила. Попробуйте ещё раз.';
  return error instanceof Error ? error.message : String(error);
}
