/**
 * Подтверждение регистраций из приложения My Titan (миграция 077).
 *
 * Клиент, зарегистрировавшийся в приложении сам, ждёт подтверждения персонала
 * («Клиенты» в HUB): до него бонусы не начисляются, оплата в приложении закрыта.
 * Профили, заведённые персоналом, — registration_status NULL, ограничений нет.
 */
export const REGISTRATION_PENDING = 'pending'
export const REGISTRATION_APPROVED = 'approved'
export const REGISTRATION_REJECTED = 'rejected'

/** Регистрация ещё не подтверждена персоналом. */
export function isRegistrationPending(profile: { registrationStatus: string | null } | null | undefined): boolean {
  return profile?.registrationStatus === REGISTRATION_PENDING
}
