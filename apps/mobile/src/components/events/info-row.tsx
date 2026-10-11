import { SymbolView } from 'expo-symbols';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { SFSymbol } from 'sf-symbols-typescript';

import { Text } from '@/components/text';
import { haptic } from '@/lib/haptics';
import { FONT_SCALE_MAX } from '@/lib/text-scale';
import { colors, space, type } from '@/lib/theme';

/**
 * Строка деталей мероприятия: значок, подпись и значение под ней. `children` — действия,
 * которые относятся именно к этому значению (маршрут и такси у адреса).
 */
export function InfoRow({
  icon,
  label,
  value,
  multiline,
  children,
}: {
  icon: SFSymbol;
  label: string;
  value: string;
  multiline?: boolean;
  children?: ReactNode;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.icon}>
        <SymbolView name={icon} size={15} weight="semibold" tintColor={colors.accent} />
      </View>
      <View style={styles.texts}>
        <Text style={[type.caption1, styles.secondary]}>{label}</Text>
        <Text style={[type.body, styles.label]} numberOfLines={multiline ? undefined : 3}>
          {value}
        </Text>
        {children}
      </View>
    </View>
  );
}

/** Ряд маленьких действий под значением строки. */
export function RowActions({ children }: { children: ReactNode }) {
  return <View style={styles.actions}>{children}</View>;
}

/** Действие строки — капсула с подписью акцентом (не отдельная карточка). */
export function RowAction({ icon, label, onPress }: { icon: SFSymbol; label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={() => {
        haptic.light();
        onPress();
      }}
      hitSlop={4}
      style={({ pressed }) => [styles.action, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={label}>
      <SymbolView name={icon} size={13} weight="semibold" tintColor={colors.accent} />
      <Text style={[type.subhead, styles.actionText]} maxFontSizeMultiplier={FONT_SCALE_MAX.compact}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  icon: { width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.fill },
  texts: { flex: 1, gap: 1 },
  label: { color: colors.label },
  secondary: { color: colors.secondaryLabel },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.sm },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 34,
    paddingHorizontal: space.md,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.fill,
  },
  actionText: { color: colors.accent, fontWeight: '600' },
  pressed: { opacity: 0.6 },
});
