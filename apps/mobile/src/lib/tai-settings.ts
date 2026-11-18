import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert } from 'react-native';

import { haptic } from './haptics';
import { queryClient } from './query';
import { useClubKey } from './queries';
import {
  getTaiChatConfig,
  getTaiSettings,
  saveTaiClubBrief,
  saveTaiSettings,
  type TaiSettings,
  type TaiSettingsResponse,
} from './tai-api';

/**
 * Данные экранов «Меню → Tai»: голос, манера и клиенты в Telegram.
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

/** Готовность Tai (бот и ИИ) для шапки «Tai». Групповые чаты — в разделе «Telegram». */
export function useTaiChatsEditor() {
  const club = useClubKey();
  const query = useQuery({ queryKey: [club, 'ai', 'chat-config'], queryFn: getTaiChatConfig });
  return { query };
}
