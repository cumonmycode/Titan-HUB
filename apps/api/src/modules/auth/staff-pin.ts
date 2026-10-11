// PIN персонала должен быть уникален среди активных staff/owner: вход по PIN без
// userId (и вход киоска) ищет профиль перебором, и совпавший PIN давал вход под
// первой попавшейся учёткой — вплоть до владельца.
import { profiles, and, isNull, inArray } from '@titan/database'
import type { Database } from '@titan/database'
import { verifyPin } from '@titan/auth'

export const PIN_TAKEN_ERROR = 'Этот PIN уже занят — выберите другой'

export type StaffProfile = typeof profiles.$inferSelect

/** Активные staff/owner, чей PIN совпадает с введённым (в норме 0 или 1). */
export async function findStaffByPin(db: Database, pin: string): Promise<StaffProfile[]> {
  const staff = await db.select().from(profiles)
    .where(and(isNull(profiles.deletedAt), inArray(profiles.role, ['owner', 'staff'])))
  const checks = await Promise.all(staff.map((p) => (p.pin ? verifyPin(pin, p.pin) : Promise.resolve(false))))
  return staff.filter((_, i) => checks[i])
}

/** PIN уже принадлежит другому активному сотруднику/владельцу (кроме exceptId). */
export async function isPinTaken(db: Database, pin: string, exceptId?: string): Promise<boolean> {
  const matches = await findStaffByPin(db, pin)
  return matches.some((p) => p.id !== exceptId)
}
