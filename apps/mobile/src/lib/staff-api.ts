import { useQuery } from '@tanstack/react-query';

import { api } from './api';
import { queryClient } from './query';
import { useClubKey } from './queries';
import { useSession } from './session';

/**
 * Команда клуба. Сотрудник — это клиент клуба с правами: его выбирают из клиентов и
 * выдают роль; «убрать из команды» возвращает его в клиенты (история и баланс остаются).
 * Серверные роуты — modules/staff/staff.router.ts (только владелец).
 */

const host = () => useSession.getState().club?.host ?? 'none';
const invalidate = (...keys: unknown[][]) => {
  const club = host();
  for (const key of keys) void queryClient.invalidateQueries({ queryKey: [club, ...key] });
};

export type StaffRole = 'owner' | 'staff';

export type StaffRow = {
  id: string;
  nickname: string;
  fullName: string | null;
  phone: string | null;
  role: StaffRole;
  permissions: Record<string, boolean> | null;
  tgId: string | null;
  tgUsername: string | null;
  photoUrl: string | null;
  clientTier: string;
  salarySchemeId: string | null;
  hasPin: boolean;
  onShift: boolean;
  createdAt: string;
};

export type StaffCandidate = {
  id: string;
  nickname: string;
  fullName: string | null;
  phone: string | null;
  photoUrl: string | null;
  clientTier: string;
  tierLabel: string | null;
  tierColor: string | null;
  tgLinked: boolean;
};

/** Права сотрудника на разделы «Управления» (зеркало apps/api/src/lib/permissions.ts). */
export const PERMISSIONS: { key: string; label: string; hint: string; defaultOn: boolean }[] = [
  { key: 'menu', label: 'Меню', hint: 'Позиции и цены', defaultOn: true },
  { key: 'inventory', label: 'Склад', hint: 'Остатки, поставки, списания', defaultOn: true },
  { key: 'clients', label: 'Клиенты', hint: 'Профили и статусы', defaultOn: true },
  { key: 'discounts', label: 'Скидки и сертификаты', hint: 'Настройка скидок, выпуск сертификатов', defaultOn: true },
  { key: 'bonus', label: 'Бонусы', hint: 'Начисление и списание вручную', defaultOn: true },
  { key: 'debtors', label: 'Депозиты, долги и сборы', hint: 'Деньги клиентов', defaultOn: false },
  { key: 'expenses', label: 'Расходы', hint: 'Траты клуба', defaultOn: false },
  { key: 'staff', label: 'Персонал', hint: 'Видеть команду', defaultOn: false },
  { key: 'salary', label: 'Зарплата', hint: 'Видеть выплаты', defaultOn: false },
  { key: 'about', label: 'О заведении', hint: 'Адрес, часы, контакты', defaultOn: true },
];

export const permissionOn = (row: { permissions: Record<string, boolean> | null | undefined }, key: string) =>
  row.permissions?.[key] ?? PERMISSIONS.find((p) => p.key === key)?.defaultOn ?? true;

/** Права по умолчанию — для нового сотрудника. */
export const defaultPermissions = (): Record<string, boolean> => Object.fromEntries(PERMISSIONS.map((p) => [p.key, p.defaultOn]));

export function useStaffAdmin(enabled: boolean) {
  const club = useClubKey();
  return useQuery({
    queryKey: [club, 'staff', 'admin'],
    queryFn: () => api.get<{ staff: StaffRow[] }>('/staff').then((r) => r.staff),
    enabled,
    staleTime: 15_000,
  });
}

/** Клиенты, которых можно взять в команду (поиск по нику, имени, телефону). */
export function useStaffCandidates(q: string) {
  const club = useClubKey();
  return useQuery({
    queryKey: [club, 'staff', 'candidates', q],
    queryFn: () => api.get<{ candidates: StaffCandidate[] }>(`/staff/candidates?q=${encodeURIComponent(q)}`).then((r) => r.candidates),
    staleTime: 15_000,
    placeholderData: (prev) => prev,
  });
}

export function useStaffPasskeys(staffId: string, enabled: boolean) {
  const club = useClubKey();
  return useQuery({
    queryKey: [club, 'staff', staffId, 'passkeys'],
    queryFn: () => api.get<{ passkeys: { id: string; deviceType: string | null; backedUp: boolean | null; createdAt: string }[] }>(`/staff/${staffId}/passkeys`).then((r) => r.passkeys),
    enabled,
    staleTime: 30_000,
  });
}

/** Клиент → сотрудник (или владелец) с правами. */
export async function promoteToStaff(profileId: string, role: StaffRole, permissions: Record<string, boolean>): Promise<void> {
  await api.post('/staff/promote', { profileId, role, permissions });
  invalidate(['staff'], ['clients']);
}

export async function updateStaff(staffId: string, patch: { role?: StaffRole; permissions?: Record<string, boolean>; salarySchemeId?: string | null; phone?: string }): Promise<void> {
  await api.patch(`/staff/${staffId}`, patch);
  invalidate(['staff'], ['me'], ['salary']);
}

export async function resetStaffPin(staffId: string, pin: string): Promise<void> {
  await api.post(`/staff/${staffId}/reset-pin`, { pin });
  invalidate(['staff']);
}

/** Убрать из команды: профиль остаётся клиентом, вход в HUB, PIN и права снимаются. */
export async function removeFromTeam(staffId: string): Promise<void> {
  await api.delete(`/staff/${staffId}`);
  invalidate(['staff'], ['clients']);
}

export async function deleteStaffPasskey(staffId: string, passkeyId: string): Promise<void> {
  await api.delete(`/staff/${staffId}/passkeys/${passkeyId}`);
  invalidate(['staff', staffId, 'passkeys']);
}

export async function staffTelegramLink(staffId: string): Promise<{ deepLink: string; linked: boolean; tgUsername: string | null }> {
  return api.post<{ deepLink: string; linked: boolean; tgUsername: string | null }>(`/staff/${staffId}/telegram-link`, {});
}

/** Настройки «Касса для команды» (app_settings): списание включено, кому, владельцам. */
export const STAFF_COMP_KEYS = { enabled: 'staff_discount_enabled', scope: 'staff_comp_scope', owners: 'staff_comp_owners' } as const;
