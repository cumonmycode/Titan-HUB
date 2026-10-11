import { create } from 'zustand';

import { haptic } from './haptics';
import { queryClient } from './query';
import { useSession } from './session';
import {
  confirmTaiAction,
  dismissTaiAction,
  isTaiLocked,
  streamTai,
  taiErrorText,
  type TaiActionCard,
  type TaiBlock,
  type TaiContext,
  type TaiTurn,
} from './tai-api';

/**
 * Диалог с Tai на время работы приложения: шторка закрылась и открылась — разговор
 * продолжается («а за вчера?»), «Новый диалог» начинает заново. История уходит на
 * сервер с каждым вопросом — на сервере её нет.
 */

export type TaiUserMessage = { id: string; role: 'user'; text: string };
export type TaiReply = {
  id: string;
  role: 'tai';
  text: string;
  blocks: TaiBlock[];
  status: string | null;
  suggestions: string[];
  memo?: string;
  error?: string;
  streaming: boolean;
  voice: boolean;
};
export type TaiMessage = TaiUserMessage | TaiReply;

type TaiState = {
  messages: TaiMessage[];
  busy: boolean;
  locked: boolean;
  context: TaiContext;
  setContext: (context: TaiContext) => void;
  /** text — что уйдёт модели; display — что показать в пузыре (ответ кнопкой выбора). */
  send: (text: string, options?: { display?: string; voice?: boolean }) => Promise<void>;
  stop: () => void;
  reset: () => void;
  confirm: (actionId: string) => Promise<TaiActionCard | null>;
  dismiss: (actionId: string) => void;
};

let controller: AbortController | null = null;
let counter = 0;
const nextId = () => `${Date.now().toString(36)}-${(counter += 1)}`;

/** Короткие голосовые «да/нет» на ожидающую карточку — без лишнего хода модели. */
const YES = /^(да|давай|ага|угу|подтверждаю|подтверди|открывай|открой|добавляй|добавь|применяй|применяй|ок|окей|верно|точно|выполняй|делай)[\s.!,]*$/i;
const NO = /^(нет|не надо|отмена|отмени|стоп|не нужно)[\s.!,]*$/i;

function pendingAction(messages: TaiMessage[]): TaiActionCard | null {
  const last = [...messages].reverse().find((m): m is TaiReply => m.role === 'tai');
  const block = last?.blocks.find((b) => b.type === 'action' && b.action.status === 'pending');
  return block?.type === 'action' ? block.action : null;
}

function history(messages: TaiMessage[]): TaiTurn[] {
  return messages
    .filter((m) => m.role === 'user' || !m.error)
    .slice(-16)
    .map((m) =>
      m.role === 'user'
        ? { role: 'user', content: m.text }
        : { role: 'assistant', content: m.text.trim() || (m.blocks.length ? '(показал данные)' : '…'), memo: m.memo },
    );
}

function patchReply(id: string, patch: (reply: TaiReply) => Partial<TaiReply>) {
  useTaiStore.setState((state) => ({
    messages: state.messages.map((m) => (m.id === id && m.role === 'tai' ? { ...m, ...patch(m) } : m)),
  }));
}

function replaceAction(card: TaiActionCard) {
  useTaiStore.setState((state) => ({
    messages: state.messages.map((m) =>
      m.role === 'tai' && m.blocks.some((b) => b.type === 'action' && b.action.id === card.id)
        ? { ...m, blocks: m.blocks.map((b) => (b.type === 'action' && b.action.id === card.id ? { type: 'action', action: card } : b)) }
        : m,
    ),
  }));
}

/** Касса и аналитика после действия Tai — как после нажатия кнопки в самой кассе. */
function refreshAfter(card: TaiActionCard) {
  const host = useSession.getState().club?.host ?? 'none';
  for (const key of [
    ['pos', 'checks'],
    ['pos', 'shift-summary'],
    ['pos', 'prechecks'],
  ])
    void queryClient.invalidateQueries({ queryKey: [host, ...key] });
  if (card.to?.screen === 'check') void queryClient.invalidateQueries({ queryKey: [host, 'pos', 'check', card.to.checkId] });
}

export const useTaiStore = create<TaiState>((set, get) => ({
  messages: [],
  busy: false,
  locked: false,
  context: {},
  setContext: (context) => set({ context }),

  send: async (raw, options = {}) => {
    const text = raw.trim();
    if (!text || get().busy) return;

    // «Да» на ожидающую карточку — нажатие кнопки; «нет» — отказ.
    const pending = pendingAction(get().messages);
    if (pending && (YES.test(text) || NO.test(text))) {
      set((state) => ({ messages: [...state.messages, { id: nextId(), role: 'user', text: options.display ?? text }] }));
      if (YES.test(text)) await get().confirm(pending.id);
      else get().dismiss(pending.id);
      return;
    }

    haptic.light();
    const userMessage: TaiUserMessage = { id: nextId(), role: 'user', text: options.display ?? text };
    const reply: TaiReply = { id: nextId(), role: 'tai', text: '', blocks: [], status: 'Думаю…', suggestions: [], streaming: true, voice: !!options.voice };
    const turns = [...history(get().messages), { role: 'user' as const, content: text }];
    set((state) => ({ messages: [...state.messages, userMessage, reply], busy: true }));

    controller?.abort();
    const current = new AbortController();
    controller = current;
    try {
      await streamTai(
        { messages: turns, context: get().context, voice: options.voice },
        (event) => {
          switch (event.type) {
            case 'status':
              patchReply(reply.id, () => ({ status: event.text }));
              break;
            case 'delta':
              patchReply(reply.id, (m) => ({ text: m.text + event.text, status: null }));
              break;
            case 'block':
              patchReply(reply.id, (m) => ({ blocks: [...m.blocks, event.block], status: null }));
              break;
            case 'suggestions':
              patchReply(reply.id, () => ({ suggestions: event.items }));
              break;
            case 'done':
              patchReply(reply.id, () => ({ memo: event.memo }));
              break;
            case 'error':
              patchReply(reply.id, () => ({ error: event.message }));
              break;
          }
        },
        current.signal,
      );
      haptic.success();
    } catch (error) {
      if (current.signal.aborted) return;
      haptic.error();
      if (isTaiLocked(error)) set({ locked: true });
      patchReply(reply.id, () => ({ error: taiErrorText(error) }));
    } finally {
      patchReply(reply.id, (m) => ({ streaming: false, status: null, text: m.text.trim() }));
      if (controller === current) controller = null;
      set({ busy: false });
    }
  },

  stop: () => {
    controller?.abort();
    controller = null;
    set((state) => ({
      busy: false,
      messages: state.messages.map((m) => (m.role === 'tai' && m.streaming ? { ...m, streaming: false, status: null } : m)),
    }));
  },

  reset: () => {
    get().stop();
    set({ messages: [] });
  },

  confirm: async (actionId) => {
    try {
      const card = await confirmTaiAction(actionId);
      replaceAction(card);
      if (card.status === 'done') {
        haptic.success();
        refreshAfter(card);
      } else haptic.error();
      return card;
    } catch (error) {
      haptic.error();
      const message = taiErrorText(error);
      useTaiStore.setState((state) => ({
        messages: state.messages.map((m) =>
          m.role === 'tai'
            ? {
                ...m,
                blocks: m.blocks.map((b) =>
                  b.type === 'action' && b.action.id === actionId ? { type: 'action', action: { ...b.action, status: 'failed', result: message } } : b,
                ),
              }
            : m,
        ),
      }));
      return null;
    }
  },

  dismiss: (actionId) => {
    haptic.light();
    useTaiStore.setState((state) => ({
      messages: state.messages.map((m) =>
        m.role === 'tai'
          ? {
              ...m,
              blocks: m.blocks.map((b) =>
                b.type === 'action' && b.action.id === actionId ? { type: 'action', action: { ...b.action, status: 'cancelled' } } : b,
              ),
            }
          : m,
      ),
    }));
    void dismissTaiAction(actionId);
  },
}));
