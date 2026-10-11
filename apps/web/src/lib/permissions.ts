/**
 * Права сотрудника (profiles.permissions). Невыставленное право берёт умолчание —
 * то же, что показывает карточка сотрудника, иначе тумблер «выкл» не совпадал бы с
 * тем, что сотрудник видит на самом деле (зеркало apps/mobile/src/lib/admin-api.ts).
 */
export const DEFAULT_PERMISSIONS: Record<string, boolean> = {
  menu: true, inventory: true, supplies: true, clients: true,
  discounts: true, bonus: true, expenses: false, debtors: false,
  staff: false, salary: false, about: true,
}

export const permissionOn = (permissions: Record<string, boolean> | null | undefined, key: string): boolean =>
  permissions?.[key] ?? DEFAULT_PERMISSIONS[key] ?? true
