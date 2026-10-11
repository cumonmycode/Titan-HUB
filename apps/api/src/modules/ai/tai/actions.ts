/**
 * Карточки действий Tai: подготовить → показать → выполнить по нажатию.
 *
 * Модель только предлагает действие (propose_*). Сервер проверяет его, сохраняет план
 * в Redis на 30 минут и отдаёт карточку. Выполняется план, когда сотрудник нажал
 * кнопку, — запросом от его же имени и только один раз (getdel). Токен в Redis не
 * хранится: исполнение идёт с заголовками запроса подтверждения.
 */
import { randomUUID } from 'node:crypto'
import { getSharedRedis } from '../../../lib/redis.js'
import type { TaiActionCard, TaiRoute } from './blocks.js'
import { InternalApiError, type ApiCaller } from './internal.js'

const TTL_SEC = 30 * 60

export interface PlanItem {
  itemId: string
  quantity: number
  name: string
}

export type ActionPlan =
  | { kind: 'open_check'; playerId?: string; guestName?: string; spaceId?: string; items: PlanItem[] }
  | { kind: 'add_items'; checkId: string; items: PlanItem[] }
  | { kind: 'change_item'; checkId: string; checkItemId: string; quantity: number; name: string }
  | { kind: 'discount'; checkId: string; type: 'percent' | 'fixed'; value: number }
  | { kind: 'cancel_check'; checkId: string }

interface StoredAction {
  sub: string
  plan: ActionPlan
  card: TaiActionCard
}

const key = (clubKey: string, id: string) => `tai:action:${clubKey}:${id}`

/** Сохранить план и вернуть карточку с её id. */
export async function registerAction(clubKey: string, sub: string, plan: ActionPlan, card: Omit<TaiActionCard, 'id' | 'status'>): Promise<TaiActionCard> {
  const full: TaiActionCard = { ...card, id: randomUUID(), status: 'pending' }
  await getSharedRedis().set(key(clubKey, full.id), JSON.stringify({ sub, plan, card: full } satisfies StoredAction), 'EX', TTL_SEC)
  return full
}

export type ConfirmOutcome = { status: 404 | 403; error: string } | { status: 200; card: TaiActionCard }

/** Выполнить карточку по нажатию. Повторное нажатие не выполнит её второй раз. */
export async function confirmAction(clubKey: string, sub: string, id: string, api: ApiCaller): Promise<ConfirmOutcome> {
  const redis = getSharedRedis()
  const raw = await redis.getdel(key(clubKey, id))
  if (!raw) return { status: 404, error: 'Карточка устарела — попросите Tai ещё раз' }
  const stored = JSON.parse(raw) as StoredAction
  if (stored.sub !== sub) {
    // Чужую карточку не выполняем и не съедаем — вернём её владельцу.
    await redis.set(key(clubKey, id), raw, 'EX', TTL_SEC)
    return { status: 403, error: 'Эту карточку подготовили для другого сотрудника' }
  }
  try {
    const { result, to } = await execute(stored.plan, api)
    return { status: 200, card: { ...stored.card, status: 'done', result, to } }
  } catch (error) {
    const message = error instanceof InternalApiError || error instanceof Error ? error.message : String(error)
    return { status: 200, card: { ...stored.card, status: 'failed', result: humanError(message) } }
  }
}

/** Отказаться от карточки: план удаляется, чтобы его нельзя было выполнить позже. */
export async function dismissAction(clubKey: string, sub: string, id: string): Promise<TaiActionCard | null> {
  const redis = getSharedRedis()
  const raw = await redis.get(key(clubKey, id))
  if (!raw) return null
  const stored = JSON.parse(raw) as StoredAction
  if (stored.sub !== sub) return null
  await redis.del(key(clubKey, id))
  return { ...stored.card, status: 'cancelled' }
}

function humanError(message: string): string {
  if (message === 'No open shift') return 'Смена не открыта — откройте смену и повторите.'
  if (message === 'CHECK_NOT_OPEN' || /not open/i.test(message)) return 'Чек уже закрыт или отменён.'
  return message
}

const checkRoute = (checkId: string): TaiRoute => ({ screen: 'check', checkId })

async function addItems(api: ApiCaller, checkId: string, items: PlanItem[]): Promise<string[]> {
  const failed: string[] = []
  // По одной и по порядку — как нажатия в меню; ошибку позиции не прячем.
  for (const item of items) {
    try {
      await api.post(`/api/pos/checks/${checkId}/items`, { itemId: item.itemId, quantity: item.quantity })
    } catch (error) {
      failed.push(`${item.name}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return failed
}

async function execute(plan: ActionPlan, api: ApiCaller): Promise<{ result: string; to?: TaiRoute }> {
  switch (plan.kind) {
    case 'open_check': {
      // Аренда зоны: привязываем идущее мероприятие этой зоны — как касса приложения.
      let linkedEventId: string | undefined
      if (plan.spaceId) {
        linkedEventId = await api
          .get<{ event: { id: string } | null }>(`/api/events/active-for-space/${plan.spaceId}`)
          .then((r) => r.event?.id)
          .catch(() => undefined)
      }
      const { check } = await api.post<{ check: { id: string } }>('/api/pos/checks', {
        playerId: plan.playerId,
        guestNames: plan.guestName ? [plan.guestName] : [],
        spaceId: plan.spaceId,
        linkedEventId,
      })
      const failed = await addItems(api, check.id, plan.items)
      return {
        result: failed.length ? `Чек открыт, но не добавлено: ${failed.join('; ')}` : 'Чек открыт',
        to: checkRoute(check.id),
      }
    }
    case 'add_items': {
      const failed = await addItems(api, plan.checkId, plan.items)
      if (failed.length === plan.items.length) throw new Error(failed.join('; '))
      return { result: failed.length ? `Добавлено частично. Не вышло: ${failed.join('; ')}` : 'Добавлено в чек', to: checkRoute(plan.checkId) }
    }
    case 'change_item': {
      if (plan.quantity <= 0) await api.delete(`/api/pos/checks/${plan.checkId}/items/${plan.checkItemId}`)
      else await api.patch(`/api/pos/checks/${plan.checkId}/items/${plan.checkItemId}`, { quantity: plan.quantity })
      return { result: plan.quantity <= 0 ? `«${plan.name}» убрано из чека` : `«${plan.name}»: теперь ${plan.quantity}`, to: checkRoute(plan.checkId) }
    }
    case 'discount': {
      await api.post(`/api/pos/checks/${plan.checkId}/discount`, {
        name: plan.type === 'percent' ? `Скидка ${plan.value}%` : 'Скидка',
        type: plan.type,
        value: plan.value,
        target: 'check',
      })
      return { result: 'Скидка применена', to: checkRoute(plan.checkId) }
    }
    case 'cancel_check': {
      await api.delete(`/api/pos/checks/${plan.checkId}`)
      return { result: 'Чек отменён', to: { screen: 'pos' } }
    }
  }
}
