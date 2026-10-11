// Корзина гостя: уходит одним заказом персоналу на подтверждение.
import { create } from 'zustand';

import type { MenuItem } from '@/data/types';

export type CartLine = { item: MenuItem; quantity: number };

export function addLine(lines: CartLine[], item: MenuItem): CartLine[] {
  const i = lines.findIndex((l) => l.item.id === item.id);
  if (i < 0) return [...lines, { item, quantity: 1 }];
  return lines.map((l, j) => (j === i ? { ...l, quantity: l.quantity + 1 } : l));
}

export function removeLine(lines: CartLine[], itemId: string): CartLine[] {
  const line = lines.find((l) => l.item.id === itemId);
  if (!line) return lines;
  if (line.quantity <= 1) return lines.filter((l) => l.item.id !== itemId);
  return lines.map((l) => (l.item.id === itemId ? { ...l, quantity: l.quantity - 1 } : l));
}

export function cartSummary(lines: CartLine[]) {
  return {
    count: lines.reduce((s, l) => s + l.quantity, 0),
    total: Math.round(lines.reduce((s, l) => s + l.item.price * l.quantity, 0) * 100) / 100,
  };
}

export const qtyOf = (lines: CartLine[], itemId: string) => lines.find((l) => l.item.id === itemId)?.quantity ?? 0;

type CartState = { lines: CartLine[]; add: (item: MenuItem) => void; remove: (itemId: string) => void; clear: () => void };

export const useCart = create<CartState>()((set) => ({
  lines: [],
  add: (item) => set((s) => ({ lines: addLine(s.lines, item) })),
  remove: (itemId) => set((s) => ({ lines: removeLine(s.lines, itemId) })),
  clear: () => set({ lines: [] }),
}));
