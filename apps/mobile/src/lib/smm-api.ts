import { useQuery } from '@tanstack/react-query';
import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Alert, Linking, Platform, Share } from 'react-native';

import { api, ApiError } from './api';
import { queryClient } from './query';
import { useClubKey } from './queries';

/**
 * «СММ» — Tai ведёт Telegram-канал и Instagram клуба (сервер: apps/api/src/modules/smm).
 * План месяца → Tai готовит пост за сутки (рилс — за трое) → одобрение → Telegram выходит
 * сам, Instagram/сторис/рилс Tai передаёт выкладывающему и ждёт ссылку. Долгую работу Tai
 * делает в фоне — экраны перечитывают данные, пока у поста или плана есть `busy`.
 */

export type SmmPlatform = 'telegram' | 'instagram';
export type SmmFormat = 'post' | 'carousel' | 'story' | 'reel';
export type SmmStatus = 'idea' | 'draft' | 'review' | 'approved' | 'published' | 'skipped' | 'failed';
export type SmmBusy = 'text' | 'image' | 'video' | 'revise' | 'plan' | 'report';

export type SmmMedia = {
  id: string;
  kind: 'image' | 'video';
  source: 'ai' | 'upload';
  status: 'pending' | 'done' | 'failed';
  url: string | null;
  aspect: string | null;
  prompt: string | null;
  model: string | null;
  costRub: number;
  error: string | null;
  selected: boolean;
  sort: number;
  createdAt: string;
};

export type SmmShot = { text: string; seconds?: number; overlay?: string; sticker?: string };
export type SmmScript = { hook: string; formula?: string; shots: SmmShot[]; audio?: string; cast?: string; tips?: string };
export type SmmStats = { views?: number; likes?: number; comments?: number; shares?: number; saves?: number; reach?: number; source?: string };

export type SmmPost = {
  id: string;
  planId: string | null;
  platform: SmmPlatform;
  format: SmmFormat;
  status: SmmStatus;
  publishAt: string | null;
  topic: string;
  pillar: string | null;
  direction: string | null;
  brief: string;
  body: string;
  visual: string;
  script: SmmScript | null;
  assigneeId: string | null;
  assigneeName: string | null;
  approvedAt: string | null;
  handoffAt: string | null;
  publishedAt: string | null;
  publishedUrl: string | null;
  stats: SmmStats;
  busy: SmmBusy | null;
  error: string | null;
  media: SmmMedia[];
  updatedAt: string;
};

export type SmmComment = { id: number; authorName: string | null; role: 'staff' | 'tai'; text: string; createdAt: string };
export type SmmPillar = { key: string; title: string; share: number; about: string };
export type SmmPlan = { id: string; month: string; status: 'draft' | 'active'; summary: string; goals: string[]; pillars: SmmPillar[]; busy: SmmBusy | null; error: string | null; updatedAt: string };

export type SmmAccount = {
  id: string;
  platform: 'telegram' | 'instagram' | 'vk' | 'other';
  title: string;
  url: string | null;
  handle: string | null;
  canPublish: boolean;
  isActive: boolean;
  followers: number | null;
  stats: { views?: number | null; posts?: number | null; engagement?: number | null; source?: string };
  statsAt: string | null;
  statsError: string | null;
};

export type SmmReport = {
  id: string;
  periodFrom: string;
  periodTo: string;
  title: string;
  summary: string;
  metrics: { label: string; value: string; delta?: number | null }[];
  recommendations: { title: string; detail: string }[];
  createdAt: string;
};

export type SmmMemoryKind = 'voice' | 'rule' | 'avoid' | 'insight' | 'fact';
export type SmmMemory = { id: string; kind: SmmMemoryKind; text: string; source: 'staff' | 'remark' | 'analytics'; createdAt: string };

export type SmmOverview = {
  month: string;
  nextMonth: string;
  upcoming: SmmPost[];
  counts: { review: number; awaitingLink: number; failed: number; publishedWeek: number };
  plan: SmmPlan | null;
  nextPlan: SmmPlan | null;
  accounts: SmmAccount[];
  lastReport: SmmReport | null;
  spend: { month: number; budget: number };
  balance: number | null;
  ready: { channel: boolean; instagram: boolean; publisher: boolean; approvers: number };
  autopilot: boolean;
};

export type SmmSettings = {
  autopilot: boolean;
  voice: string;
  audience: string;
  goals: string;
  cadence: { telegram: number; instagram: number; stories: number; reels: number };
  postTime: string;
  publisherId: string | null;
  reviewLeadHours: number;
  monthlyBudget: number;
};

export type SmmPhoto = { id: string; url: string; title: string; kind: string; index: number };
export type SmmStaff = { id: string; nickname: string; role: string; hasTelegram: boolean };
export type SmmSettingsPayload = {
  settings: SmmSettings;
  accounts: SmmAccount[];
  photos: SmmPhoto[];
  staff: SmmStaff[];
  spend: { month: number; budget: number };
  balance: number | null;
  models: { text: string; image: string; video: string };
};

export type SmmIdea = { topic: string; brief: string; platform: SmmPlatform; format: SmmFormat; direction: string };
export type SmmAnalytics = {
  accounts: SmmAccount[];
  history: { accountId: string; day: string; followers: number | null; views: number | null }[];
  posts: SmmPost[];
  reports: SmmReport[];
  spend: { month: number; budget: number };
};

// ─── Подписи ─────────────────────────────────────────────────────────────────

export const PLATFORM_LOOK: Record<SmmAccount['platform'], { label: string; color: string; icon: 'paperplane.fill' | 'camera.fill' | 'person.2.fill' | 'link' }> = {
  telegram: { label: 'Telegram', color: '#229ED9', icon: 'paperplane.fill' },
  instagram: { label: 'Instagram', color: '#E1306C', icon: 'camera.fill' },
  vk: { label: 'VK', color: '#0077FF', icon: 'person.2.fill' },
  other: { label: 'Сайт', color: '#8E8E93', icon: 'link' },
};

export const FORMAT_LABEL: Record<SmmFormat, string> = { post: 'Пост', carousel: 'Карусель', story: 'Сторис', reel: 'Рилс' };
export const FORMAT_ICON: Record<SmmFormat, 'text.below.photo' | 'square.stack' | 'circle.dashed' | 'video'> = {
  post: 'text.below.photo',
  carousel: 'square.stack',
  story: 'circle.dashed',
  reel: 'video',
};

export const DIRECTIONS: { key: string; label: string }[] = [
  { key: 'sport', label: 'Спортивная мафия' },
  { key: 'city', label: 'Городская мафия' },
  { key: 'school', label: 'Школа мафии' },
  { key: 'events', label: 'ДР и корпоративы' },
  { key: 'kids', label: 'Детская мафия' },
  { key: 'party', label: 'Вечеринки' },
  { key: 'bar', label: 'Бар и настолки' },
  { key: 'community', label: 'Люди клуба' },
];
export const directionLabel = (key: string | null) => DIRECTIONS.find((d) => d.key === key)?.label ?? null;

/** Статус публикации: подпись и системный цвет. */
export function statusLook(post: Pick<SmmPost, 'status' | 'platform' | 'format' | 'handoffAt' | 'publishedUrl' | 'busy'>): { label: string; color: string } {
  if (post.busy === 'text' || post.busy === 'revise') return { label: 'Tai пишет', color: '#AF52DE' };
  if (post.busy === 'image') return { label: 'Tai рисует', color: '#AF52DE' };
  switch (post.status) {
    case 'idea':
      return { label: 'Идея', color: '#8E8E93' };
    case 'draft':
      return { label: 'Черновик', color: '#8E8E93' };
    case 'review':
      return { label: 'На одобрении', color: '#FF9500' };
    case 'approved':
      if (post.handoffAt && !post.publishedUrl) return { label: 'Ждём ссылку', color: '#FF9500' };
      return { label: autoPublishes(post) ? 'Выйдет сам' : 'Одобрено', color: '#34C759' };
    case 'published':
      return { label: 'Вышло', color: '#007AFF' };
    case 'skipped':
      return { label: 'Не выходит', color: '#8E8E93' };
    case 'failed':
      return { label: 'Не вышло', color: '#FF3B30' };
  }
}

/** Telegram-посты Tai публикует сам; остальное выкладывает человек. */
export const autoPublishes = (p: Pick<SmmPost, 'platform' | 'format'>) => p.platform === 'telegram' && (p.format === 'post' || p.format === 'carousel');

const MSK_MS = 3 * 3600_000;
const WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

/** Дата и время в Москве (клуб живёт по МСК, телефон может быть в другом поясе). */
export function msk(iso: string | null): { date: string; time: string; weekday: string; day: number; month: number } | null {
  if (!iso) return null;
  const d = new Date(Date.parse(iso) + MSK_MS);
  if (Number.isNaN(d.getTime())) return null;
  const isoText = d.toISOString();
  return { date: isoText.slice(0, 10), time: isoText.slice(11, 16), weekday: WEEKDAYS[d.getUTCDay()]!, day: d.getUTCDate(), month: d.getUTCMonth() };
}

export const todayMsk = () => new Date(Date.now() + MSK_MS).toISOString().slice(0, 10);

/** Дата+время из системного пикера → строки для API (телефон клуба живёт по Москве). */
export function pickerToMsk(date: Date): { date: string; time: string } {
  const pad = (n: number) => String(n).padStart(2, '0');
  return { date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`, time: `${pad(date.getHours())}:${pad(date.getMinutes())}` };
}

/** Время публикации → дата для пикера; без даты — завтра в полдень. */
export function mskToPicker(iso: string | null): Date {
  const m = msk(iso);
  if (!m) {
    const d = new Date(Date.now() + 86_400_000);
    d.setHours(12, 0, 0, 0);
    return d;
  }
  const [y, mo, d] = m.date.split('-').map(Number) as [number, number, number];
  const [h, mi] = m.time.split(':').map(Number) as [number, number];
  return new Date(y, mo - 1, d, h, mi);
}

export function dayTitle(date: string): string {
  const today = todayMsk();
  const tomorrow = new Date(Date.parse(`${today}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  const d = new Date(`${date}T12:00:00Z`);
  const label = `${d.getUTCDate()} ${MONTHS_GEN[d.getUTCMonth()]}, ${WEEKDAYS[d.getUTCDay()]}`;
  if (date === today) return `Сегодня · ${label}`;
  if (date === tomorrow) return `Завтра · ${label}`;
  return label;
}

export function whenLabel(iso: string | null): string {
  const m = msk(iso);
  return m ? `${m.weekday}, ${m.day} ${MONTHS_GEN[m.month]}, ${m.time}` : 'Без даты';
}

export const monthTitle = (month: string) => `${MONTHS[Number(month.slice(5, 7)) - 1] ?? month} ${month.slice(0, 4)}`;

export function shiftMonth(month: string, delta: number): string {
  const d = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

/** Текст поста без разметки Telegram — для превью и копирования в Instagram. */
export function plainText(body: string): string {
  return body
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<a\s[^>]*>([^<]*)<\/a>/gi, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .trim();
}

export const selectedMedia = (post: Pick<SmmPost, 'media'>) =>
  post.media.filter((m) => m.selected && (m.status === 'done' || m.status === 'pending')).sort((a, b) => a.sort - b.sort);

export const busyText: Record<SmmBusy, string> = {
  text: 'Tai пишет текст и рисует картинку…',
  image: 'Tai рисует картинку…',
  video: 'Нейросеть снимает видео — это несколько минут…',
  revise: 'Tai вносит правки…',
  plan: 'Tai составляет план — около минуты…',
  report: 'Tai готовит отчёт…',
};

// ─── Запросы ─────────────────────────────────────────────────────────────────

const POLL_MS = 3000;

export function useSmmOverview() {
  const club = useClubKey();
  return useQuery({
    queryKey: [club, 'smm', 'overview'],
    queryFn: () => api.get<SmmOverview>('/smm/overview'),
    refetchInterval: (q) => (q.state.data?.upcoming.some((p) => p.busy) || q.state.data?.plan?.busy ? POLL_MS * 2 : false),
  });
}

export type SmmPostPayload = { post: SmmPost; comments: SmmComment[]; canApprove: boolean };

const isWorking = (post?: SmmPost) => !!post && (!!post.busy || post.media.some((m) => m.status === 'pending'));

export function useSmmPost(id: string) {
  const club = useClubKey();
  return useQuery({
    queryKey: [club, 'smm', 'post', id],
    queryFn: () => api.get<SmmPostPayload>(`/smm/posts/${id}`),
    enabled: !!id,
    refetchInterval: (q) => (isWorking(q.state.data?.post) ? POLL_MS : false),
  });
}

export type SmmPlanPayload = { plan: SmmPlan | null; posts: SmmPost[]; comments: SmmComment[] };

export function useSmmPlan(month: string) {
  const club = useClubKey();
  return useQuery({
    queryKey: [club, 'smm', 'plan', month],
    queryFn: () => api.get<SmmPlanPayload>(`/smm/plans/${month}`),
    refetchInterval: (q) => (q.state.data?.plan?.busy ? POLL_MS : false),
  });
}

export function useSmmAnalytics() {
  const club = useClubKey();
  return useQuery({ queryKey: [club, 'smm', 'analytics'], queryFn: () => api.get<SmmAnalytics>('/smm/analytics') });
}

export function useSmmMemory() {
  const club = useClubKey();
  return useQuery({ queryKey: [club, 'smm', 'memory'], queryFn: () => api.get<{ memory: SmmMemory[] }>('/smm/memory') });
}

export function useSmmSettings(enabled = true) {
  const club = useClubKey();
  return useQuery({ queryKey: [club, 'smm', 'settings'], queryFn: () => api.get<SmmSettingsPayload>('/smm/settings'), enabled });
}

// ─── Действия ────────────────────────────────────────────────────────────────

/** После любого изменения поста — свежий пост в кэш, ленту и план перечитать. */
function storePost(club: string, post: SmmPost | null | undefined) {
  if (post) {
    queryClient.setQueryData<SmmPostPayload>([club, 'smm', 'post', post.id], (prev) => (prev ? { ...prev, post } : prev));
  }
  void queryClient.invalidateQueries({ queryKey: [club, 'smm', 'overview'] });
  void queryClient.invalidateQueries({ queryKey: [club, 'smm', 'plan'] });
}

export async function postAction(club: string, id: string, action: string, body?: unknown): Promise<SmmPost> {
  const { post } = await api.post<{ post: SmmPost }>(`/smm/posts/${id}/${action}`, body ?? {});
  storePost(club, post);
  void queryClient.invalidateQueries({ queryKey: [club, 'smm', 'post', id] });
  return post;
}

/** Перечитать пост (после загрузки файла, разбора скриншота). */
export async function refreshPost(club: string, id: string): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: [club, 'smm', 'post', id] });
  void queryClient.invalidateQueries({ queryKey: [club, 'smm', 'overview'] });
}

export async function patchPost(club: string, id: string, body: Record<string, unknown>): Promise<SmmPost> {
  const { post } = await api.patch<{ post: SmmPost }>(`/smm/posts/${id}`, body);
  storePost(club, post);
  return post;
}

export async function deletePost(club: string, id: string): Promise<void> {
  await api.delete(`/smm/posts/${id}`);
  queryClient.removeQueries({ queryKey: [club, 'smm', 'post', id] });
  storePost(club, null);
}

export async function mediaAction(club: string, postId: string, mediaId: string, selected: boolean | null): Promise<void> {
  const { post } =
    selected === null
      ? await api.delete<{ post: SmmPost }>(`/smm/posts/${postId}/media/${mediaId}`)
      : await api.patch<{ post: SmmPost }>(`/smm/posts/${postId}/media/${mediaId}`, { selected });
  storePost(club, post);
  void queryClient.invalidateQueries({ queryKey: [club, 'smm', 'post', postId] });
}

export async function createPost(club: string, body: Record<string, unknown>): Promise<SmmPost> {
  const { post } = await api.post<{ post: SmmPost }>('/smm/posts', body);
  storePost(club, post);
  return post;
}

export async function planAction(club: string, month: string, action: 'generate' | 'approve' | 'remark', body?: unknown): Promise<SmmPlanPayload> {
  const data = await api.post<SmmPlanPayload>(`/smm/plans/${month}/${action}`, body ?? {});
  queryClient.setQueryData([club, 'smm', 'plan', month], data);
  void queryClient.invalidateQueries({ queryKey: [club, 'smm', 'overview'] });
  return data;
}

export async function saveSettings(club: string, patch: Partial<SmmSettings>): Promise<SmmSettingsPayload> {
  const data = await api.put<SmmSettingsPayload>('/smm/settings', patch);
  queryClient.setQueryData([club, 'smm', 'settings'], data);
  void queryClient.invalidateQueries({ queryKey: [club, 'smm', 'overview'] });
  return data;
}

export async function settingsRequest(club: string, method: 'post' | 'patch' | 'delete', path: string, body?: unknown): Promise<SmmSettingsPayload> {
  const data = method === 'post' ? await api.post<SmmSettingsPayload>(path, body ?? {}) : method === 'patch' ? await api.patch<SmmSettingsPayload>(path, body ?? {}) : await api.delete<SmmSettingsPayload>(path);
  queryClient.setQueryData([club, 'smm', 'settings'], data);
  void queryClient.invalidateQueries({ queryKey: [club, 'smm', 'overview'] });
  return data;
}

// ─── Файлы ───────────────────────────────────────────────────────────────────

const IMAGE_LONG_SIDE = 2048;

/** Файл для загрузки: картинку уменьшаем и пересохраняем в JPEG, видео — как есть. */
async function uploadFile(asset: ImagePicker.ImagePickerAsset): Promise<File> {
  if (asset.type === 'video') return new File(asset.uri);
  const w = asset.width ?? 0;
  const h = asset.height ?? 0;
  const scale = w && h ? Math.min(1, IMAGE_LONG_SIDE / Math.max(w, h)) : 1;
  const context = ImageManipulator.manipulate(asset.uri);
  if (scale < 1) context.resize({ width: Math.round(w * scale) });
  const image = await context.renderAsync();
  const saved = await image.saveAsync({ compress: 0.88, format: SaveFormat.JPEG });
  return new File(saved.uri);
}

/** Отправить файл формой. Глобальный fetch Expo принимает только File (не { uri }). */
export async function uploadAsset<T>(path: string, asset: ImagePicker.ImagePickerAsset, extra: Record<string, string> = {}): Promise<T> {
  const form = new FormData();
  form.append('file', await uploadFile(asset));
  for (const [key, value] of Object.entries(extra)) form.append(key, value);
  return api.post<T>(path, form);
}

/**
 * «Снять / Из галереи» → выбранный файл. Видео — в 1080p (оригинал с телефона бывает
 * сотни мегабайт), до 90 секунд. null — отменили или нет доступа.
 */
export function pickMedia(title: string, kinds: ('images' | 'videos')[]): Promise<ImagePicker.ImagePickerAsset | null> {
  return new Promise((resolve) => {
    const run = async (source: 'camera' | 'library') => {
      const permission = source === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(source === 'camera' ? 'Нужен доступ к камере' : 'Нужен доступ к фото', 'Разрешите доступ в настройках телефона.', [
          { text: 'Отмена', style: 'cancel' },
          { text: 'Открыть настройки', onPress: () => void Linking.openSettings() },
        ]);
        resolve(null);
        return;
      }
      const options: ImagePicker.ImagePickerOptions = {
        mediaTypes: kinds,
        quality: 1,
        videoMaxDuration: 90,
        videoExportPreset: ImagePicker.VideoExportPreset.H264_1920x1080,
      };
      const result = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
      resolve(result.canceled ? null : (result.assets[0] ?? null));
    };
    Alert.alert(title, undefined, [
      { text: 'Отмена', style: 'cancel', onPress: () => resolve(null) },
      { text: 'Снять', onPress: () => void run('camera') },
      { text: 'Из галереи', onPress: () => void run('library') },
    ]);
  });
}

/**
 * Сохранить картинку или видео на телефон / отправить в Instagram: файл скачивается во
 * временную папку и открывается системным «Поделиться» («Сохранить», «Instagram»).
 * На Android «Поделиться» файлом из RN не умеет — открываем ссылку в браузере.
 */
export async function shareMedia(url: string): Promise<void> {
  if (Platform.OS !== 'ios') {
    await Linking.openURL(url);
    return;
  }
  try {
    const dir = new Directory(Paths.cache, 'smm');
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
    const name = url.split('/').pop()?.split('?')[0] || `titan-${Date.now()}.jpg`;
    const file = await File.downloadFileAsync(url, new File(dir, name), { idempotent: true });
    await Share.share({ url: file.uri });
  } catch (error) {
    Alert.alert('Файл не открылся', error instanceof ApiError || error instanceof Error ? error.message : String(error));
  }
}

/** Текст подписи — в системное «Поделиться»: там «Скопировать» и сразу Instagram/Telegram. */
export function shareText(text: string): void {
  void Share.share({ message: text });
}
