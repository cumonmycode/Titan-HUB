import { useQuery } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { Alert, Linking } from 'react-native';

import { api } from './api';
import { queryClient } from './query';
import { useClubKey } from './queries';
import { uploadAsset, type SmmProgress } from './smm-api';

/**
 * «База знаний» Tai (сервер: apps/api/src/modules/smm/knowledge.router.ts): портрет клуба
 * (слова владельца + собранное Tai из сайта, GoMafia и соцсетей), что было в соцсетях,
 * интерьер по зонам (фото, описание владельца и Tai), справка по мафии и календарь
 * праздников со своими датами клуба. Пока Tai работает — экран перечитывает данные.
 */

export interface SmmKnowledgeDoc {
  key: 'club' | 'socials';
  ownerText: string;
  aiText: string;
  meta: { facts?: string[]; counts?: Record<string, number>; posts?: number; studiedAt?: string; composedAt?: string };
  progress: SmmProgress | null;
  error: string | null;
  aiAt: string | null;
}

export interface SmmZone {
  id: string;
  code: string;
  title: string;
  ownerText: string;
  aiText: string;
  anchor: string;
  photos: { id: string; url: string }[];
  progress: SmmProgress | null;
  error: string | null;
  aiAt: string | null;
}

export type SmmDateTone = 'celebrate' | 'sell' | 'fun' | 'respect' | 'mourning';

export interface SmmClubDate {
  date: string;
  until?: string;
  title: string;
  tone: SmmDateTone;
  weight: 1 | 2 | 3;
  note: string;
  own?: boolean;
  id?: string;
}

export interface SmmKnowledge {
  club: SmmKnowledgeDoc;
  socials: SmmKnowledgeDoc & { posts: Record<string, number> };
  zones: SmmZone[];
  mafia: { source: string; sections: { title: string; text: string }[] };
  dates: { upcoming: SmmClubDate[]; own: { id: string; day: string; title: string; note: string }[] };
}

export const TONE_LOOK: Record<SmmDateTone, { label: string; color: string }> = {
  celebrate: { label: 'Праздник', color: '#AF52DE' },
  sell: { label: 'Повод продать', color: '#34C759' },
  fun: { label: 'Повод поиграть', color: '#FF9F0A' },
  respect: { label: 'Уважительно', color: '#5E5CE6' },
  mourning: { label: 'Траур', color: '#8E8E93' },
};

const POLL_MS = 2500;
const busy = (k?: SmmKnowledge) => !!k && (!!k.club.progress || !!k.socials.progress || k.zones.some((z) => !!z.progress));

export function useSmmKnowledge(enabled = true) {
  const club = useClubKey();
  return useQuery({
    queryKey: [club, 'smm', 'knowledge'],
    queryFn: () => api.get<SmmKnowledge>('/smm/knowledge'),
    enabled,
    refetchInterval: (q) => (busy(q.state.data) ? POLL_MS : false),
  });
}

export async function knowledgeRequest(club: string, method: 'post' | 'put' | 'patch' | 'delete', path: string, body?: unknown): Promise<SmmKnowledge> {
  const data =
    method === 'post' ? await api.post<SmmKnowledge>(path, body ?? {}) : method === 'put' ? await api.put<SmmKnowledge>(path, body ?? {}) : method === 'patch' ? await api.patch<SmmKnowledge>(path, body ?? {}) : await api.delete<SmmKnowledge>(path);
  queryClient.setQueryData([club, 'smm', 'knowledge'], data);
  return data;
}

/** Фото зоны по одному (сервер принимает файл за раз); после каждого — свежие данные. */
export async function uploadZonePhotos(club: string, zoneId: string, assets: ImagePicker.ImagePickerAsset[], onEach?: (done: number) => void): Promise<void> {
  for (let i = 0; i < assets.length; i += 1) {
    const data = await uploadAsset<SmmKnowledge>(`/smm/zones/${zoneId}/photos`, assets[i]!);
    queryClient.setQueryData([club, 'smm', 'knowledge'], data);
    onEach?.(i + 1);
  }
}

const MAX_PICK = 10;

/** «Снять / Из галереи» → несколько фото (из галереи — до 10 за раз). Пусто — отменили или нет доступа. */
export function pickPhotos(title: string): Promise<ImagePicker.ImagePickerAsset[]> {
  return new Promise((resolve) => {
    const run = async (source: 'camera' | 'library') => {
      const permission = source === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(source === 'camera' ? 'Нужен доступ к камере' : 'Нужен доступ к фото', 'Разрешите доступ в настройках телефона.', [
          { text: 'Отмена', style: 'cancel' },
          { text: 'Открыть настройки', onPress: () => void Linking.openSettings() },
        ]);
        resolve([]);
        return;
      }
      const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1, allowsMultipleSelection: source === 'library', selectionLimit: MAX_PICK, orderedSelection: true };
      const result = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
      resolve(result.canceled ? [] : result.assets);
    };
    Alert.alert(title, undefined, [
      { text: 'Отмена', style: 'cancel', onPress: () => resolve([]) },
      { text: 'Снять', onPress: () => void run('camera') },
      { text: 'Из галереи', onPress: () => void run('library') },
    ]);
  });
}

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

/** «2026-11-15» → «15 ноября»; «11-15» (каждый год) → «15 ноября, каждый год». */
export function dayLabel(day: string): string {
  const md = day.slice(-5);
  const [m, d] = md.split('-').map(Number) as [number, number];
  const text = `${d} ${MONTHS[m - 1] ?? ''}`;
  return day.length === 5 ? `${text}, каждый год` : text;
}
