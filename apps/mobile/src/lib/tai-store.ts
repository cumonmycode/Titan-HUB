import { create } from 'zustand';

import { haptic } from './haptics';
import { queryClient } from './query';
import { useSession } from './session';
import {
  confirmTaiAction,
  dismissTaiAction,
  getTaiChat,
  isTaiLocked,
  streamTai,
  taiErrorText,
  type TaiActionCard,
  type TaiBlock,
  type TaiChatTurn,
  type TaiContext,
  type TaiEvent,
  type TaiTurn,
} from './tai-api';

/**
 * Текущий чат с Tai. Чаты хранит сервер (у каждого сотрудника свои, общие для его
 * устройств): первый вопрос начинает новый чат, дальше реплики дописываются в него.
 * Экран закрылся и открылся — разговор продолжается; из истории можно открыть старый.
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
  /** Голосовой режим: сколько текста и блоков уже озвучено — показываем вместе со звуком. null — всё. */
  gate: { chars: number; blocks: number } | null;
  /**
   * Когда пришли последние куски текста (с какого символа и во сколько): свежие слова
   * проступают цветом и «остывают» до обычного. Старые куски отбрасываются.
   */
  reveal?: { at: number; t: number }[];
};

/** Сколько слово «остывает» после появления, мс. */
export const REVEAL_MS = 650;
export type TaiMessage = TaiUserMessage | TaiReply;

type TaiState = {
  /** Чат на сервере; null — новый, создастся с первым вопросом. */
  chatId: string | null;
  title: string | null;
  /** Открывается чат из истории. */
  opening: boolean;
  messages: TaiMessage[];
  busy: boolean;
  locked: boolean;
  context: TaiContext;
  setContext: (context: TaiContext) => void;
  /** text — что уйдёт модели; display — что показать в пузыре (ответ кнопкой выбора). */
  send: (text: string, options?: { display?: string; voice?: boolean }) => Promise<void>;
  stop: () => void;
  reset: () => void;
  /** Открыть чат из истории. */
  openChat: (id: string) => Promise<void>;
  /** Ответ не пришёл (ошибка) — задать тот же вопрос ещё раз. */
  retry: (replyId: string) => void;
  confirm: (actionId: string) => Promise<TaiActionCard | null>;
  dismiss: (actionId: string) => void;
};

let controller: AbortController | null = null;

/** Звук ответа уходит в голосовой режим (useTaiVoice), а не в состояние диалога. */
export type TaiAudioClip = Extract<TaiEvent, { type: 'audio' }> & { replyId: string; blocks: number };
let audioListener: ((clip: TaiAudioClip) => void) | null = null;
export function setTaiAudioListener(listener: ((clip: TaiAudioClip) => void) | null) {
  audioListener = listener;
}

/** Звук фразы начал играть — показать текст до неё и блоки перед ней. */
export function revealTai(replyId: string, chars: number, blocks: number) {
  patchReply(replyId, (m) => (m.gate ? { gate: { chars: Math.max(m.gate.chars, chars), blocks: Math.max(m.gate.blocks, blocks) } } : {}));
}

/** Голос договорил или режим выключен — показать ответ целиком. */
export function ungateTai() {
  useTaiStore.setState((state) => ({ messages: state.messages.map((m) => (m.role === 'tai' && m.gate ? { ...m, gate: null } : m)) }));
}
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

/** Список чатов в истории: новый чат, свежий ответ или имя от Tai. */
export function refreshTaiChats() {
  const host = useSession.getState().club?.host ?? 'none';
  void queryClient.invalidateQueries({ queryKey: [host, 'ai', 'chats'] });
}

/** Реплики сохранённого чата → сообщения экрана. */
function fromTurns(turns: TaiChatTurn[]): TaiMessage[] {
  return turns.map((t) =>
    t.role === 'user'
      ? { id: `h${t.id}`, role: 'user', text: t.content }
      : { id: `h${t.id}`, role: 'tai', text: t.content, blocks: t.blocks, status: null, suggestions: [], memo: t.memo ?? undefined, streaming: false, voice: false, gate: null },
  );
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
  chatId: null,
  title: null,
  opening: false,
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
    const reply: TaiReply = {
      id: nextId(),
      role: 'tai',
      text: '',
      blocks: [],
      status: 'Думаю…',
      suggestions: [],
      streaming: true,
      voice: !!options.voice,
      // Голосом — текст и блоки появляются вместе со звуком, а не раньше него.
      gate: options.voice && audioListener ? { chars: 0, blocks: 0 } : null,
    };
    let heardAudio = false;
    const turns = [...history(get().messages), { role: 'user' as const, content: text }];
    set((state) => ({ messages: [...state.messages, userMessage, reply], busy: true }));

    controller?.abort();
    const current = new AbortController();
    controller = current;
    try {
      await streamTai(
        {
          messages: turns,
          context: get().context,
          voice: options.voice,
          chatId: get().chatId ?? 'new',
          display: options.display && options.display !== text ? options.display : undefined,
        },
        (event) => {
          switch (event.type) {
            case 'status':
              patchReply(reply.id, () => ({ status: event.text }));
              break;
            case 'delta':
              patchReply(reply.id, (m) => {
                const t = Date.now();
                const fresh = (m.reveal ?? []).filter((chunk) => t - chunk.t < REVEAL_MS);
                return { text: m.text + event.text, status: null, reveal: [...fresh, { at: m.text.length, t }] };
              });
              break;
            case 'block':
              patchReply(reply.id, (m) => ({ blocks: [...m.blocks, event.block], status: null }));
              break;
            case 'suggestions':
              patchReply(reply.id, () => ({ suggestions: event.items }));
              break;
            case 'chat':
              set({ chatId: event.chat.id, title: event.chat.title });
              refreshTaiChats();
              break;
            case 'done':
              patchReply(reply.id, () => ({ memo: event.memo }));
              break;
            case 'error':
              patchReply(reply.id, () => ({ error: event.message }));
              break;
            case 'audio': {
              heardAudio = true;
              const blocks = (useTaiStore.getState().messages.find((m) => m.id === reply.id) as TaiReply | undefined)?.blocks.length ?? 0;
              audioListener?.({ ...event, replyId: reply.id, blocks });
              break;
            }
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
      // Звука не пришло (синтез не удался) — показываем ответ сразу, без субтитров.
      patchReply(reply.id, (m) => ({ streaming: false, status: null, text: m.text.trimEnd(), ...(heardAudio ? {} : { gate: null }) }));
      if (controller === current) controller = null;
      set({ busy: false });
      refreshTaiChats();
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
    set({ messages: [], chatId: null, title: null });
  },

  retry: (replyId) => {
    const messages = get().messages;
    const index = messages.findIndex((m) => m.id === replyId);
    const question = messages[index - 1];
    if (index < 1 || question?.role !== 'user' || get().busy) return;
    set({ messages: messages.slice(0, index - 1) });
    void get().send(question.text);
  },

  openChat: async (id) => {
    if (id === get().chatId) return;
    get().stop();
    set({ opening: true, chatId: id, messages: [] });
    try {
      const { chat, turns } = await getTaiChat(id);
      if (get().chatId === id) set({ title: chat.title, messages: fromTurns(turns) });
    } catch (error) {
      haptic.error();
      if (get().chatId === id) set({ chatId: null, title: null, messages: [{ id: nextId(), role: 'tai', text: '', blocks: [], status: null, suggestions: [], error: taiErrorText(error), streaming: false, voice: false, gate: null }] });
    } finally {
      set({ opening: false });
    }
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
