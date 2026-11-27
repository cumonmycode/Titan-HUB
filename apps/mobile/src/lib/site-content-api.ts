import { useQuery } from '@tanstack/react-query';
import type { SFSymbol } from 'sf-symbols-typescript';

import { api } from './api';
import { queryClient } from './query';
import { useClubKey } from './queries';
import { useSession } from './session';

/**
 * Содержимое сайта клуба (сервер — modules/site/content.ts): приложение HUB и есть CMS.
 * Форматы, команда, отзывы, ценности, документы и тексты страниц; сайт берёт их из HUB
 * при рендере (кэш до минуты). Раздел, который не меняли, — тексты сайта по умолчанию.
 */

export type FormatId = 'city' | 'sport' | 'board' | 'kids' | 'corporate' | 'party';
export type FormatItem = { id: FormatId; title: string; short: string; text: string; photo: string; hidden: boolean };
export type TeamItem = { profileId: string | null; name: string; role: string; photo: string };
export type ReviewItem = { author: string; text: string };
export type ValueItem = { title: string; text: string };
export type DocItem = { title: string; text: string; href: string; cover: string };
export type PageId = 'home' | 'games' | 'events' | 'kids' | 'studio' | 'residents' | 'contact';
export type PageItem = { title: string; lead: string; text: string[] };

export type SiteContent = {
  formats: FormatItem[];
  team: TeamItem[];
  reviews: ReviewItem[];
  values: ValueItem[];
  docs: DocItem[];
  pages: Record<PageId, PageItem>;
};
export type SectionId = keyof SiteContent;
export type ListSectionId = Exclude<SectionId, 'pages'>;
export type ListItem = FormatItem | TeamItem | ReviewItem | ValueItem | DocItem;
export type StaffRef = { id: string; nickname: string; fullName: string | null; photoUrl: string | null; role: string };
export type SiteContentState = { content: SiteContent; edited: SectionId[]; defaults: SiteContent; staff: StaffRef[] };

const key = (club: string) => [club, 'system', 'site-content'];

export function useSiteContent() {
  const club = useClubKey();
  return useQuery({ queryKey: key(club), queryFn: () => api.get<SiteContentState>('/system/site-content') });
}

/** Сохранить раздел целиком; null — вернуть тексты сайта по умолчанию. */
export async function saveContentSection(section: SectionId, value: unknown): Promise<void> {
  const club = useSession.getState().club?.host ?? 'none';
  const r = await api.put<Pick<SiteContentState, 'content' | 'edited'>>(`/system/site-content/${section}`, { value });
  queryClient.setQueryData<SiteContentState>(key(club), (old) => (old ? { ...old, ...r } : old));
}

export const SECTION_LOOK: Record<SectionId, { title: string; item: string; icon: SFSymbol; color: string; about: string }> = {
  formats: { title: 'Форматы', item: 'Формат', icon: 'square.grid.2x2.fill', color: '#FF9500', about: 'Карточки на главной, в «Играх» и «Праздниках». Скрытый формат пропадает с сайта.' },
  team: { title: 'Команда', item: 'Участник', icon: 'person.2.fill', color: '#5856D6', about: 'Раздел «Команда» на странице «О клубе». Сотрудник клуба — имя и фото из его карточки.' },
  reviews: { title: 'Отзывы', item: 'Отзыв', icon: 'quote.bubble.fill', color: '#34C759', about: 'Лента отзывов на главной и в «О клубе».' },
  values: { title: 'Ценности', item: 'Ценность', icon: 'heart.fill', color: '#FF2D55', about: '«Что для нас важно» на странице «О клубе».' },
  docs: { title: 'Документы', item: 'Документ', icon: 'book.fill', color: '#A2845E', about: '«Важная литература» для резидентов: ссылка на PDF и обложка.' },
  pages: { title: 'Тексты страниц', item: 'Страница', icon: 'doc.text.fill', color: '#8E8E93', about: 'Заголовок и подзаголовок вверху каждого раздела сайта.' },
};

export const PAGE_LOOK: Record<PageId, { title: string; about: string }> = {
  home: { title: 'Главная', about: 'На главной меняется подзаголовок под фирменным заголовком.' },
  games: { title: 'Игры', about: '/games — вечера, расписание и цены.' },
  events: { title: 'Праздники', about: '/events — дни рождения, корпоративы, выезд.' },
  kids: { title: 'Детская мафия', about: '/kidspromo — абзацы идут в блок «Почему детям нравится».' },
  studio: { title: 'О клубе', about: '/studio — абзацы появятся под заголовком.' },
  residents: { title: 'Резидентам', about: '/residents — литература, рейтинг, приложение.' },
  contact: { title: 'Контакты', about: '/contact — адрес, телефон и форма.' },
};

export const PAGE_IDS: PageId[] = ['home', 'games', 'events', 'kids', 'studio', 'residents', 'contact'];

/** Подпись строки списка. */
export function itemTitle(section: ListSectionId, item: ListItem): { title: string; subtitle?: string } {
  switch (section) {
    case 'formats': {
      const f = item as FormatItem;
      return { title: f.title, subtitle: f.hidden ? 'скрыт на сайте' : f.short };
    }
    case 'team': {
      const t = item as TeamItem;
      return { title: t.name || 'Без имени', subtitle: t.role };
    }
    case 'reviews': {
      const r = item as ReviewItem;
      return { title: r.author, subtitle: r.text };
    }
    case 'values': {
      const v = item as ValueItem;
      return { title: v.title, subtitle: v.text };
    }
    case 'docs': {
      const d = item as DocItem;
      return { title: d.title, subtitle: d.href };
    }
  }
}

/** Пустой элемент для «Добавить» (форматы не добавляются — их набор задаёт сайт). */
export function blankItem(section: Exclude<ListSectionId, 'formats'>): ListItem {
  switch (section) {
    case 'team':
      return { profileId: null, name: '', role: 'Ведущий', photo: '' };
    case 'reviews':
      return { author: '', text: '' };
    case 'values':
      return { title: '', text: '' };
    case 'docs':
      return { title: '', text: '', href: '', cover: '' };
  }
}
