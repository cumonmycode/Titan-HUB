import { useQuery } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import * as Network from 'expo-network';
import { Alert, Linking } from 'react-native';

import { api } from './api';
import { type ImageFit, uploadImage } from './photo';
import { queryClient } from './query';
import { useClubKey } from './queries';
import { useSession } from './session';

/**
 * «Экраны» — телевизоры клуба с приложением Titan Menu (тот же раздел, что «Управление →
 * Экраны» в вебе). У каждого экрана свои настройки: как висит ТВ, показ (по кругу меню
 * и картинки на весь экран, у каждого своё время, анимация и её скорость), а если в
 * показе есть меню — его тема, лента и реклама в ней. Приставка просто показывает то,
 * что задано здесь, и подхватывает изменения в течение 20 секунд.
 *
 * Подключение ТВ: приставка без привязки показывает код и держит в локальной сети HTTP
 * на порту 8788. Телефон находит её перебором своей Wi‑Fi подсети (мультикаст в сетях
 * клубов часто режется — Bonjour ненадёжен), берёт в HUB одноразовый секрет и передаёт
 * его приставке вместе с кодом; дальше приставка сама получает свой токен.
 */

export type Rotation = 0 | 90 | 270;
export type Transition = 'fade' | 'slide' | 'zoom' | 'flip' | 'none';
export type Fit = 'contain' | 'cover';
/** 'show' — показ на весь экран (меню, картинки); 'band' — реклама в ленте меню. */
export type Placement = 'show' | 'band';
export type SlideKind = 'image' | 'card' | 'menu';

/** Что в показе: есть ли меню и сколько картинок. */
export type ShowSummary = { menu: boolean; images: number };

export type Screen = {
  id: string;
  name: string;
  show: ShowSummary;
  rotation: Rotation;
  theme: string;
  bandSec: number;
  sortOrder: number;
  paired: boolean;
  online: boolean;
  deviceModel: string | null;
  appVersion: string | null;
  deviceIp: string | null;
  pairedAt: string | null;
  lastSeenAt: string | null;
};

/** Элемент экрана: в показе — меню или картинка, в ленте — картинка или карточка. */
export type ScreenSlide = {
  id: string;
  screenId: string;
  placement: Placement;
  kind: SlideKind;
  imageUrl: string | null;
  title: string | null;
  body: string | null;
  linkUrl: string | null;
  durationSec: number;
  transition: Transition;
  transitionMs: number;
  fit: Fit;
  isActive: boolean;
  sortOrder: number;
};

export type SlideInput = {
  placement?: Placement;
  kind: SlideKind;
  imageUrl?: string | null;
  title?: string | null;
  body?: string | null;
  linkUrl?: string | null;
  durationSec?: number;
  transition?: Transition;
  transitionMs?: number;
  fit?: Fit;
  isActive?: boolean;
};

export type ScreenPatch = Partial<Pick<Screen, 'name' | 'rotation' | 'theme' | 'bandSec'>>;

/** GET /screens/:id — экран, его показ и реклама ленты. */
export type ScreenDetail = { screen: Screen; show: ScreenSlide[]; slides: ScreenSlide[] };

export const ROTATIONS: { key: Rotation; label: string }[] = [
  { key: 0, label: 'Горизонтально' },
  { key: 90, label: 'Вертикально ↻' },
  { key: 270, label: 'Вертикально ↺' },
];

export const TRANSITIONS: { key: Transition; label: string }[] = [
  { key: 'fade', label: 'Растворение' },
  { key: 'slide', label: 'Сдвиг' },
  { key: 'zoom', label: 'Приближение' },
  { key: 'flip', label: 'Переворот' },
  { key: 'none', label: 'Без анимации' },
];

export const FITS: { key: Fit; label: string }[] = [
  { key: 'contain', label: 'Целиком' },
  { key: 'cover', label: 'Во весь экран' },
];

export const THEMES: { key: string; name: string }[] = [
  { key: 'night', name: 'Ночь' },
  { key: 'neon', name: 'Неон' },
  { key: 'deco', name: 'Ар-деко' },
  { key: 'synth', name: 'Синтвейв' },
  { key: 'avant', name: 'Конструктивизм' },
  { key: 'dossier', name: 'Досье' },
  { key: 'halloween', name: 'Хеллоуин' },
];

/** Скорость анимации появления элемента показа. */
export const SPEEDS: { ms: number; label: string }[] = [
  { ms: 500, label: 'Быстро' },
  { ms: 900, label: 'Обычно' },
  { ms: 1600, label: 'Медленно' },
];

export const SLIDE_DURATIONS = [5, 8, 10, 15, 20, 30, 45, 60];
export const MENU_DURATIONS = [15, 20, 30, 45, 60, 90, 120, 180, 300];
export const BAND_DURATIONS = [10, 15, 20, 30, 45, 60];

/** «45 с», «2 мин», «1,5 мин». */
export function durationLabel(sec: number): string {
  if (sec < 60) return `${sec} с`;
  const min = sec / 60;
  return `${Number.isInteger(min) ? min : min.toFixed(1).replace('.', ',')} мин`;
}

/** «Обычно», или «1,2 с», если скорость задана не из готовых. */
export function speedLabel(ms: number): string {
  return SPEEDS.find((s) => s.ms === ms)?.label ?? `${(ms / 1000).toFixed(1).replace('.', ',')} с`;
}

function plural(n: number, forms: [string, string, string]): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return forms[0];
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return forms[1];
  return forms[2];
}

/** «Меню», «Меню и 2 картинки», «5 картинок». */
export function showLabel(show: ShowSummary): string {
  const pics = show.images ? `${show.images} ${plural(show.images, ['картинка', 'картинки', 'картинок'])}` : '';
  if (show.menu) return pics ? `Меню и ${pics}` : 'Меню';
  return pics || 'Меню';
}

/** «10 с · Сдвиг», скорость — только если не обычная: «1 мин · Сдвиг · быстро». */
export function showItemSummary(item: ScreenSlide): string {
  const parts = [durationLabel(item.durationSec), TRANSITIONS.find((t) => t.key === item.transition)?.label ?? 'Растворение'];
  if (item.transition !== 'none' && item.transitionMs !== 900) parts.push(speedLabel(item.transitionMs).toLowerCase());
  return parts.join(' · ');
}

/** Список с текущим значением, даже если его нет среди готовых (задано в вебе). */
export function withCurrent(values: number[], current: number): number[] {
  return values.includes(current) ? values : [...values, current].sort((a, b) => a - b);
}

/** «В сети» / «Не в сети · 5 мин» / «ТВ не подключён». */
export function deviceStatus(s: Pick<Screen, 'paired' | 'online' | 'lastSeenAt'>): { label: string; color: string } {
  if (!s.paired) return { label: 'ТВ не подключён', color: '#8E8E93' };
  if (s.online) return { label: 'В сети', color: '#34C759' };
  if (!s.lastSeenAt) return { label: 'Не в сети', color: '#FF9500' };
  const min = Math.max(1, Math.round((Date.now() - new Date(s.lastSeenAt).getTime()) / 60_000));
  const ago = min < 60 ? `${min} мин` : min < 48 * 60 ? `${Math.round(min / 60)} ч` : `${Math.round(min / 1440)} дн`;
  return { label: `Не в сети · ${ago}`, color: '#FF9500' };
}

/** Адрес показа экрана, например `https://kbr.titanpos.ru/screen/<id>`. */
export function screenPageUrl(id: string, theme?: string): string {
  const host = useSession.getState().club?.host ?? 'titanpos.ru';
  return `https://${host}/screen/${id}${theme ? `?theme=${theme}` : ''}`;
}

// ── Данные ────────────────────────────────────────────────────────────────

const screensKey = (club: string) => [club, 'screens'];
const screenKey = (club: string, id: string) => [club, 'screens', id];
const clubNow = () => useSession.getState().club?.host ?? 'none';

/** Обновить список и открытый экран (статус приставки, слайды). */
export function refreshScreens(): void {
  void queryClient.invalidateQueries({ queryKey: screensKey(clubNow()) });
}

/**
 * Кэш запросов переживает перезапуск и обновление приложения, а до показа (миграция
 * 069) экраны приходили без сводки `show` и элементы — без `placement`. `select`
 * применяется и к сохранённому кэшу: достраиваем старый формат, а не падаем на нём,
 * пока не пришёл свежий ответ.
 */
type StoredScreen = Omit<Screen, 'show'> & { show?: ShowSummary; kind?: string };

function normalizeScreen(s: StoredScreen): Screen {
  return { ...s, show: s.show ?? { menu: s.kind !== 'slideshow', images: 0 } };
}

const selectScreens = (list: StoredScreen[]): Screen[] => list.map(normalizeScreen);

function selectDetail(d: { screen: StoredScreen; show?: ScreenSlide[]; slides?: ScreenSlide[] }): ScreenDetail {
  return {
    screen: normalizeScreen(d.screen),
    show: d.show ?? [],
    slides: (d.slides ?? []).filter((s) => (s.placement ?? 'band') === 'band'),
  };
}

export function useScreens() {
  const club = useClubKey();
  return useQuery({
    queryKey: screensKey(club),
    queryFn: () => api.get<{ screens: StoredScreen[] }>('/screens').then((r) => r.screens),
    select: selectScreens,
    refetchInterval: 20_000, // «в сети» приставок
  });
}

export function useScreen(id: string | undefined) {
  const club = useClubKey();
  return useQuery({
    queryKey: screenKey(club, id ?? 'none'),
    queryFn: () => api.get<{ screen: StoredScreen; show?: ScreenSlide[]; slides?: ScreenSlide[] }>(`/screens/${id}`),
    select: selectDetail,
    enabled: !!id,
    refetchInterval: 20_000,
  });
}

/** Новый экран сразу показывает меню — картинки добавляются в его показ. */
export async function createScreen(input: { name: string }): Promise<Screen> {
  const { screen } = await api.post<{ screen: Screen }>('/screens', input);
  refreshScreens();
  return screen;
}

export async function updateScreen(id: string, patch: ScreenPatch): Promise<void> {
  await api.patch(`/screens/${id}`, patch);
  refreshScreens();
}

export async function deleteScreen(id: string): Promise<void> {
  await api.delete(`/screens/${id}`);
  refreshScreens();
}

export async function unpairScreen(id: string): Promise<void> {
  await api.post(`/screens/${id}/unpair`);
  refreshScreens();
}

export async function createSlide(screenId: string, input: SlideInput): Promise<void> {
  await api.post(`/screens/${screenId}/slides`, input);
  refreshScreens();
}

export async function updateSlide(screenId: string, slideId: string, patch: Partial<SlideInput>): Promise<void> {
  await api.patch(`/screens/${screenId}/slides/${slideId}`, patch);
  refreshScreens();
}

export async function deleteSlide(screenId: string, slideId: string): Promise<void> {
  await api.delete(`/screens/${screenId}/slides/${slideId}`);
  refreshScreens();
}

export async function reorderSlides(screenId: string, items: { id: string; sortOrder: number }[]): Promise<void> {
  await api.patch(`/screens/${screenId}/slides/reorder`, { items });
  refreshScreens();
}

/** Карточка-приглашение в клиентское приложение My Titan (веб-версия на поддомене клуба). */
export function myTitanSlide(): SlideInput {
  const host = useSession.getState().club?.host ?? 'titanpos.ru';
  return {
    placement: 'band',
    kind: 'card',
    title: 'My Titan — твой клуб в телефоне',
    body: 'Баланс, бонусы и запись на игры. Наведи камеру на QR',
    linkUrl: `https://${host}/residents`,
    durationSec: 10,
  };
}

// ── Картинки ──────────────────────────────────────────────────────────────

async function mediaAllowed(): Promise<boolean> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (permission.granted) return true;
  Alert.alert('Нужен доступ к фото', 'Разрешите доступ в настройках телефона.', [
    { text: 'Отмена', style: 'cancel' },
    { text: 'Открыть настройки', onPress: () => void Linking.openSettings() },
  ]);
  return false;
}

/**
 * До 1920 px по длинной стороне и 1080 по короткой: слабой ТВ-приставке тяжело
 * декодировать 12 Мп. Вертикальная картинка для вертикального ТВ остаётся 1080×1920.
 */
const SLIDE_FIT: ImageFit = { long: 1920, short: 1080, quality: 0.82 };

/**
 * Картинки из галереи без обрезки (системная обрезка на iOS только квадратная).
 * `multiple` — для показа, до 10 штук за раз. `[]` — отменили или не дали доступ.
 */
export async function pickScreenImages(multiple: boolean, onProgress?: (done: number, total: number) => void): Promise<string[]> {
  if (!(await mediaAllowed())) return [];
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 1,
    allowsMultipleSelection: multiple,
    selectionLimit: multiple ? 10 : 1,
    orderedSelection: multiple,
  });
  if (result.canceled) return [];
  const urls: string[] = [];
  for (const asset of result.assets) {
    onProgress?.(urls.length, result.assets.length);
    urls.push(await uploadImage(asset, SLIDE_FIT));
  }
  return urls;
}

// ── Поиск и подключение ТВ в локальной сети ───────────────────────────────

export const TV_PORT = 8788;
const PROBE_TIMEOUT_MS = 1500;
const SCAN_CONCURRENCY = 32;

export type FoundTv = {
  ip: string;
  deviceId: string;
  code: string;
  name: string;
  model: string;
  appVersion: string;
  paired: boolean;
  screenName: string | null;
};

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number, outer?: AbortSignal): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const relay = () => controller.abort();
  outer?.addEventListener('abort', relay);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener('abort', relay);
  }
}

/** Есть ли по адресу приставка Titan Menu: её `/info` или `null`. */
export async function probeTv(ip: string, signal?: AbortSignal, timeoutMs = PROBE_TIMEOUT_MS): Promise<FoundTv | null> {
  try {
    const res = await fetchWithTimeout(`http://${ip}:${TV_PORT}/info`, { headers: { Accept: 'application/json' } }, timeoutMs, signal);
    if (!res.ok) return null;
    const info = (await res.json()) as Partial<FoundTv>;
    if (!info || typeof info.code !== 'string' || typeof info.deviceId !== 'string') return null;
    return {
      ip,
      deviceId: info.deviceId,
      code: info.code,
      name: info.name || `Titan TV ${info.code}`,
      model: info.model || 'ТВ-приставка',
      appVersion: info.appVersion || '',
      paired: !!info.paired,
      screenName: info.screenName ?? null,
    };
  } catch {
    return null;
  }
}

/** IPv4 телефона в Wi‑Fi или `null` (мобильный интернет, авиарежим). */
export async function localIp(): Promise<string | null> {
  const ip = await Network.getIpAddressAsync().catch(() => '');
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(ip) && ip !== '0.0.0.0' && !ip.startsWith('127.') ? ip : null;
}

/**
 * Перебор подсети /24 телефона: 254 адреса по 32 параллельно, ~1,5 с на ответ.
 * Найденные приставки отдаются сразу (`onFound`), не дожидаясь конца.
 */
export async function scanForTvs(onFound: (tv: FoundTv) => void, signal: AbortSignal): Promise<void> {
  const ip = await localIp();
  if (!ip) throw new Error('Телефон не в Wi‑Fi. Подключитесь к той же сети, что и приставка.');
  const prefix = ip.split('.').slice(0, 3).join('.');
  const queue = Array.from({ length: 254 }, (_, i) => `${prefix}.${i + 1}`).filter((addr) => addr !== ip);
  const worker = async () => {
    while (queue.length && !signal.aborted) {
      const addr = queue.shift();
      if (!addr) return;
      const tv = await probeTv(addr, signal);
      if (tv && !signal.aborted) onFound(tv);
    }
  };
  await Promise.all(Array.from({ length: SCAN_CONCURRENCY }, worker));
}

/**
 * Подключить приставку к экрану: секрет из HUB (10 минут) + адрес клуба → приставке по
 * локальной сети вместе с кодом с её экрана. Приставка сама меняет секрет на свой токен.
 */
export async function pairTv(tv: FoundTv, screenId: string): Promise<{ name: string }> {
  const { secret, host } = await api.post<{ secret: string; host: string }>(`/screens/${screenId}/pairing`);
  let res: Response;
  try {
    res = await fetchWithTimeout(
      `http://${tv.ip}:${TV_PORT}/pair`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ host, secret, code: tv.code }) },
      25_000,
    );
  } catch {
    throw new Error('Приставка не ответила. Проверьте, что телефон и ТВ в одной Wi‑Fi сети.');
  }
  const body = (await res.json().catch(() => null)) as { ok?: boolean; name?: string; error?: string } | null;
  if (!res.ok || !body?.ok) throw new Error(body?.error || `Приставка ответила ${res.status}`);
  refreshScreens();
  return { name: body.name ?? '' };
}
