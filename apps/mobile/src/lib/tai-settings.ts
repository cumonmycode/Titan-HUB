import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert } from 'react-native';

import { haptic } from './haptics';
import { queryClient } from './query';
import { useClubKey } from './queries';
import {
  getTaiChatConfig,
  getTaiSettings,
  saveTaiChatConfig,
  saveTaiClubBrief,
  saveTaiSettings,
  type TaiChat,
  type TaiChatConfig,
  type TaiSettings,
  type TaiSettingsResponse,
} from './tai-api';

/**
 * Данные экранов «Меню → Tai»: голос, манера, клиенты в Telegram и групповые чаты.
 * Все экраны правят одно и то же — изменение сразу видно везде, при ошибке откатывается.
 */

const failed = (error: unknown) => Alert.alert('Не сохранилось', error instanceof Error ? error.message : String(error));

export function useTaiSettingsEditor() {
  const club = useClubKey();
  const key = [club, 'ai', 'settings'];
  const query = useQuery({ queryKey: key, queryFn: getTaiSettings });

  const save = useMutation({
    mutationFn: saveTaiSettings,
    onMutate: async (patch: Partial<TaiSettings>) => {
      const previous = queryClient.getQueryData<TaiSettingsResponse>(key);
      if (previous) queryClient.setQueryData<TaiSettingsResponse>(key, { ...previous, settings: { ...previous.settings, ...patch } });
      return { previous };
    },
    onError: (error, _patch, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
      failed(error);
    },
    onSuccess: () => haptic.success(),
  });

  const brief = useMutation({
    mutationFn: saveTaiClubBrief,
    onSuccess: (clubBrief) => {
      const previous = queryClient.getQueryData<TaiSettingsResponse>(key);
      if (previous) queryClient.setQueryData<TaiSettingsResponse>(key, { ...previous, clubBrief });
      haptic.success();
    },
    onError: failed,
  });

  return { query, save: (patch: Partial<TaiSettings>) => save.mutate(patch), saveBrief: brief.mutateAsync, briefSaving: brief.isPending };
}

export function useTaiChatsEditor() {
  const club = useClubKey();
  const key = [club, 'ai', 'chat-config'];
  const query = useQuery({ queryKey: key, queryFn: getTaiChatConfig });

  const save = useMutation({
    mutationFn: saveTaiChatConfig,
    onMutate: async (patch: { enabled?: boolean; chats?: TaiChat[] }) => {
      const previous = queryClient.getQueryData<TaiChatConfig>(key);
      if (previous) queryClient.setQueryData<TaiChatConfig>(key, { ...previous, ...patch });
      return { previous };
    },
    onError: (error, _patch, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
      failed(error);
    },
    onSuccess: () => haptic.success(),
  });

  const patchChat = (id: TaiChat['id'], patch: Partial<TaiChat>) => {
    const data = queryClient.getQueryData<TaiChatConfig>(key);
    if (!data) return;
    haptic.selection();
    save.mutate({ chats: data.chats.map((chat) => (String(chat.id) === String(id) ? { ...chat, ...patch } : chat)) });
  };

  return { query, setJokes: (enabled: boolean) => save.mutate({ enabled }), patchChat };
}
