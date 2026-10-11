import { Host, Picker, Text as SwiftText } from '@expo/ui/swift-ui';
import { pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';

import { Text } from '@/components/text';
import { AmountKeypad, GlassCard, GlassChip, PrimaryButton, SheetHeader, sheetStyles } from '@/components/new-check-parts';
import { RollingText } from '@/components/rolling-text';
import { formatMoney, toNumber } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { applyDiscount, restoreDiscount } from '@/lib/pos-api';
import { useCheck } from '@/lib/queries';
import { parseAmount } from '@/lib/shift-api';
import { colors, space, type } from '@/lib/theme';

type DiscountType = 'percent' | 'fixed';

const QUICK: Record<DiscountType, number[]> = {
  percent: [5, 10, 15, 20, 50],
  fixed: [100, 200, 300, 500],
};

/**
 * Скидка на весь чек — процентом или суммой. Сумма крупно, как в Apple Pay; ввод —
 * стеклянной клавиатурой, чтобы системная клавиатура не закрывала шторку.
 * Здесь же возвращаются снятые авто-скидки.
 */
export default function DiscountSheet() {
  const { checkId } = useLocalSearchParams<{ checkId: string }>();
  const router = useRouter();
  const check = useCheck(checkId);
  const [kind, setKind] = useState<DiscountType>('percent');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  const data = check.data;
  // База скидки на сервере — позиции с модификаторами до скидок.
  const base = data ? toNumber(data.totalAmount) + data.discounts.reduce((sum, d) => sum + toNumber(d.amount), 0) : 0;
  const value = parseAmount(text) ?? 0;
  const tooMuch = kind === 'percent' && value > 100;
  const amount = kind === 'percent' ? Math.round(base * Math.min(value, 100)) / 100 : Math.min(value, base);
  const canApply = value > 0 && !tooMuch && !busy && data?.status === 'open';
  const excluded = data?.excludedDiscounts ?? [];

  const close = () => router.back();

  const apply = async () => {
    if (!canApply) return;
    haptic.medium();
    setBusy(true);
    try {
      await applyDiscount(checkId, { type: kind, value });
      haptic.success();
      close();
    } catch (error) {
      haptic.error();
      Alert.alert('Скидка не применена', error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const restore = async (discountId: string) => {
    haptic.light();
    setRestoringId(discountId);
    try {
      await restoreDiscount(checkId, discountId);
      haptic.success();
    } catch (error) {
      haptic.error();
      Alert.alert('Скидка не возвращена', error instanceof Error ? error.message : String(error));
    } finally {
      setRestoringId(null);
    }
  };

  return (
    <View style={styles.sheet}>
      <SheetHeader title="Скидка на чек" onClose={close} />

      <View style={styles.display} accessibilityLiveRegion="polite">
        <View style={styles.valueRow}>
          <RollingText text={text || '0'} style={[styles.value, type.amount, !text && styles.placeholder]} />
          <Text style={[styles.suffix, type.amount]}>{kind === 'percent' ? '%' : '₽'}</Text>
        </View>
        <Text style={[type.subhead, tooMuch ? styles.error : sheetStyles.secondary]}>
          {tooMuch
            ? 'Больше 100% нельзя'
            : value > 0
              ? `−${formatMoney(amount, { kopecks: 'auto' })} от позиций ${formatMoney(base, { kopecks: 'auto' })}`
              : `Позиции чека — ${formatMoney(base, { kopecks: 'auto' })}`}
        </Text>
      </View>

      <Host matchContents={{ vertical: true }} style={styles.segment}>
        <Picker
          selection={kind}
          onSelectionChange={(next) => {
            haptic.selection();
            setKind(next as DiscountType);
            setText('');
          }}
          modifiers={[pickerStyle('segmented')]}>
          <SwiftText modifiers={[tag('percent')]}>Процент</SwiftText>
          <SwiftText modifiers={[tag('fixed')]}>Сумма</SwiftText>
        </Picker>
      </Host>

      <View style={styles.quickRow}>
        {QUICK[kind].map((option) => (
          <GlassChip
            key={option}
            style={styles.flex}
            label={kind === 'percent' ? `${option}%` : `${option} ₽`}
            active={value === option}
            onPress={() => {
              haptic.selection();
              setText(String(option));
            }}
          />
        ))}
      </View>

      <AmountKeypad value={text} onChange={setText} allowDecimal={kind === 'fixed'} maxLength={kind === 'percent' ? 3 : 7} />

      <PrimaryButton
        title={busy ? 'Применяем…' : value > 0 && !tooMuch ? `Скидка −${formatMoney(amount, { kopecks: 'auto' })}` : 'Применить скидку'}
        icon="percent"
        busy={busy}
        disabled={!canApply}
        onPress={() => void apply()}
      />

      {excluded.length > 0 && (
        <Animated.View entering={FadeIn} exiting={FadeOut} layout={LinearTransition} style={styles.excluded}>
          <Text style={[type.footnote, sheetStyles.sectionTitle]}>СНЯТЫЕ АВТО-СКИДКИ</Text>
          <GlassCard>
            {excluded.map((d, index) => (
              <View key={d.id}>
                {index > 0 && <View style={[sheetStyles.separator, styles.separator]} />}
                <View style={styles.excludedRow}>
                  <SymbolView name="tag.slash" size={17} tintColor={colors.secondaryLabel} />
                  <View style={styles.flex}>
                    <Text style={[type.body, sheetStyles.label]} numberOfLines={1}>
                      {d.name}
                    </Text>
                    <Text style={[type.footnote, sheetStyles.secondary]}>{d.type === 'percent' ? `${toNumber(d.value)}%` : formatMoney(d.value)}</Text>
                  </View>
                  <Pressable
                    onPress={() => void restore(d.id)}
                    disabled={restoringId !== null}
                    style={({ pressed }) => [styles.restore, pressed && styles.pressed]}
                    accessibilityRole="button">
                    <Text style={[type.subhead, styles.restoreText]}>{restoringId === d.id ? 'Возвращаем…' : 'Вернуть'}</Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </GlassCard>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { paddingHorizontal: space.xl, paddingTop: space.xl, paddingBottom: space.lg, gap: space.lg },
  flex: { flex: 1 },
  pressed: { opacity: 0.6 },
  segment: { alignSelf: 'stretch' },
  display: { alignItems: 'center', gap: 2, paddingVertical: space.xs },
  valueRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', gap: 4 },
  value: { fontSize: 64, lineHeight: 72, color: colors.label },
  placeholder: { color: colors.tertiaryLabel },
  suffix: { fontSize: 40, lineHeight: 72, color: colors.secondaryLabel },
  error: { color: colors.red },
  quickRow: { flexDirection: 'row', gap: space.sm },
  excluded: { gap: space.sm },
  separator: { marginLeft: 48 },
  excludedRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, minHeight: 56 },
  restore: { paddingHorizontal: space.md, paddingVertical: 6, borderRadius: 999, backgroundColor: colors.fill },
  restoreText: { color: colors.accent, fontWeight: '600' },
});
