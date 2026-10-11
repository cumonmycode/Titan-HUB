/**
 * Аккаунт приложения My Titan, удалённый самим клиентом (миграция 078).
 *
 * Карточка в HUB не меняется, только помечается (app_deleted_at). Сутки после удаления
 * войти в приложение по этому номеру нельзя; при следующем входе пометка снимается.
 */
const RELOGIN_BAN_MS = 24 * 60 * 60 * 1000

/** До какого момента вход запрещён; null — можно входить. */
export function appLoginBlockedUntil(profile: { appDeletedAt: Date | string | null }, now = Date.now()): Date | null {
  if (!profile.appDeletedAt) return null
  const until = new Date(new Date(profile.appDeletedAt).getTime() + RELOGIN_BAN_MS)
  return until.getTime() > now ? until : null
}

/** «Войти снова можно с 12 октября, 14:05» (время клуба, МСК). */
export function reloginBanMessage(until: Date): string {
  const when = until.toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' })
  return `Вы удалили аккаунт My Titan. Войти снова можно с ${when}.`
}
