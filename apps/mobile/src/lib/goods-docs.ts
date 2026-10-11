import { useQuery } from '@tanstack/react-query';

import { api } from './api';
import { refreshGoods, type Unit } from './goods-api';
import { useClubKey } from './queries';

/**
 * Документы склада раздела «Товары»: приход (/supplies), списание (/goods/write-offs) и
 * ревизия (/inventory/revisions). У каждого есть черновик — он сохраняется сам, пока
 * документ правят, и остатков не трогает. Проведение меняет остатки и пишет журнал.
 *
 * Правила денег и склада:
 * - проведение прихода и списания идемпотентно по ключу (двойное нажатие не задвоит);
 *   ревизия идемпотентна по смыслу — факт ставится абсолютным числом;
 * - количество у товара с карточкой — целое в его единице (шт, г, мл);
 * - `null` в необязательных полях тела сервер отклоняет — такие ключи опускаем.
 */

/* ─────────────────────────── Приход ─────────────────────────── */

export type SupplyLine = { itemId: string | null; name: string; quantity: number; costPerUnit: number; packs?: number | null };

export type SupplyHeader = {
  supplier: string;
  /** Наличными из кассы смены — приход становится выдачей из кассы. */
  fromRegister: boolean;
};

export type SupplyDetail = {
  supply: {
    id: string;
    status: 'draft' | 'posted';
    supplier: string | null;
    note: string | null;
    totalCost: string;
    paymentMethod: 'cash' | 'card' | 'transfer';
    cashOperationId: string | null;
    createdAt: string;
    draftData: {
      supplier?: string;
      fromRegister?: boolean;
      items: { itemId?: string | null; name?: string; quantity: number; costPerUnit: number; packs?: number | null }[];
    } | null;
  };
  items: { itemId: string | null; name: string; unit: string; stockUnit?: Unit | null; quantity: number; costPerUnit: number; packs?: number | null }[];
  corrections: { id: string; reason: string; totalBefore: number; totalAfter: number; createdAt: string }[];
};

const supplyLineBody = (line: SupplyLine) => ({
  ...(line.itemId ? { itemId: line.itemId } : {}),
  ...(line.name.trim() ? { name: line.name.trim() } : {}),
  quantity: line.quantity,
  costPerUnit: line.costPerUnit,
  ...(line.packs ? { packs: line.packs } : {}),
});

const supplyHeaderBody = (header: SupplyHeader) => ({
  ...(header.supplier.trim() ? { supplier: header.supplier.trim() } : {}),
  fromRegister: header.fromRegister,
  paymentMethod: header.fromRegister ? 'cash' : 'transfer',
});

export function useSupply(supplyId: string | undefined) {
  const club = useClubKey();
  return useQuery({
    queryKey: [club, 'goods', 'supply', supplyId],
    queryFn: () => api.get<SupplyDetail>(`/supplies/${supplyId}`),
    enabled: !!supplyId,
    // Редактор черновика ждёт свежего ответа (isFetchedAfterMount): кэш с диска мог устареть.
    refetchOnMount: 'always',
  });
}

/** Провести приход: новый (с ключом идемпотентности) или из черновика. */
export async function postSupply(draftId: string | null, header: SupplyHeader, lines: SupplyLine[], idempotencyKey: string): Promise<{ duplicate: boolean }> {
  try {
    const body = { ...supplyHeaderBody(header), items: lines.map(supplyLineBody) };
    if (draftId) {
      await api.post(`/supplies/${draftId}/apply`, body);
      return { duplicate: false };
    }
    const r = await api.post<{ duplicate?: boolean }>('/supplies', { ...body, idempotencyKey });
    return { duplicate: !!r.duplicate };
  } finally {
    refreshGoods();
  }
}

export async function saveSupplyDraft(draftId: string | null, header: SupplyHeader, lines: SupplyLine[]): Promise<string> {
  const r = await api.post<{ id: string }>('/supplies/draft', {
    ...(draftId ? { id: draftId } : {}),
    ...supplyHeaderBody(header),
    items: lines.map(supplyLineBody),
  });
  refreshGoods();
  return r.id;
}

/** Корректировка проведённого прихода: новый состав и обязательная причина (аудит). */
export async function correctSupply(supplyId: string, lines: SupplyLine[], reason: string): Promise<void> {
  try {
    await api.patch(`/supplies/${supplyId}`, { reason, items: lines.map(supplyLineBody) });
  } finally {
    refreshGoods();
  }
}

/** Черновик удаляет любой сотрудник; проведённый приход — владелец, с откатом остатков. */
export async function deleteSupply(supplyId: string): Promise<void> {
  try {
    await api.delete(`/supplies/${supplyId}`);
  } finally {
    refreshGoods();
  }
}

/* ─────────────────────────── Списание ─────────────────────────── */

export type WriteOffLine = { itemId: string; quantity: number };

export type WriteOffDetail = {
  writeOff: {
    id: string;
    status: 'draft' | 'posted';
    reason: string;
    note: string | null;
    totalCost: string;
    createdAt: string;
    author: string | null;
    draftData: { reason?: string; note?: string; items: WriteOffLine[] } | null;
  };
  items: { id: string; itemId: string; name: string; quantity: number; unitCost: string; unit?: Unit }[];
};

export const WRITE_OFF_REASONS = ['Бой', 'Порча', 'Истёк срок', 'Угощение', 'Персоналу'];

export function useWriteOff(writeOffId: string | undefined) {
  const club = useClubKey();
  return useQuery({
    queryKey: [club, 'goods', 'write-off', writeOffId],
    queryFn: () => api.get<WriteOffDetail>(`/goods/write-offs/${writeOffId}`),
    enabled: !!writeOffId,
    // Редактор черновика ждёт свежего ответа (isFetchedAfterMount): кэш с диска мог устареть.
    refetchOnMount: 'always',
  });
}

export async function postWriteOff(draftId: string | null, reason: string, note: string, lines: WriteOffLine[], idempotencyKey: string): Promise<void> {
  try {
    const body = { reason, ...(note.trim() ? { note: note.trim() } : {}), items: lines };
    if (draftId) await api.post(`/goods/write-offs/${draftId}/apply`, body);
    else await api.post('/goods/write-offs', { ...body, idempotencyKey });
  } finally {
    refreshGoods();
  }
}

export async function saveWriteOffDraft(draftId: string | null, reason: string, note: string, lines: WriteOffLine[]): Promise<string> {
  const r = await api.post<{ id: string }>('/goods/write-offs/draft', {
    ...(draftId ? { id: draftId } : {}),
    reason,
    ...(note.trim() ? { note: note.trim() } : {}),
    items: lines,
  });
  refreshGoods();
  return r.id;
}

/** Черновик удаляет любой сотрудник; проведённое списание отменяет владелец — товар вернётся. */
export async function deleteWriteOff(writeOffId: string): Promise<void> {
  try {
    await api.delete(`/goods/write-offs/${writeOffId}`);
  } finally {
    refreshGoods();
  }
}

/* ─────────────────────────── Ревизия ─────────────────────────── */

export type RevisionLine = { itemId: string; actual: number | null };

export type RevisionDetail = {
  revision: {
    id: string;
    status: 'draft' | 'applied';
    createdAt: string;
    updatedAt: string | null;
    author: string | null;
    isLatest: boolean;
    draftData: { items: RevisionLine[] } | null;
  };
  items: { id: string; itemId: string; name: string; expected: number; actual: number; costPrice: string; sortOrder: number; unit?: Unit }[];
};

export function useRevision(revisionId: string | undefined) {
  const club = useClubKey();
  return useQuery({
    queryKey: [club, 'goods', 'revision', revisionId],
    queryFn: () => api.get<RevisionDetail>(`/inventory/revisions/${revisionId}`),
    enabled: !!revisionId,
    // Редактор черновика ждёт свежего ответа (isFetchedAfterMount): кэш с диска мог устареть.
    refetchOnMount: 'always',
  });
}

/** Провести ревизию: остатки посчитанных позиций станут равны факту. Возвращает id ревизии. */
export async function postRevision(draftId: string | null, lines: { itemId: string; actual: number }[]): Promise<string> {
  try {
    if (draftId) {
      await api.post(`/inventory/revisions/${draftId}/apply`, { items: lines });
      return draftId;
    }
    return (await api.post<{ revision: { id: string } }>('/inventory/revisions', { items: lines })).revision.id;
  } finally {
    refreshGoods();
  }
}

export async function saveRevisionDraft(draftId: string | null, lines: RevisionLine[]): Promise<string> {
  const r = await api.post<{ id: string }>('/inventory/revisions/draft', { ...(draftId ? { id: draftId } : {}), items: lines });
  refreshGoods();
  return r.id;
}

/** Правка последней проведённой ревизии: остаток сдвигается на разницу нового и старого факта. */
export async function correctRevision(
  revisionId: string,
  lines: { id: string; actual: number }[],
): Promise<{ name: string; from: number; to: number; stockDelta: number }[]> {
  try {
    return (
      await api.patch<{ changes: { name: string; from: number; to: number; stockDelta: number }[] }>(`/inventory/revisions/${revisionId}`, { items: lines })
    ).changes;
  } finally {
    refreshGoods();
  }
}

export async function deleteRevisionDraft(revisionId: string): Promise<void> {
  try {
    await api.delete(`/inventory/revisions/${revisionId}`);
  } finally {
    refreshGoods();
  }
}
