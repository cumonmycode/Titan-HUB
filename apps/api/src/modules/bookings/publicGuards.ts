/**
 * Защиты публичного приёма заявок сайта клуба (/api/site/requests): узкий лимит
 * по IP и по телефону поверх глобального rateLimit и проверка даты/времени начала.
 */
import { getSharedRedis } from '../../lib/redis.js'

/**
 * Два независимых окна — по IP и по телефону; превышение любого = блок. Ключ
 * скоупится по клубу (мультитенант). Redis недоступен → не блокируем
 * (доступность для гостя важнее), как глобальный rateLimit.
 */
export async function publicRateLimited(
  prefix: string, clubId: string, ip: string, phoneTail: string, max: number, windowSeconds: number,
): Promise<boolean> {
  try {
    const redis = getSharedRedis()
    const scope = clubId || 'default'
    const keys = [`${prefix}:ip:${scope}:${ip}`, `${prefix}:ph:${scope}:${phoneTail}`]
    for (const key of keys) {
      const current = await redis.incr(key)
      if (current === 1) await redis.expire(key, windowSeconds)
      if (current > max) return true
    }
    return false
  } catch {
    return false
  }
}

// Начало заявки гостя: календарно существующая дата + время 00:00–23:59, не в прошлом.
// Иначе Postgres падал на касте «2026-02-31»/«25:99» (500), а заявка «на вчера»
// уходила владельцу. Возвращает текст ошибки для 400 или null.
export function startError(date: string, time: string): string | null {
  const d = new Date(`${date}T00:00:00Z`)
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== date) return 'Такой даты нет — проверьте день и месяц'
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return 'Время указано неверно — нужно ЧЧ:ММ от 00:00 до 23:59'
  if (new Date(`${date}T${time}:00+03:00`).getTime() < Date.now()) return 'Это время уже прошло — выберите будущую дату'
  return null
}
