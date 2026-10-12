import type { SFSymbol } from 'sf-symbols-typescript';

import { permissionOn } from './admin-api';

/**
 * Разделы «Управления» — список в духе «Настроек» iOS: сверху профиль, дальше группы
 * по смыслу работы клуба. Раздел виден, если роль входит в `roles`; сотруднику — если
 * право включено (`permissionOn`: явное значение, иначе умолчание права, как на
 * карточке сотрудника). Владелец видит всё.
 */

export type ManageSectionKey =
  | 'goods'
  | 'pricing'
  | 'screens'
  | 'clients'
  | 'customers'
  | 'balances'
  | 'loyalty'
  | 'collections'
  | 'polls'
  | 'broadcasts'
  | 'staff'
  | 'shifts'
  | 'salary'
  | 'expenses'
  | 'settings'
  | 'tai'
  | 'about';

export type ManageSection = {
  key: ManageSectionKey;
  title: string;
  /** Что внутри — вторая строка пункта, чтобы не гадать по названию. */
  subtitle: string;
  icon: SFSymbol;
  /** Цвет плашки значка (системные цвета iOS). */
  color: string;
  roles: ('owner' | 'staff')[];
  /** Право сотрудника; несколько — раздел виден, если открыто хотя бы одно. */
  perm?: string | string[];
};

export const MANAGE_GROUPS: { title: string; items: ManageSection[] }[] = [
  {
    title: 'Касса и меню',
    items: [
      { key: 'goods', title: 'Товары', subtitle: 'Меню, ингредиенты и склад', icon: 'shippingbox', color: '#FF9500', roles: ['owner', 'staff'], perm: ['menu', 'inventory'] },
      { key: 'pricing', title: 'Тарифы и аренда', subtitle: 'Статусы, зоны, пакеты мероприятий', icon: 'tag', color: '#30B0C7', roles: ['owner', 'staff'] },
      { key: 'screens', title: 'Экраны', subtitle: 'Телевизоры: меню и слайдшоу', icon: 'tv', color: '#8B5CF6', roles: ['owner', 'staff'] },
    ],
  },
  {
    title: 'Клиенты',
    items: [
      { key: 'clients', title: 'Клиенты', subtitle: 'Профили, статусы, Telegram', icon: 'person.2', color: '#007AFF', roles: ['owner', 'staff'], perm: 'clients' },
      { key: 'balances', title: 'Депозиты и долги', subtitle: 'Кто должен и у кого депозит', icon: 'wallet.bifold', color: '#34C759', roles: ['owner', 'staff'], perm: 'debtors' },
      { key: 'collections', title: 'Сбор средств', subtitle: 'Фонд клуба и разовые сборы', icon: 'banknote', color: '#00C7BE', roles: ['owner', 'staff'], perm: 'debtors' },
      { key: 'loyalty', title: 'Лояльность', subtitle: 'Бонусы, скидки, статусы', icon: 'gift', color: '#FF2D55', roles: ['owner', 'staff'], perm: ['discounts', 'bonus'] },
      { key: 'customers', title: 'Заказчики', subtitle: 'Компании и организаторы событий', icon: 'briefcase', color: '#5856D6', roles: ['owner', 'staff'] },
      { key: 'broadcasts', title: 'Рассылки', subtitle: 'Push и сообщения клиентам', icon: 'megaphone', color: '#AF52DE', roles: ['owner'] },
      { key: 'polls', title: 'Опросы', subtitle: 'Опросы в чатах клуба', icon: 'checklist', color: '#FF3B30', roles: ['owner'] },
    ],
  },
  {
    title: 'Команда',
    items: [
      { key: 'staff', title: 'Сотрудники', subtitle: 'Доступы, роли, PIN', icon: 'person.badge.key', color: '#8E8E93', roles: ['owner'] },
      { key: 'shifts', title: 'Смены', subtitle: 'История смен и отчёты', icon: 'clock', color: '#AF52DE', roles: ['owner', 'staff'] },
      { key: 'salary', title: 'Зарплата', subtitle: 'Начисления и выплаты', icon: 'rublesign', color: '#32ADE6', roles: ['owner'], perm: 'salary' },
      { key: 'expenses', title: 'Расходы', subtitle: 'Аренда, коммуналка, маркетинг', icon: 'banknote', color: '#A2845E', roles: ['owner', 'staff'], perm: 'expenses' },
    ],
  },
  {
    title: 'Клуб',
    items: [
      { key: 'settings', title: 'Настройки клуба', subtitle: 'Заведение, касса, оплата, бронь', icon: 'gearshape', color: '#8E8E93', roles: ['owner'] },
      { key: 'tai', title: 'Tai', subtitle: 'Голос, клиенты в Telegram, чаты', icon: 'sparkles', color: '#8B5CF6', roles: ['owner'] },
      { key: 'about', title: 'О системе', subtitle: 'Версия, подписка, модули', icon: 'info.circle', color: '#8E8E93', roles: ['owner'] },
    ],
  },
];

export function visibleManageGroups(role: string, permissions: Record<string, boolean> | null) {
  const isOwner = role === 'owner';
  return MANAGE_GROUPS.map((group) => ({
    title: group.title,
    items: group.items
      .filter((item) => item.roles.includes(isOwner ? 'owner' : 'staff'))
      .filter((item) => isOwner || !item.perm || [item.perm].flat().some((perm) => permissionOn({ permissions }, perm))),
  })).filter((group) => group.items.length > 0);
}
