/** Постоянные факты о клубе: контакты, соцсети, навигация. Цены и расписание — из HUB. */

export const SITE = {
  name: 'TITAN KBR',
  nameRu: 'Титан КБР',
  since: 2017,
  formerName: 'Red Empire',
  url: 'https://www.titanmafia.ru',
  city: 'Нальчик',
  address: 'Нальчик, ул. Кабардинская, 152',
  phone: '+7 965 666-07-00',
  phoneHref: 'tel:+79656660700',
  email: 'info@titanmafia.ru',
  mapUrl: 'https://yandex.ru/maps/?text=%D0%9D%D0%B0%D0%BB%D1%8C%D1%87%D0%B8%D0%BA%2C%20%D0%9A%D0%B0%D0%B1%D0%B0%D1%80%D0%B4%D0%B8%D0%BD%D1%81%D0%BA%D0%B0%D1%8F%20152',
  slogan: 'Найди мафию, прежде чем она найдёт тебя',
} as const

export interface SocialLink { id: 'telegram' | 'channel' | 'whatsapp' | 'vk' | 'instagram'; label: string; href: string }

export const SOCIALS: SocialLink[] = [
  { id: 'telegram', label: 'Telegram', href: 'https://t.me/titanmafia' },
  { id: 'whatsapp', label: 'WhatsApp', href: 'https://wa.me/79656660700' },
  { id: 'channel', label: 'Канал', href: 'https://t.me/titankbr' },
  { id: 'vk', label: 'ВКонтакте', href: 'https://vk.com/titan.nalchik' },
  { id: 'instagram', label: 'Instagram', href: 'https://www.instagram.com/titankbr' },
]

export const GOMAFIA = {
  club: 'https://gomafia.pro/club/40',
  register: 'https://gomafia.pro/register',
} as const

/** Виртуальная кэшбэк-карта клуба (была на Wix-сайте). */
export const WALLET_CARD_URL = 'https://passl.ink/yM7HU'

export interface NavItem { href: string; label: string }

export const NAV: NavItem[] = [
  { href: '/games', label: 'Игры' },
  { href: '/events', label: 'Праздники' },
  { href: '/portfolio', label: 'Турниры' },
  { href: '/residents', label: 'Резидентам' },
  { href: '/studio', label: 'О клубе' },
  { href: '/contact', label: 'Контакты' },
]

export const FOOTER_LINKS: NavItem[] = [
  { href: '/kidspromo', label: 'Детская мафия' },
  { href: '/promoinfo', label: 'Активировать сертификат' },
  { href: '/privacy-policy', label: 'Политика конфиденциальности' },
  { href: '/terms-and-conditions', label: 'Пользовательское соглашение' },
  { href: '/refund-policy', label: 'Отмена и возврат' },
]

/** Верификации поисковиков — перенесены с Wix, чтобы не потерять Search Console / Вебмастер. */
export const VERIFICATION = {
  google: 'X19PDtJc2LTatuH8ALPuDQo5FmGkSl3meSbv2q78Dn4',
  yandex: 'f8bcb83b09b11136',
  bing: 'B9BC0B7666AEAC8C81A3741FA288F5FC',
} as const
