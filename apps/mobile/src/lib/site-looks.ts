import type { SFSymbol } from 'sf-symbols-typescript';

import type { SiteHoliday } from './site-api';

/**
 * Оформления сайта для выбора в HUB: обычный Liquid Glass и 11 праздников. Цвета
 * пятен подложки и акцента — те же, что в apps/site/src/styles/holiday.css, чтобы
 * превью в приложении совпадало с сайтом.
 */
export type SiteLookId = SiteHoliday | 'none';

export type SiteLook = {
  id: SiteLookId;
  title: string;
  hint: string;
  /** Три пятна света на подложке сайта. */
  blobs: [string, string, string];
  /** Акцентный цвет текста (выделенные слова, подписи). */
  accent: string;
  /** Частицы праздника (снег, сердца…); null — без частиц. */
  symbol: SFSymbol | null;
  particle: string;
};

export const SITE_LOOKS: SiteLook[] = [
  { id: 'none', title: 'Без праздника', hint: 'Обычный вид: жидкое стекло над ночным клубом',
    blobs: ['rgba(124,77,255,0.75)', 'rgba(52,92,255,0.6)', 'rgba(196,64,160,0.42)'], accent: '#C6B4FF', symbol: null, particle: '#FFFFFF' },
  { id: 'new_year', title: 'Новый год', hint: 'Снег, гирлянда и снеговик',
    blobs: ['rgba(80,140,255,0.7)', 'rgba(124,77,255,0.6)', 'rgba(60,200,220,0.38)'], accent: '#C6B4FF', symbol: 'snowflake', particle: '#FFFFFF' },
  { id: 'winter', title: 'Зима', hint: 'Тихий снегопад и холодный свет',
    blobs: ['rgba(110,160,255,0.62)', 'rgba(170,200,255,0.4)', 'rgba(124,77,255,0.35)'], accent: '#C6B4FF', symbol: 'snowflake', particle: '#E3EEFF' },
  { id: 'valentine', title: 'День влюблённых', hint: 'Летящие сердца, розовый свет',
    blobs: ['rgba(255,70,130,0.62)', 'rgba(160,60,220,0.5)', 'rgba(255,120,160,0.4)'], accent: '#FFB3CB', symbol: 'heart.fill', particle: '#FF8FB1' },
  { id: 'defender', title: '23 февраля', hint: 'Золотые звёзды',
    blobs: ['rgba(90,120,70,0.6)', 'rgba(60,80,160,0.5)', 'rgba(210,170,70,0.35)'], accent: '#F4D58D', symbol: 'star.fill', particle: '#F4C95D' },
  { id: 'womens_day', title: '8 Марта', hint: 'Лепестки и ветка мимозы',
    blobs: ['rgba(255,120,190,0.6)', 'rgba(160,110,255,0.5)', 'rgba(247,227,91,0.3)'], accent: '#FFC4E0', symbol: 'camera.macro', particle: '#FFB3D1' },
  { id: 'maslenitsa', title: 'Масленица', hint: 'Искры и солнце',
    blobs: ['rgba(255,150,60,0.58)', 'rgba(124,77,255,0.45)', 'rgba(255,210,90,0.36)'], accent: '#FFD39A', symbol: 'sun.max.fill', particle: '#FFB547' },
  { id: 'spring', title: 'Весна', hint: 'Лепестки сакуры',
    blobs: ['rgba(120,210,140,0.45)', 'rgba(255,150,200,0.45)', 'rgba(124,77,255,0.4)'], accent: '#C6B4FF', symbol: 'camera.macro', particle: '#FFD1E3' },
  { id: 'summer', title: 'Лето', hint: 'Солнечные блики',
    blobs: ['rgba(60,210,200,0.5)', 'rgba(255,200,90,0.42)', 'rgba(124,77,255,0.4)'], accent: '#A8F0E6', symbol: 'sun.max.fill', particle: '#FFE08A' },
  { id: 'autumn', title: 'Осень', hint: 'Падающие листья, тёплый свет',
    blobs: ['rgba(232,116,43,0.55)', 'rgba(160,60,40,0.45)', 'rgba(242,169,59,0.35)'], accent: '#FFC68A', symbol: 'leaf.fill', particle: '#F2A93B' },
  { id: 'halloween', title: 'Хэллоуин', hint: 'Летучие мыши, тыквы, паутина',
    blobs: ['rgba(255,120,30,0.55)', 'rgba(110,40,180,0.6)', 'rgba(60,200,90,0.25)'], accent: '#FFB070', symbol: 'moon.stars.fill', particle: '#FF8A3D' },
  { id: 'club_birthday', title: 'День рождения клуба', hint: 'Конфетти и воздушные шары',
    blobs: ['rgba(244,201,93,0.5)', 'rgba(155,123,255,0.6)', 'rgba(255,111,163,0.42)'], accent: '#F8DC8F', symbol: 'party.popper.fill', particle: '#F4C95D' },
];

export const lookOf = (id: SiteHoliday | null | undefined): SiteLook => SITE_LOOKS.find((l) => l.id === (id ?? 'none')) ?? SITE_LOOKS[0]!;

export const WEEKDAYS = ['', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];
export const EVENING_TITLES = ['Городская мафия', 'Спортивная мафия', 'Настольные игры', 'Детская мафия', 'Турнир'];

/** Значок и цвет вечера по названию — как форматы на сайте. */
export function eveningLook(title: string): { icon: SFSymbol; color: string } {
  const t = title.toLowerCase();
  if (t.includes('спорт')) return { icon: 'trophy.fill', color: '#FF9500' };
  if (t.includes('город')) return { icon: 'building.2.fill', color: '#AF52DE' };
  if (t.includes('настол')) return { icon: 'dice.fill', color: '#34C759' };
  if (t.includes('дет')) return { icon: 'figure.and.child.holdinghands', color: '#FF2D55' };
  if (t.includes('турнир')) return { icon: 'medal.fill', color: '#FFCC00' };
  return { icon: 'calendar', color: '#8E8E93' };
}
