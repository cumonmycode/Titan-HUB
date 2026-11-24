import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert } from 'react-native';

import { api } from './api';
import { haptic } from './haptics';
import { queryClient } from './query';
import { useClubKey } from './queries';

/**
 * Раздел «Telegram»: бот клуба, его группы и настройки каждой группы (сервер —
 * /api/telegram, только владелец). Правки чата сохраняются сразу и сразу видны на
 * всех экранах чата; при ошибке откатываются.
 */

export type ChatMode = 'game' | 'work' | 'notify';
export type Harshness = 'soft' | 'medium' | 'savage';
export type CommandAccess = 'admins' | 'everyone';
export type MentionAudience = 'all' | 'unvoted' | 'yes' | 'no' | 'staff';
export type CommandKind = 'mention' | 'text' | 'rules' | 'help' | 'stream' | 'games' | 'tai' | 'random' | 'poll';
export type NotifyCategory = 'requests' | 'shifts' | 'clients' | 'money' | 'stock' | 'events' | 'streams';
export type Chime = 'off' | 'rare' | 'often';
export type FunKind = 'fact' | 'joke' | 'mafia' | 'question';
export type GameKind = 'sport' | 'city';
export type BotStatus = 'member' | 'administrator' | 'left' | 'kicked' | 'unknown';

export type ChatCommand = {
  id: string;
  name: string;
  aliases: string[];
  description: string;
  kind: CommandKind;
  audience?: MentionAudience;
  text?: string;
  enabled: boolean;
  access?: CommandAccess;
  builtin?: boolean;
};

export type ChatConfig = {
  mode: ChatMode;
  tai: { on: boolean; preset: string; harshness: Harshness; profanity: boolean; custom: string; chime: Chime; reactions: boolean };
  fun: { on: boolean; perDay: number; from: number; to: number; kinds: FunKind[]; threadId: number | null };
  access: { invite: boolean; everyone: boolean; games: GameKind[]; staff: boolean; allow: string[]; guard: boolean };
  moderation: { on: boolean };
  commands: { access: CommandAccess; cooldownMin: number; list: ChatCommand[] };
  notify: Record<NotifyCategory, { on: boolean; threadId: number | null }>;
  welcome: { on: boolean; text: string; deleteService: boolean; rules: string };
  bot: { status: BotStatus; at: string | null };
};

export type BotSummary =
  | { configured: false }
  | { configured: true; reachable: false }
  | {
      configured: true;
      reachable: true;
      username: string | null;
      name: string | null;
      photo: string | null;
      canJoinGroups: boolean;
      readsAllMessages: boolean;
      webhook: { ok: boolean; pending: number; lastError: string | null; lastErrorAt: string | null };
    };

export type ChatSummary = {
  id: string;
  title: string | null;
  type: string | null;
  mode: ChatMode;
  taiOn: boolean;
  botStatus: BotStatus;
  active: boolean;
  notify: NotifyCategory[];
  commands: number;
  welcome: boolean;
  polls: number;
};

export type LiveChat =
  | { reachable: false }
  | {
      reachable: true;
      title: string | null;
      isForum: boolean;
      status: string;
      members: number | null;
      rights: { admin: boolean; deleteMessages: boolean; pinMessages: boolean; inviteUsers: boolean; manageTopics: boolean; restrictMembers: boolean };
    };

export type ChatDetail = {
  chat: { id: string; title: string | null; type: string | null; topics: { threadId: string; name: string | null }[] };
  config: ChatConfig;
  live: LiveChat | null;
  polls: { id: string; title: string; enabled: boolean; threadId: number | null }[];
  presets: { key: string; label: string; desc: string }[];
  categories: { key: NotifyCategory; title: string; about: string }[];
  moderationCommands: { name: string; description: string }[];
};

/** Правка чата: разделы целиком или частично; список команд — целиком. */
export type ChatPatch = {
  mode?: ChatMode;
  tai?: Partial<ChatConfig['tai']>;
  fun?: Partial<ChatConfig['fun']>;
  access?: Partial<Omit<ChatConfig['access'], 'allow'>>;
  moderation?: Partial<ChatConfig['moderation']>;
  commands?: Partial<ChatConfig['commands']>;
  notify?: Partial<ChatConfig['notify']>;
  welcome?: Partial<ChatConfig['welcome']>;
};

type ModeIcon = 'gamecontroller.fill' | 'briefcase.fill' | 'bell.badge.fill';
export const MODE_INFO: Record<ChatMode, { title: string; short: string; about: string; icon: ModeIcon; color: string }> = {
  game: {
    title: 'Игровой чат',
    short: 'Игровой',
    about: 'Чат игроков клуба: опросы, команды-отметки, приветствие новичков и шутки Tai, когда к нему обращаются.',
    icon: 'gamecontroller.fill',
    color: '#34C759',
  },
  work: {
    title: 'Чат персонала',
    short: 'Рабочий',
    about: 'Tai отвечает сотрудникам про смену, кассу, цифры и записи — с правами того, кто спросил. Сюда же удобно присылать уведомления.',
    icon: 'briefcase.fill',
    color: '#0A84FF',
  },
  notify: {
    title: 'Уведомления',
    short: 'Уведомления',
    about: 'Бот только присылает события клуба: смены, клиенты, склад, мероприятия. Tai здесь молчит.',
    icon: 'bell.badge.fill',
    color: '#FF9500',
  },
};
export const MODES: ChatMode[] = ['game', 'work', 'notify'];

export const COMMAND_KIND_INFO: Record<CommandKind, { title: string; about: string }> = {
  text: { title: 'Ответ текстом', about: 'Бот отвечает заготовленным текстом' },
  mention: { title: 'Отметить людей', about: 'Бот отмечает выбранных участников' },
  tai: { title: 'Задание для Tai', about: 'Tai выполняет задание в стиле чата: факт, тост, прогноз' },
  random: { title: 'Случайный человек', about: 'Бот выбирает одного участника' },
  games: { title: 'Ближайшие игры', about: 'Расписание из опросов' },
  stream: { title: 'Стрим', about: 'Ссылка на эфир и донаты, если стрим опубликован' },
  poll: { title: 'Опрос', about: 'Показывает сегодняшний опрос в этом чате' },
  rules: { title: 'Правила', about: 'Правила чата' },
  help: { title: 'Справка', about: 'Что умеет бот' },
};
export const CUSTOM_KINDS: CommandKind[] = ['text', 'mention', 'tai', 'random', 'games', 'stream', 'poll'];

export const AUDIENCE_INFO: Record<MentionAudience, string> = {
  all: 'Всех участников чата',
  unvoted: 'Кто не отметился в опросе',
  yes: 'Кто ответил «Да»',
  no: 'Кто ответил «Нет»',
  staff: 'Сотрудников клуба',
};

export const isGroupGone = (status: BotStatus) => status === 'left' || status === 'kicked';

/* ─────────────────────────── Запросы ─────────────────────────── */

const chatPath = (id: string) => `/telegram/chats/${encodeURIComponent(id)}`;

export const getOverview = () => api.get<{ bot: BotSummary; chats: ChatSummary[] }>('/telegram/overview');
export const repairWebhook = () => api.post<{ bot: BotSummary }>('/telegram/webhook/repair');
export const createInvite = (mode: ChatMode) => api.post<{ code: string; url: string; appUrl: string }>('/telegram/invites', { mode });
export const readInvite = (code: string) => api.get<{ mode: ChatMode; chatId: string | null; title: string | null }>(`/telegram/invites/${code}`);
export const getChat = (id: string) => api.get<ChatDetail>(chatPath(id));
export const patchChat = (id: string, patch: ChatPatch) => api.patch<{ config: ChatConfig }>(chatPath(id), patch);
export const testChat = (id: string, threadId: number | null) => api.post(`${chatPath(id)}/test`, { threadId });
export const pinRules = (id: string) => api.post<{ ok: true; pinned: boolean }>(`${chatPath(id)}/rules`);
/** Бот создаёт тему в группе-форуме. */
export const createTopic = (chatId: string, name: string) => api.post<{ threadId: number; name: string }>(`${chatPath(chatId)}/topics`, { name });
/** Ссылка на сообщение в теме → группа и тема (бот должен быть в группе). */
export const resolveTopicLink = (url: string, name?: string) =>
  api.post<{ chatId: string; title: string | null; threadId: number | null; topicName: string | null }>('/telegram/resolve-link', { url, name });
export const removeChat = (id: string, leave: boolean) => api.delete(`${chatPath(id)}?leave=${leave ? '1' : '0'}`);

const failed = (error: unknown) => Alert.alert('Не сохранилось', error instanceof Error ? error.message : String(error));

export function useTelegramOverview() {
  const club = useClubKey();
  return useQuery({ queryKey: [club, 'telegram', 'overview'], queryFn: getOverview });
}

export const invalidateTelegram = (club: string) => queryClient.invalidateQueries({ queryKey: [club, 'telegram'] });

/** Слить правку в настройки чата (мгновенный отклик до ответа сервера). */
function merge(config: ChatConfig, patch: ChatPatch): ChatConfig {
  return {
    ...config,
    ...(patch.mode ? { mode: patch.mode } : {}),
    tai: { ...config.tai, ...patch.tai },
    fun: { ...config.fun, ...patch.fun },
    access: { ...config.access, ...patch.access },
    moderation: { ...config.moderation, ...patch.moderation },
    commands: { ...config.commands, ...patch.commands },
    notify: { ...config.notify, ...patch.notify } as ChatConfig['notify'],
    welcome: { ...config.welcome, ...patch.welcome },
  };
}

/** Один чат: данные и сохранение правок с мгновенным откликом. */
export function useTelegramChat(id: string) {
  const club = useClubKey();
  const key = [club, 'telegram', 'chat', id];
  const query = useQuery({ queryKey: key, queryFn: () => getChat(id), enabled: !!id });

  const mutation = useMutation({
    // Правки одного чата уходят по очереди: иначе быстрые нажатия обгоняли друг друга,
    // и ответ на старую правку возвращал экран к прежнему значению.
    scope: { id: `telegram-chat-${id}` },
    mutationKey: [club, 'telegram', 'chat', id, 'patch'],
    mutationFn: (patch: ChatPatch) => patchChat(id, patch),
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<ChatDetail>(key);
      if (previous) queryClient.setQueryData<ChatDetail>(key, { ...previous, config: merge(previous.config, patch) });
      return { previous };
    },
    onError: (error, _patch, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
      haptic.error();
      failed(error);
    },
    onSuccess: ({ config }) => {
      // Пока в очереди есть ещё правки, экран уже показывает их результат — не откатываем.
      const pending = queryClient.isMutating({ mutationKey: [club, 'telegram', 'chat', id, 'patch'] });
      const current = queryClient.getQueryData<ChatDetail>(key);
      if (current && pending <= 1) queryClient.setQueryData<ChatDetail>(key, { ...current, config });
      void queryClient.invalidateQueries({ queryKey: [club, 'telegram', 'overview'] });
    },
  });

  return {
    query,
    save: (patch: ChatPatch) => {
      haptic.selection();
      mutation.mutate(patch);
    },
    saveAsync: (patch: ChatPatch) => mutation.mutateAsync(patch),
    saving: mutation.isPending,
  };
}

/* ─────────────────────────── Стримы ─────────────────────────── */

export type StreamLink = { kind: 'watch' | 'donate'; label: string; url: string };
export type Stream = {
  id: string;
  title: string;
  links: StreamLink[];
  source: 'mafboard' | 'studio' | 'hub';
  startedAt: string;
  endedAt: string | null;
  published: boolean;
  posts: { chatId: string; messageId: number }[];
};
export type StreamsState = { active: Stream | null; last: Stream | null; autoPublish: boolean; targets: number };

export const getStreams = () => api.get<StreamsState>('/telegram/streams');
export const setStreamsAutoPublish = (autoPublish: boolean) => api.put('/telegram/streams/settings', { autoPublish });
export const startManualStream = (title: string, links: StreamLink[]) => api.post<{ stream: Stream }>('/telegram/streams', { title, links });
export const publishActiveStream = () => api.post<{ stream: Stream }>('/telegram/streams/publish');
export const endActiveStream = () => api.delete('/telegram/streams/active');

export function useStreams() {
  const club = useClubKey();
  return useQuery({ queryKey: [club, 'telegram', 'streams'], queryFn: getStreams });
}

/* ─────────────────────── Доступ клиента к чатам ─────────────────────── */

export type AccessReason = 'everyone' | 'staff' | 'manual' | 'games';
export type ClientChat = { chatId: string; title: string | null; mode: ChatMode; invite: boolean; guard: boolean; manual: boolean; reason: AccessReason | null };
export type ClientChats = { games: 'sport' | 'city' | 'both' | null; pending: boolean; hasTelegram: boolean; items: ClientChat[] };

export const getClientChats = (profileId: string) => api.get<ClientChats>(`/telegram/clients/${encodeURIComponent(profileId)}/chats`);
export const setClientChat = (profileId: string, chatId: string, allow: boolean) =>
  api.put(`/telegram/clients/${encodeURIComponent(profileId)}/chats/${encodeURIComponent(chatId)}`, { allow });

export function useClientChats(profileId: string) {
  const club = useClubKey();
  return useQuery({ queryKey: [club, 'telegram', 'client-chats', profileId], queryFn: () => getClientChats(profileId), enabled: !!profileId });
}
