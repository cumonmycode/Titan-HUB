import { useQuery } from '@tanstack/react-query';
import type { SFSymbol } from 'sf-symbols-typescript';

import { api } from './api';
import { queryClient } from './query';
import { useClubKey } from './queries';
import { useSession } from './session';
import type { NumericString } from './types';

/**
 * «Расходы» клуба (apps/api/src/modules/expenses): аренда, коммуналка, маркетинг,
 * расходники — всё, что не приход на склад. Зарплата живёт в своём разделе, а сводка
 * расходов показывает её рядом (выплаты + угощения сотрудникам по себестоимости).
 * Раздел вынесен из «Склада» (2026-10-08): к товарам он не относится.
 */

const host = () => useSession.getState().club?.host ?? 'none';

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

function refreshExpenses() {
  void queryClient.invalidateQueries({ queryKey: [host(), 'expenses'] });
}

export type ExpenseCategory = 'rent' | 'utilities' | 'supplies' | 'salary' | 'marketing' | 'equipment' | 'other' | 'consumables' | 'tobacco';

export type ExpenseRow = {
  id: string;
  category: ExpenseCategory;
  amount: NumericString;
  description: string | null;
  unitPrice: NumericString | null;
  quantity: NumericString | null;
  /** YYYY-MM-DD. */
  expenseDate: string;
  /** Расход мероприятия (миникапа) — правится только из мероприятия. */
  eventId: string | null;
  createdAt: string;
};

export type StaffCostRow = {
  staffId: string;
  nickname: string;
  role: string | null;
  salary: number;
  salaryCash: number;
  salaryTransfer: number;
  salaryCount: number;
  compCost: number;
  compRetail: number;
  compChecks: number;
  total: number;
  photoUrl: string | null;
};

export type ExpensesSummary = {
  period: { from: string; to: string };
  categories: { category: ExpenseCategory; amount: number }[];
  opexTotal: number;
  salary: { total: number; cash: number; transfer: number };
  staffComp: { cost: number; retail: number; checksCount: number };
  byStaff: StaffCostRow[];
  pnlTotal: number;
  staffTotal: number;
  expenses: ExpenseRow[];
};

export type ExpenseCatalogItem = { name: string; unitPrice: number | null; category: ExpenseCategory };

export const EXPENSE_CATEGORIES: Record<ExpenseCategory, { label: string; symbol: SFSymbol; color: string }> = {
  rent: { label: 'Аренда', symbol: 'building.2.fill', color: '#8B5CF6' },
  utilities: { label: 'Коммунальные', symbol: 'bolt.fill', color: '#F59E0B' },
  supplies: { label: 'Закупки вне склада', symbol: 'shippingbox.fill', color: '#10B981' },
  consumables: { label: 'Расходники', symbol: 'drop.fill', color: '#06B6D4' },
  tobacco: { label: 'Табак', symbol: 'smoke.fill', color: '#A16207' },
  salary: { label: 'Зарплата', symbol: 'person.crop.circle.badge.checkmark', color: '#3B82F6' },
  marketing: { label: 'Маркетинг', symbol: 'megaphone.fill', color: '#EC4899' },
  equipment: { label: 'Оборудование', symbol: 'wrench.and.screwdriver.fill', color: '#64748B' },
  other: { label: 'Прочее', symbol: 'ellipsis.circle.fill', color: '#94A3B8' },
};

/** Категории, которые можно выбрать для нового расхода: зарплата живёт в своём разделе. */
export const EXPENSE_CATEGORY_CHOICES: ExpenseCategory[] = ['rent', 'utilities', 'supplies', 'consumables', 'tobacco', 'marketing', 'equipment', 'other'];

export function useExpensesSummary(from: string, to: string) {
  const club = useClubKey();
  return useQuery({
    queryKey: [club, 'expenses', from, to],
    queryFn: () => api.get<ExpensesSummary>(`/expenses/summary?from=${from}&to=${to}`),
    staleTime: 15_000,
    placeholderData: (previous) => previous,
  });
}

export function useExpenseCatalog(query: string) {
  const club = useClubKey();
  const q = query.trim();
  return useQuery({
    queryKey: [club, 'expenses', 'catalog', q],
    queryFn: ({ signal }) => api.get<{ items: ExpenseCatalogItem[] }>(`/expenses/catalog?q=${encodeURIComponent(q)}`, { signal }).then((r) => r.items),
    enabled: q.length >= 2,
    staleTime: 60_000,
  });
}

export type ExpenseLineInput = { category: ExpenseCategory; description: string; unitPrice: number; quantity: number };

export async function createExpenses(expenseDate: string, lines: ExpenseLineInput[], idempotencyKey: string): Promise<void> {
  const items = lines
    .map((l) => ({
      category: l.category,
      ...(l.description.trim() ? { description: l.description.trim() } : {}),
      unitPrice: l.unitPrice,
      quantity: l.quantity,
      amount: round2(l.unitPrice * l.quantity),
    }))
    .filter((l) => l.amount > 0);
  try {
    await api.post('/expenses', { expenseDate, items, idempotencyKey });
  } finally {
    refreshExpenses();
  }
}

export async function deleteExpense(expenseId: string): Promise<void> {
  await api.delete(`/expenses/${expenseId}`);
  refreshExpenses();
}
