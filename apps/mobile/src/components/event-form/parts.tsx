import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, View, type ColorValue } from 'react-native';
import type { SFSymbol } from 'sf-symbols-typescript';

import { Text } from '@/components/text';
import { GlassView } from '@/components/glass';
import { sheetStyles } from '@/components/new-check-parts';
import { FONT_SCALE_MAX, useTextLayout } from '@/lib/text-scale';
import { colors, space, type } from '@/lib/theme';

/** Общие кирпичики формы мероприятия: компактный выбор-капсула и строка «подпись — значение». */

/**
 * Капсула выбора без лишних полей: семь длительностей встают в одну строку телефона.
 * В строке капсулы растягиваются поровну; не влезли (крупный текст) — переносятся.
 */
export function ChoiceChip({
  label,
  active,
  onPress,
  accessibilityLabel,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={styles.chipCell}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected: active }}>
      <GlassView isInteractive tintColor={active ? colors.accent : undefined} style={styles.chip}>
        <Text style={[type.subhead, styles.chipText, active && styles.chipTextActive]} numberOfLines={1} maxFontSizeMultiplier={FONT_SCALE_MAX.compact}>
          {label}
        </Text>
      </GlassView>
    </Pressable>
  );
}

/**
 * Строка карточки: значок, подпись и значение справа. С очень крупным текстом значение
 * встаёт под подпись — как в «Настройках» iOS.
 */
export function InfoRow({
  icon,
  label,
  value,
  valueColor,
  strong,
}: {
  icon: SFSymbol;
  label: string;
  value?: string;
  valueColor?: ColorValue;
  strong?: boolean;
}) {
  const { stacked } = useTextLayout();
  const valueText = value ? (
    <Text style={[strong ? type.headline : type.body, strong ? sheetStyles.label : sheetStyles.secondary, valueColor ? { color: valueColor } : null]}>
      {value}
    </Text>
  ) : null;
  return (
    <View style={styles.row}>
      <SymbolView name={icon} size={16} weight="medium" tintColor={colors.secondaryLabel} />
      <View style={[styles.flex, !stacked && styles.inline]}>
        <Text style={[type.body, sheetStyles.label, !stacked && styles.flex]}>{label}</Text>
        {valueText}
      </View>
    </View>
  );
}

export const formStyles = StyleSheet.create({
  flex: { flex: 1 },
  card: { paddingHorizontal: space.lg },
  stretch: { alignSelf: 'stretch' },
  control: { alignSelf: 'stretch', paddingVertical: space.sm },
  hint: { color: colors.secondaryLabel, paddingHorizontal: space.xs },
  warning: { color: colors.orange, paddingHorizontal: space.xs },
});

const styles = StyleSheet.create({
  flex: { flex: 1 },
  chipCell: { flexGrow: 1 },
  chip: { minHeight: 36, paddingHorizontal: space.sm + 2, paddingVertical: 6, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  chipText: { color: colors.label, fontWeight: '600' },
  chipTextActive: { color: 'white' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 50, paddingVertical: space.xs },
  inline: { flexDirection: 'row', alignItems: 'center', gap: space.md },
});
