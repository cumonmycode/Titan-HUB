/**
 * Номер телефона клиента: проверка и поиск профиля по номеру (вход в My Titan).
 *
 * В profiles.phone номера записаны как попало («+79991234567», «+7 999 123 4567»,
 * «89991234567»), поэтому сравниваем по последним 10 цифрам — так совпадают все
 * российские форматы. Та же логика в apps/bot-wallet/src/bot.ts (normalizePhone/
 * phoneKey) — менять синхронно.
 */
import { profiles, and, isNull, sql, type Database, type Profile } from '@titan/database'
import { normalizePhone as phoneDigits } from './whatsapp.js'

const PHONE_KEY_LENGTH = 10

/** «8 999 123-45-67» / «9991234567» / «+7 (999) …» → «+79991234567»; неполный номер → null. */
export function normalizePhone(raw: string): string | null {
  const digits = phoneDigits(raw)
  if (digits.length < 11 || digits.length > 15) return null
  return `+${digits}`
}

/** Ключ сравнения номеров — последние 10 цифр. */
export function phoneKey(phone: string): string {
  return phone.replace(/\D/g, '').slice(-PHONE_KEY_LENGTH)
}

/** Живые профили с этим номером (обычно один), старые — первыми. */
export async function findProfilesByPhone(db: Database, phone: string): Promise<Profile[]> {
  const key = phoneKey(phone)
  if (key.length < PHONE_KEY_LENGTH) return []
  return db.select().from(profiles)
    .where(and(
      isNull(profiles.deletedAt),
      sql`right(regexp_replace(coalesce(${profiles.phone}, ''), '[^0-9]', '', 'g'), ${PHONE_KEY_LENGTH}) = ${key}`,
    ))
    .orderBy(profiles.createdAt)
}
