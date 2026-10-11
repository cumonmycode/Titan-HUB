import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, View } from 'react-native';

import { GlassView } from '@/components/glass';
import { GlassCard } from '@/components/new-check-parts';
import { Text } from '@/components/text';
import { haptic } from '@/lib/haptics';
import { FONT_SCALE_MAX, useScaledSize } from '@/lib/text-scale';
import { colors, space, type } from '@/lib/theme';

/** Заголовок группы ленты: день, месяц или «Заявки с сайта · 2». */
export function GroupHeader({ title, count }: { title: string; count?: number }) {
  return (
    <View style={styles.header} accessibilityRole="header">
      <Text style={[type.headline, styles.label]}>
        {title}
        {count ? <Text style={styles.secondary}>{` · ${count}`}</Text> : null}
      </Text>
    </View>
  );
}

/** Круглая кнопка «+» рядом с крупным заголовком — окрашенное стекло, как `glassProminent`. */
export function AddButton({ label, onPress }: { label: string; onPress: () => void }) {
  const icon = useScaledSize(20);
  return (
    <GlassView isInteractive tintColor={colors.accent} style={styles.add}>
      <Pressable
        style={styles.addPress}
        onPress={() => {
          haptic.light();
          onPress();
        }}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={label}>
        <SymbolView name="plus" size={icon} weight="semibold" tintColor="white" />
      </Pressable>
    </GlassView>
  );
}

/** Прошлый месяц свёрнут в папку: название, сколько внутри и стрелка. */
export function MonthFolder({ title, count, open, onToggle }: { title: string; count: number; open: boolean; onToggle: () => void }) {
  return (
    <Pressable
      onPress={() => {
        haptic.selection();
        onToggle();
      }}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${count}`}
      accessibilityState={{ expanded: open }}>
      <GlassCard interactive style={styles.folder}>
        <SymbolView name={open ? 'folder.fill' : 'folder'} size={20} tintColor={colors.accent} />
        <Text style={[type.headline, styles.label, styles.flex]}>{title}</Text>
        <Text style={[type.subhead, styles.secondary]} maxFontSizeMultiplier={FONT_SCALE_MAX.compact}>
          {count}
        </Text>
        <SymbolView name={open ? 'chevron.up' : 'chevron.down'} size={13} weight="semibold" tintColor={colors.tertiaryLabel} />
      </GlassCard>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  label: { color: colors.label },
  secondary: { color: colors.secondaryLabel },
  header: { paddingHorizontal: space.xs, paddingTop: space.xs },
  add: { width: 44, height: 44, borderRadius: 22, overflow: 'hidden', marginBottom: 4 },
  addPress: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  folder: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md, minHeight: 52 },
});
