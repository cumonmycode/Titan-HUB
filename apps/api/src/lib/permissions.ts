/**
 * Права сотрудника (profiles.permissions). Невыставленное право берёт умолчание —
 * то же, что показывают клиенты (зеркало apps/web/src/lib/permissions.ts и
 * apps/mobile/src/lib/admin-api.ts PERMISSIONS), иначе сервер и UI разойдутся.
 */
export const DEFAULT_PERMISSIONS: Record<string, boolean> = {
  menu: true, inventory: true, supplies: true, clients: true,
  discounts: true, bonus: true, expenses: false, debtors: false,
  staff: false, salary: false, about: true,
}

/** Подписи прав — для понятного текста отказа (как в карточке сотрудника). */
export const PERMISSION_LABELS: Record<string, string> = {
  menu: 'Меню', inventory: 'Склад', supplies: 'Поставки', clients: 'Клиенты',
  discounts: 'Скидки', bonus: 'Бонусы', debtors: 'Депозиты, долги и сборы',
  expenses: 'Расходы', staff: 'Персонал', salary: 'Зарплата', about: 'О заведении',
}

export const permissionOn = (permissions: Record<string, boolean> | null | undefined, key: string): boolean =>
  permissions?.[key] ?? DEFAULT_PERMISSIONS[key] ?? true
