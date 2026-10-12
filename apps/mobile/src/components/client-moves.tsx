import { MoveRow } from '@/components/profile-parts';
import { transactionLook, whenText, type ClientTransaction } from '@/lib/clients-api';
import { formatMoney, plural, toNumber } from '@/lib/format';
import { colors } from '@/lib/theme';

/** Движение денег, бонусов или посещений клиента одной строкой (карточка и «Вся история»). */
export function ClientMoveRow({ tx, onPress }: { tx: ClientTransaction; onPress?: () => void }) {
  const look = transactionLook(tx);
  const amount = toNumber(tx.amount);
  const text =
    tx.type === 'visit_adjust'
      ? `${amount > 0 ? '+' : ''}${amount} ${plural(Math.abs(amount), ['посещение', 'посещения', 'посещений'])}`
      : formatMoney(look.sign < 0 ? -amount : amount, { sign: look.sign > 0, kopecks: 'auto' });
  return (
    <MoveRow
      icon={look.symbol}
      color={look.sign > 0 ? '#34C759' : look.sign < 0 ? '#FF3B30' : '#8E8E93'}
      title={look.title}
      subtitle={whenText(tx.createdAt)}
      amount={text}
      amountColor={look.sign > 0 ? colors.green : look.sign < 0 ? colors.red : undefined}
      onPress={onPress}
    />
  );
}
