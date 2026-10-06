// Строка ленты операций: деньги (₽) и бонусы (⭐) в одном списке. Живёт внутри
// стеклянной группы, поэтому нажатие — системная подсветка строки, а не пружина.
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { bonus, clock, money, relative } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { colors, space } from '@/lib/theme';
import type { FeedItem } from '@/lib/types';

import { Icon, type IconName } from './icon';
import { IconTile } from './ui';

const LOOK: Record<string, { icon: IconName; color: string }> = {
  deposit: { icon: 'deposit', color: colors.green },
  payment: { icon: 'receipt', color: colors.violetLight },
  withdrawal: { icon: 'withdrawal', color: colors.amber },
  refund: { icon: 'refund', color: colors.cyan },
  bonus_accrual: { icon: 'bonus', color: colors.gold },
  bonus_spend: { icon: 'sparkles', color: colors.pink },
};

const FALLBACK = { icon: 'money' as IconName, color: colors.textSecondary };

/** Отступ разделителя строк — до текста, как в системных списках. */
export const FEED_ROW_INSET = space.lg + 38 + space.md;

/** dated — показать относительную дату («вчера, 14:32»): для списков без группировки по дням. */
export function FeedRow({ item, onOpenCheck, dated }: { item: FeedItem; onOpenCheck?: (checkId: string) => void; dated?: boolean }) {
  const look = LOOK[item.type] ?? FALLBACK;
  const positive = item.sign > 0;
  const amountText = item.unit === 'bonus'
    ? `${positive ? '+' : '−'}${bonus(item.amount)} ⭐`
    : money(item.sign * item.amount, true);
  const amountColor = positive ? colors.greenBright : item.unit === 'bonus' ? colors.pink : colors.text;
  const checkId = onOpenCheck ? item.checkId : null;

  const body = (
    <>
      <IconTile name={look.icon} color={look.color} size={38} />
      <View style={styles.text}>
        <Text style={styles.title} numberOfLines={1}>{item.title}</Text>
        <Text style={styles.sub}>{dated ? relative(item.createdAt) : clock(item.createdAt)}{checkId ? ' · чек' : ''}</Text>
      </View>
      <Text style={[styles.amount, { color: amountColor }]}>{amountText}</Text>
      {checkId ? <Icon name="chevron" size={12} color={colors.textMuted} weight="bold" /> : null}
    </>
  );

  if (!checkId || !onOpenCheck) return <View style={styles.row}>{body}</View>;
  return (
    <Pressable
      onPress={() => { haptic.tap(); onOpenCheck(checkId); }}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`${item.title}, ${amountText}. Открыть чек`}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md, paddingHorizontal: space.lg, minHeight: 64 },
  pressed: { backgroundColor: 'rgba(255,255,255,0.07)' },
  text: { flex: 1, minWidth: 0 },
  title: { color: colors.text, fontSize: 15.5, fontWeight: '600' },
  sub: { color: colors.textSecondary, fontSize: 12.5, marginTop: 2 },
  amount: { fontSize: 15.5, fontWeight: '800', fontVariant: ['tabular-nums'] },
});
