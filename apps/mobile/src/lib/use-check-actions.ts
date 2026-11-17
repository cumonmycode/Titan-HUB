import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';

import { haptic } from './haptics';
import { isSplitLayout } from './layout';
import { cancelCheck, confirmOrder, rejectOrder, removeDiscount, setCheckGuests, setItemQuantity } from './pos-api';
import { usePosSelection } from './pos-selection';


export type CheckActions = {
  onOpenPlayer: () => void;
  onRemoveGuest: (name: string) => void;
  onEditRental: () => void;
  /** Выбор зоны: добавить аренду, пересадить или снять. */
  onPickZone: () => void;
  onAddDiscount: () => void;
  onRemoveDiscount: (discountRowId: string) => void;
  onAddItems: () => void;
  onCancel: () => void;
  /** Абсолютное количество строки; 0 — удалить. Промис завершается, когда сервер ответил. */
  onQuantity: (checkItemId: string, quantity: number) => Promise<void>;
  onConfirmOrder: (orderId: string) => void;
  onRejectOrder: (orderId: string) => void;
  /** Заказ, по которому идёт запрос: его кнопки неактивны. */
  busyOrderId: string | null;
};

function explain(message: string): string {
  if (message === 'Check not open' || message === 'Чек закрыт') return 'Чек уже закрыт.';
  if (message === 'Insufficient stock') return 'На складе больше нет этой позиции.';
  if (message === 'Already resolved' || message === 'Заказ уже обработан') return 'Заказ уже обработан с другого устройства.';
  if (message === 'Not found or already closed') return 'Чек уже закрыт или отменён.';
  if (message === 'Discount not found') return 'Скидку уже сняли.';
  return message;
}

/** Действия с позициями и заказами чека: отклик, ошибки понятным языком, блокировка кнопок заказа. */
export function useCheckActions(checkId: string, guestNames: string[] = []): CheckActions {
  const router = useRouter();
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);

  return {
    busyOrderId,
    onOpenPlayer: () => {
      haptic.light();
      router.push({ pathname: '/pos/player', params: { checkId } });
    },
    onRemoveGuest: (name) => {
      haptic.light();
      setCheckGuests(
        checkId,
        guestNames.filter((n) => n !== name),
      ).catch((error: Error) => {
        haptic.error();
        Alert.alert('Участник не убран', explain(error.message));
      });
    },
    onAddItems: () => {
      haptic.light();
      router.push({ pathname: '/pos/menu', params: { checkId } });
    },
    onEditRental: () => {
      haptic.light();
      router.push({ pathname: '/pos/rental', params: { checkId } });
    },
    onPickZone: () => {
      haptic.light();
      router.push({ pathname: '/pos/zone', params: { checkId } });
    },
    onAddDiscount: () => {
      haptic.light();
      router.push({ pathname: '/pos/discount', params: { checkId } });
    },
    onRemoveDiscount: (discountRowId) => {
      haptic.light();
      removeDiscount(checkId, discountRowId).catch((error: Error) => {
        haptic.error();
        Alert.alert('Скидка не снята', explain(error.message));
      });
    },
    onCancel: () => {
      haptic.warning();
      Alert.alert('Отменить чек?', 'Чек будет отменён без оплаты. Действие необратимо.', [
        { text: 'Назад', style: 'cancel' },
        {
          text: 'Отменить чек',
          style: 'destructive',
          onPress: () => {
            cancelCheck(checkId)
              .then(() => {
                haptic.success();
                // iPhone: чек сворачивается зумом в карточку, затем карточка растворяется.
                if (isSplitLayout()) usePosSelection.getState().select(null);
                else router.back();
              })
              .catch((error: Error) => {
                haptic.error();
                Alert.alert('Чек не отменён', explain(error.message));
              });
          },
        },
      ]);
    },
    onQuantity: (checkItemId, quantity) =>
      setItemQuantity(checkId, checkItemId, quantity).then(
        () => undefined,
        (error: Error) => {
          haptic.error();
          Alert.alert('Количество не изменилось', explain(error.message));
        },
      ),
    onConfirmOrder: (orderId) => {
      setBusyOrderId(orderId);
      confirmOrder(checkId, orderId)
        .then(() => haptic.success())
        .catch((error: Error) => {
          haptic.error();
          Alert.alert('Заказ не подтверждён', explain(error.message));
        })
        .finally(() => setBusyOrderId(null));
    },
    onRejectOrder: (orderId) => {
      Alert.alert('Отклонить заказ?', 'Гость увидит, что заказ отклонён.', [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Отклонить',
          style: 'destructive',
          onPress: () => {
            setBusyOrderId(orderId);
            rejectOrder(checkId, orderId)
              .then(() => haptic.warning())
              .catch((error: Error) => Alert.alert('Заказ не отклонён', explain(error.message)))
              .finally(() => setBusyOrderId(null));
          },
        },
      ]);
    },
  };
}
