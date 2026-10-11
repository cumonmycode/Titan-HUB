import type { JwtPayload } from '@titan/auth'
import type { Database } from '@titan/database'

/**
 * Подписка клуба в контексте запроса (для энфорсмента доступа).
 *   undefined — обогащение не удалось → энфорсмент fail-open (не блокируем);
 *   null      — подписки нет (клуб не настроен) → блок.
 */
export interface ClubSubscriptionInfo {
  status: string
  paidUntil: Date | null
}

/**
 * Описание клуба-арендатора в контексте запроса (Фаза 1, database-per-club).
 * null — одно-клубный/дефолтный режим (основной/служебный домен, синглтон-БД).
 * Несёт подписку и фиче-флаги модулей для энфорсмента (middleware подписки/модулей).
 */
export interface ClubContext {
  id: string
  slug: string
  name: string
  dbName: string
  subscription: ClubSubscriptionInfo | null | undefined
  modules: Record<string, boolean>
}

export type AppEnv = {
  Variables: {
    user: JwtPayload
    // БД текущего клуба, инжектится middleware tenantContext. В одно-клубном
    // режиме = дефолтный синглтон (поведение идентично прежнему).
    db: Database
    club: ClubContext | null
    // Права сотрудника (profiles.permissions), кладёт requireAuth; undefined —
    // профиль не проверен (fail-open). Проверка — requirePermission.
    permissions: Record<string, boolean> | undefined
  }
}
