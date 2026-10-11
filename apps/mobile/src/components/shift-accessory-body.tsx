import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/text';
import { formatMoney, plural } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { useShiftSummary } from '@/lib/queries';
import { FONT_SCALE_MAX } from '@/lib/text-scale';
import { colors, space, type } from '@/lib/theme';

/**
 * Содержимое плашки смены. Размещение приходит пропом: на iOS его даёт
 * NativeTabs.BottomAccessory.usePlacement(), который работает только внутри этой
 * фичи iOS 26, а на Android плашку рисуем сами — там режим всегда полный.
 */
export function ShiftAccessoryBody({ placement }: { placement: 'inline' | 'regular' }) {
  const router = useRouter();
  const summary = useShiftSummary();
  const data = summary.data;
  const inline = placement === 'inline';

  let title = 'Смена';
  let detail = summary.isError ? 'нет связи' : '…';
  let forecast: string | null = null;
  let closed = false;

  if (data && !data.shift) {
    closed = true;
    title = 'Смена закрыта';
    detail = 'Нажмите, чтобы открыть';
  } else if (data && data.shift) {
    const count = data.openChecks.count;
    title = count === 0 ? 'Нет открытых чеков' : `${count} ${plural(count, ['чек', 'чека', 'чеков'])}`;
    detail = `в кассе ${formatMoney(data.cashInRegister)}`;
    if (data.forecast) forecast = formatMoney(data.forecast.amount);
  }

  return (
    <Pressable
      style={styles.row}
      // Смена закрыта — сразу к открытию, без промежуточного экрана «Смена закрыта».
      onPress={() => router.push(closed ? '/shift/open' : '/shift')}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${detail}${forecast ? `, прогноз ${forecast}` : ''}`}>
      <SymbolView
        name={closed ? 'moon.zzz' : 'clock'}
        size={inline ? 16 : 19}
        tintColor={closed ? colors.secondaryLabel : colors.accent}
      />
      <View style={styles.texts}>
        {/* Высота системной плашки не растёт — текст в ней растёт умеренно. */}
        <Text style={[inline ? type.footnote : type.subhead, styles.title]} numberOfLines={1} maxFontSizeMultiplier={FONT_SCALE_MAX.compact}>
          {title}
        </Text>
        {!inline && (
          <Text style={[type.caption1, styles.detail]} numberOfLines={1} maxFontSizeMultiplier={FONT_SCALE_MAX.compact}>
            {detail}
          </Text>
        )}
      </View>
      {forecast && (
        <View style={styles.forecast}>
          <SymbolView
            name="sparkles"
            size={14}
            tintColor={colors.accent}
            animationSpec={{ effect: { type: 'pulse' }, repeating: true }}
          />
          <Text style={[inline ? type.footnote : type.subhead, type.amount, styles.title]} numberOfLines={1} maxFontSizeMultiplier={FONT_SCALE_MAX.compact}>
            {forecast}
          </Text>
        </View>
      )}
      {IS_PAD && (
        <Pressable
          style={styles.newCheck}
          onPress={() => {
            haptic.light();
            router.push('/new-check');
          }}
          accessibilityRole="button"
          accessibilityLabel="Новый чек">
          <SymbolView name="plus" size={15} weight="semibold" tintColor="white" />
          <Text style={[type.subhead, styles.newCheckText]} maxFontSizeMultiplier={FONT_SCALE_MAX.compact}>
            Новый чек
          </Text>
        </Pressable>
      )}
    </Pressable>
  );
}

const IS_PAD = Platform.OS === 'ios' && Platform.isPad;

const styles = StyleSheet.create({
  newCheck: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: space.lg,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: colors.accent,
  },
  newCheckText: { color: 'white', fontWeight: '600' },
  row: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
  },
  texts: { flex: 1, minWidth: 0 },
  title: { color: colors.label, fontWeight: '600' },
  detail: { color: colors.secondaryLabel },
  forecast: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
});
