import { useQuery } from '@tanstack/react-query';

import { api } from './api';
import { queryClient } from './query';
import { useClubKey } from './queries';
import { useSession } from './session';

/**
 * Сайт клуба в HUB: оформление (праздник), расписание вечеров, публикации, домен,
 * контакты и уведомления о заявках онлайн-записи. Всё сохраняется сразу, сайт
 * подхватывает изменения в течение минуты.
 */

const host = () => useSession.getState().club?.host ?? 'none';
const invalidate = (...keys: unknown[][]) => {
  const club = host();
  for (const key of keys) void queryClient.invalidateQueries({ queryKey: [club, ...key] });
};

/** Праздничное оформление сайта поверх Liquid Glass (список — как на сайте). */
export type SiteHoliday =
  | 'new_year' | 'winter' | 'valentine' | 'defender' | 'womens_day' | 'maslenitsa'
  | 'spring' | 'summer' | 'autumn' | 'halloween' | 'club_birthday';

export type SiteScheduleDay = { day: number; title: string; time?: string };
export type SiteContacts = { phone: string; email: string; telegram: string; channel: string; whatsapp: string; vk: string; instagram: string };
export type TgChat = { id: string; title: string | null; type: string | null; topics: { threadId: string; name: string | null }[] };
export type NotifyChat = { chatId: string; threadId: number | null };

export type SiteConfig = {
  holiday?: SiteHoliday | null;
  holidays?: SiteHoliday[];
  schedule: SiteScheduleDay[] | null;
  /** Поля ниже — с сервера после «единой онлайн-записи»; старый кэш может их не знать. */
  contacts?: SiteContacts;
  notifyChat?: NotifyChat | null;
  chats?: TgChat[];
  staffBot?: boolean;
  guestBot?: string | null;
};

export const EMPTY_CONTACTS: SiteContacts = { phone: '', email: '', telegram: '', channel: '', whatsapp: '', vk: '', instagram: '' };

/** Расписание по сменам клуба — сайт показывает его, пока своё не сохранено. */
export const DEFAULT_SCHEDULE: SiteScheduleDay[] = [
  { day: 2, title: 'Городская мафия', time: '19:00' },
  { day: 4, title: 'Спортивная мафия', time: '19:00' },
  { day: 5, title: 'Городская мафия', time: '19:00' },
  { day: 6, title: 'Спортивная мафия', time: '19:00' },
  { day: 7, title: 'Настольные игры', time: '19:00' },
];

export function useSiteConfig() {
  const club = useClubKey();
  return useQuery({
    queryKey: [club, 'system', 'site-config'],
    queryFn: () => api.get<SiteConfig>('/system/site-config'),
    staleTime: 60_000,
  });
}

export type SitePatch = {
  holiday?: SiteHoliday | null;
  schedule?: SiteScheduleDay[] | null;
  contacts?: SiteContacts;
  notifyChat?: NotifyChat | null;
};

export async function saveSite(patch: SitePatch): Promise<void> {
  await api.put('/system/site-config', patch);
  invalidate(['system', 'site-config']);
}

/* ─────────────────────────── Домен ─────────────────────────── */

/* ─────────────────────────── Таплинк (/link) ─────────────────────────── */

export type SiteLinkKind = 'book_game' | 'book_event' | 'tai' | 'telegram' | 'channel' | 'whatsapp' | 'vk' | 'instagram' | 'phone' | 'map' | 'site' | 'custom';
export type SiteLink = { id: string; kind: SiteLinkKind; label: string; url: string; on: boolean };
export type SiteLinks = { title: string; bio: string; links: SiteLink[]; pageUrl: string; contacts: SiteContacts; taiUrl: string | null };

/** Подписи готовых кнопок — как на странице /link (apps/site/src/app/link/page.tsx). */
export const LINK_LOOK: Record<SiteLinkKind, { title: string; icon: string; color: string }> = {
  book_game: { title: 'Записаться на игру', icon: 'calendar.badge.checkmark', color: '#7C4DFF' },
  book_event: { title: 'Заказать мероприятие', icon: 'party.popper', color: '#FF2D55' },
  tai: { title: 'Написать администратору (Tai)', icon: 'sparkles', color: '#7C4DFF' },
  telegram: { title: 'Telegram', icon: 'paperplane.fill', color: '#32ADE6' },
  channel: { title: 'Канал клуба', icon: 'megaphone.fill', color: '#32ADE6' },
  whatsapp: { title: 'WhatsApp', icon: 'message.fill', color: '#34C759' },
  vk: { title: 'ВКонтакте', icon: 'globe', color: '#0077FF' },
  instagram: { title: 'Instagram', icon: 'camera.fill', color: '#E1306C' },
  phone: { title: 'Позвонить', icon: 'phone.fill', color: '#34C759' },
  map: { title: 'Как добраться', icon: 'map.fill', color: '#FF9500' },
  site: { title: 'Сайт клуба', icon: 'safari.fill', color: '#007AFF' },
  custom: { title: 'Своя ссылка', icon: 'link', color: '#8E8E93' },
};

export function useSiteLinks() {
  const club = useClubKey();
  return useQuery({
    queryKey: [club, 'site', 'links'],
    queryFn: () => api.get<SiteLinks>('/system/site-links'),
    staleTime: 30_000,
  });
}

export async function saveSiteLinks(value: { title: string; bio: string; links: SiteLink[] }): Promise<void> {
  await api.put('/system/site-links', value);
  const club = useSession.getState().club?.host ?? 'none';
  void queryClient.invalidateQueries({ queryKey: [club, 'site', 'links'] });
}

export type DomainCert = { cert: 'none' | 'pending' | 'active' | 'error'; expiresAt: string | null; error: string | null; checkedAt: string | null };
export type SiteDomain = {
  domain: string | null;
  primary: 'www' | 'apex';
  url: string | null;
  mirror: string;
  serverIp: string | null;
  dns: { apex: { ips: string[]; ok: boolean }; www: { ips: string[]; ok: boolean } };
  cert: DomainCert | null;
};

export function useSiteDomain() {
  const club = useClubKey();
  return useQuery({
    queryKey: [club, 'system', 'site-domain'],
    queryFn: () => api.get<SiteDomain>('/system/site-domain'),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export async function saveSiteDomain(domain: string | null, primary: 'www' | 'apex'): Promise<SiteDomain> {
  const next = await api.put<SiteDomain>('/system/site-domain', { domain, primary });
  queryClient.setQueryData([host(), 'system', 'site-domain'], next);
  return next;
}

/** Адрес сайта для «Открыть» и превью праздников: домен с сертификатом или зеркало. */
export function siteUrlOf(domain: SiteDomain | undefined): string {
  if (domain?.url && domain.cert?.cert === 'active') return domain.url;
  return domain?.mirror ?? 'https://site.titanpos.ru';
}

/* ─────────────────────────── Публикации ─────────────────────────── */

export type StoryKind = 'tournament' | 'party' | 'event';
export type StoryStat = { value: string; label: string };
export type Story = {
  id: string;
  slug: string;
  title: string;
  tagline: string | null;
  kind: StoryKind;
  event_date: string | null;
  body: string | null;
  stats: StoryStat[];
  cover_url: string | null;
  photos: string[];
  results_url: string | null;
  gallery_url: string | null;
  is_published: boolean;
  sort_order: number;
};
export type StoryDraft = {
  slug: string;
  title: string;
  tagline: string;
  kind: StoryKind;
  eventDate: string | null;
  body: string;
  stats: StoryStat[];
  coverUrl: string | null;
  photos: string[];
  resultsUrl: string;
  galleryUrl: string;
  isPublished: boolean;
  sortOrder: number;
};

export const STORY_KINDS: { id: StoryKind; title: string }[] = [
  { id: 'tournament', title: 'Турнир' },
  { id: 'party', title: 'Вечеринка' },
  { id: 'event', title: 'Событие' },
];

export const EMPTY_STORY: StoryDraft = {
  slug: '', title: '', tagline: '', kind: 'tournament', eventDate: null, body: '', stats: [],
  coverUrl: null, photos: [], resultsUrl: '', galleryUrl: '', isPublished: false, sortOrder: 0,
};

export function draftOfStory(s: Story): StoryDraft {
  return {
    slug: s.slug, title: s.title, tagline: s.tagline ?? '', kind: s.kind, eventDate: s.event_date ? s.event_date.slice(0, 10) : null,
    body: s.body ?? '', stats: s.stats ?? [], coverUrl: s.cover_url, photos: s.photos ?? [], resultsUrl: s.results_url ?? '',
    galleryUrl: s.gallery_url ?? '', isPublished: s.is_published, sortOrder: s.sort_order,
  };
}

export function useSiteStories() {
  const club = useClubKey();
  return useQuery({
    queryKey: [club, 'site-admin', 'stories'],
    queryFn: () => api.get<{ stories: Story[] }>('/site-admin/stories').then((r) => r.stories),
    staleTime: 30_000,
  });
}

export async function saveStory(id: string | null, draft: StoryDraft): Promise<void> {
  if (id) await api.patch(`/site-admin/stories/${id}`, draft);
  else await api.post('/site-admin/stories', draft);
  invalidate(['site-admin', 'stories']);
}

export async function deleteStory(id: string): Promise<void> {
  await api.delete(`/site-admin/stories/${id}`);
  invalidate(['site-admin', 'stories']);
}

/** Фото сайта (/media/…) лежат на самом сайте — показываем их с зеркала. */
export const storyPhotoSrc = (url: string, mirror: string): string => (url.startsWith('/') ? `${mirror}${url}` : url);

const RU: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n',
  о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '',
  э: 'e', ю: 'yu', я: 'ya',
};

/** «Society Mafia Cup 2026» → «society-mafia-cup-2026» (адрес публикации на сайте). */
export function slugify(title: string): string {
  return title.toLowerCase().split('').map((ch) => RU[ch] ?? ch).join('')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}
