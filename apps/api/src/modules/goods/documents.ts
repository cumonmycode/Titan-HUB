import type { Database } from '@titan/database'
import { supplies, supplyItems, revisions, revisionItems, writeOffs, writeOffItems, profiles, eq, desc, sql } from '@titan/database'

// Лента операций склада: приходы, списания и ревизии одним списком (новые сверху).
// Черновики — тут же, со статусом draft: приложение показывает их отдельным блоком
// «Не проведено». Суммы — по себестоимости.

export interface GoodsDocument {
  type: 'supply' | 'write_off' | 'revision'
  id: string
  status: 'draft' | 'posted'
  createdAt: string
  updatedAt: string | null
  author: string | null
  positions: number
  /** Приход — сумма закупки; списание — себестоимость списанного; ревизия — излишек − недостача. */
  amount: number
  /** Поставщик прихода или причина списания. */
  title: string | null
  /** Приход оплачен наличными из кассы смены. */
  fromRegister?: boolean
  surplus?: number
  shortage?: number
}

const num = (v: unknown) => parseFloat(String(v ?? 0)) || 0
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v ? String(v) : null)

export async function loadDocuments(db: Database, limit: number): Promise<GoodsDocument[]> {
  const [supplyRows, writeOffRows, revisionRows] = await Promise.all([
    db.select({
      id: supplies.id, status: supplies.status, createdAt: supplies.createdAt, updatedAt: supplies.updatedAt,
      supplier: supplies.supplier, totalCost: supplies.totalCost, draftData: supplies.draftData,
      cashOperationId: supplies.cashOperationId, author: profiles.nickname,
      positions: sql<number>`(select count(*)::int from ${supplyItems} where ${supplyItems.supplyId} = ${supplies.id})`,
    })
      .from(supplies)
      .leftJoin(profiles, eq(profiles.id, supplies.createdBy))
      .orderBy(desc(supplies.createdAt))
      .limit(limit),
    db.select({
      id: writeOffs.id, status: writeOffs.status, createdAt: writeOffs.createdAt, updatedAt: writeOffs.updatedAt,
      reason: writeOffs.reason, totalCost: writeOffs.totalCost, draftData: writeOffs.draftData, author: profiles.nickname,
      positions: sql<number>`(select count(*)::int from ${writeOffItems} where ${writeOffItems.writeOffId} = ${writeOffs.id})`,
    })
      .from(writeOffs)
      .leftJoin(profiles, eq(profiles.id, writeOffs.createdBy))
      .orderBy(desc(writeOffs.createdAt))
      .limit(limit),
    db.select({
      id: revisions.id, status: revisions.status, createdAt: revisions.createdAt, updatedAt: revisions.updatedAt,
      draftData: revisions.draftData, author: profiles.nickname,
      positions: sql<number>`(select count(*)::int from ${revisionItems} where ${revisionItems.revisionId} = ${revisions.id})`,
      surplus: sql<string>`(select coalesce(sum(greatest(${revisionItems.actual} - ${revisionItems.expected}, 0) * ${revisionItems.costPrice}), 0) from ${revisionItems} where ${revisionItems.revisionId} = ${revisions.id})`,
      shortage: sql<string>`(select coalesce(sum(greatest(${revisionItems.expected} - ${revisionItems.actual}, 0) * ${revisionItems.costPrice}), 0) from ${revisionItems} where ${revisionItems.revisionId} = ${revisions.id})`,
    })
      .from(revisions)
      .leftJoin(profiles, eq(profiles.id, revisions.createdBy))
      .orderBy(desc(revisions.createdAt))
      .limit(limit),
  ])

  const documents: GoodsDocument[] = [
    ...supplyRows.map((s): GoodsDocument => {
      const draft = s.status === 'draft'
      const lines = s.draftData?.items ?? []
      return {
        type: 'supply', id: s.id, status: draft ? 'draft' : 'posted',
        createdAt: iso(s.createdAt)!, updatedAt: iso(s.updatedAt), author: s.author,
        positions: draft ? lines.length : s.positions,
        amount: draft ? Math.round(lines.reduce((sum, l) => sum + (Number(l.quantity) || 0) * (Number(l.costPerUnit) || 0), 0) * 100) / 100 : num(s.totalCost),
        title: (draft ? s.draftData?.supplier : s.supplier) || null,
        fromRegister: draft ? !!s.draftData?.fromRegister : !!s.cashOperationId,
      }
    }),
    ...writeOffRows.map((w): GoodsDocument => {
      const draft = w.status === 'draft'
      return {
        type: 'write_off', id: w.id, status: draft ? 'draft' : 'posted',
        createdAt: iso(w.createdAt)!, updatedAt: iso(w.updatedAt), author: w.author,
        positions: draft ? (w.draftData?.items ?? []).length : w.positions,
        amount: num(w.totalCost), title: w.reason || null,
      }
    }),
    ...revisionRows.map((r): GoodsDocument => {
      const draft = r.status === 'draft'
      const surplus = Math.round(num(r.surplus) * 100) / 100
      const shortage = Math.round(num(r.shortage) * 100) / 100
      return {
        type: 'revision', id: r.id, status: draft ? 'draft' : 'posted',
        createdAt: iso(r.createdAt)!, updatedAt: iso(r.updatedAt), author: r.author,
        positions: draft ? (r.draftData?.items ?? []).length : r.positions,
        amount: Math.round((surplus - shortage) * 100) / 100, title: null, surplus, shortage,
      }
    }),
  ]
  return documents.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, limit)
}
