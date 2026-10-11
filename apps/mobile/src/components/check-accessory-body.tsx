import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/text';
import { formatMoney } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { payTotals } from '@/lib/payment';
import { useCheck } from '@/lib/queries';
import { FONT_SCALE_MAX, useTextLayout } from '@/lib/text-scale';
import { colors, space, type } from '@/lib/theme';
import { useNow } from '@/lib/use-now';

/**
 * Действия открытого чека над таб-баром (iPhone). Панель инструментов внизу экрана
 * оказалась бы под плавающим таб-баром iOS 26, а системная плашка стоит над ним.
 */
export function CheckAccessoryBody({ checkId, inline }: { checkId: string; inline: boolean }) {
  const router = useRouter();
  const check = useCheck(checkId);
  const now = useNow(15_000);
  const data = check.data;
  const isOpen = data?.status === 'open';
  const due = data ? payTotals(data, now).due : 0;
  // Плашка — системная, её высота не растёт: текст в ней растёт умеренно. На «Увеличенном»
  // виде и с крупным текстом «Добавить» — только значком, иначе «Оплатить 47 360 ₽» не влезает.
  const { layout } = useTextLayout();
  const addIconOnly = inline || layout !== 'regular';

  return (
    <View style={styles.row}>
      <Pressable
        style={({ pressed }) => [styles.add, pressed && styles.pressed]}
        disabled={!isOpen}
        onPress={() => {
          haptic.light();
          router.push({ pathname: '/pos/menu', params: { checkId } });
        }}
        accessibilityRole="button"
        accessibilityLabel="Добавить позицию">
        <SymbolView name="plus" size={inline ? 15 : 17} weight="semibold" tintColor={isOpen ? colors.accent : colors.tertiaryLabel} />
        {!addIconOnly && (
          <Text style={[type.subhead, styles.addText, !isOpen && styles.muted]} maxFontSizeMultiplier={FONT_SCALE_MAX.compact}>
            Добавить
          </Text>
        )}
      </Pressable>

      <View style={styles.flex} />

      {isOpen ? (
        <Pressable
          style={({ pressed }) => [styles.pay, inline && styles.payInline, pressed && styles.pressed]}
          onPress={() => {
            haptic.medium();
            router.push({ pathname: '/pay', params: { checkId } });
          }}
          accessibilityRole="button"
          accessibilityLabel={due > 0 ? `Оплатить ${formatMoney(due)}` : 'Закрыть чек'}>
          <Text
            style={[inline ? type.footnote : type.subhead, styles.payText]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.75}
            maxFontSizeMultiplier={FONT_SCALE_MAX.compact}>
            {due > 0 ? `Оплатить ${formatMoney(due, { kopecks: 'auto' })}` : 'Закрыть чек'}
          </Text>
        </Pressable>
      ) : data?.status === 'closed' ? (
        <Pressable
          style={({ pressed }) => [styles.pay, styles.refund, inline && styles.payInline, pressed && styles.pressed]}
          onPress={() => {
            haptic.light();
            router.push({ pathname: '/pos/refund', params: { checkId } });
          }}
          accessibilityRole="button"
          accessibilityLabel="Оформить возврат">
          <SymbolView name="arrow.uturn.backward" size={inline ? 12 : 14} weight="semibold" tintColor={colors.red} />
          <Text style={[inline ? type.footnote : type.subhead, styles.refundText]} maxFontSizeMultiplier={FONT_SCALE_MAX.compact}>
            Возврат
          </Text>
        </Pressable>
      ) : (
        <Text style={[type.subhead, styles.muted]} maxFontSizeMultiplier={FONT_SCALE_MAX.compact}>
          {data ? 'Чек отменён' : ''}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.sm },
  flex: { flex: 1 },
  add: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.md, paddingVertical: space.sm },
  addText: { color: colors.accent, fontWeight: '600' },
  muted: { color: colors.tertiaryLabel },
  pay: { flexShrink: 1, paddingHorizontal: space.lg, paddingVertical: 9, borderRadius: 999, backgroundColor: colors.accent },
  payInline: { paddingHorizontal: space.md, paddingVertical: 5 },
  payText: { color: 'white', fontWeight: '600', fontVariant: ['tabular-nums'] },
  refund: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(244,63,94,0.16)' },
  refundText: { color: colors.red, fontWeight: '600' },
  pressed: { opacity: 0.6 },
});
