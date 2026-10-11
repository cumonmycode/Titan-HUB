import { Canvas, Path, Skia } from '@shopify/react-native-skia';
import { SymbolView } from 'expo-symbols';
import { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import { Text } from '@/components/text';
import { haptic } from '@/lib/haptics';
import { FONT_SCALE_MAX } from '@/lib/text-scale';
import { colors, space, type } from '@/lib/theme';

export type SharePart = { key: string; label: string; value: number; color: string; caption?: string };

const SIZE = 156;
const THICK = 20;
const GAP_DEG = 1.6;

/**
 * Доли целого: кольцо и легенда. Касание сектора или строки выбирает долю (повторное —
 * снимает), в центре кольца — её сумма и процент. Если у доли есть переход
 * (`onOpen`), под легендой появляется ссылка «Чеки: Наличные ›».
 */
export function ShareChart({
  parts,
  selected,
  onSelect,
  format,
  totalLabel,
  onOpen,
  openLabel,
}: {
  parts: SharePart[];
  selected: string | null;
  onSelect: (key: string | null) => void;
  format: (value: number) => string;
  totalLabel: string;
  onOpen?: (key: string) => void;
  openLabel?: (part: SharePart) => string;
}) {
  const total = parts.reduce((s, p) => s + Math.max(0, p.value), 0);
  const arcs = useMemo(() => {
    const sweeps = parts.map((part) => (total > 0 ? (Math.max(0, part.value) / total) * 360 : 0));
    const inset = THICK / 2 + 4;
    const gap = parts.length > 1 ? GAP_DEG : 0;
    return parts.map((part, index) => {
      // Сектора идут по часовой стрелке от «12 часов».
      const start = -90 + sweeps.slice(0, index).reduce((sum, sweep) => sum + sweep, 0);
      const sweep = sweeps[index]!;
      const path = Skia.Path.Make();
      path.addArc({ x: inset, y: inset, width: SIZE - inset * 2, height: SIZE - inset * 2 }, start + gap / 2, Math.max(0.1, sweep - gap));
      return { key: part.key, path, start, sweep };
    });
  }, [parts, total]);

  const choose = (key: string | null) => {
    haptic.selection();
    onSelect(key === selected ? null : key);
  };

  // Сектор по углу касания; в «дырке» кольца — снять выбор.
  const tap = Gesture.Tap()
    .runOnJS(true)
    .onEnd((e) => {
      const dx = e.x - SIZE / 2;
      const dy = e.y - SIZE / 2;
      if (Math.hypot(dx, dy) < SIZE / 2 - THICK - 14) return choose(null);
      const angle = ((Math.atan2(dy, dx) * 180) / Math.PI + 450) % 360;
      const hit = arcs.find((a) => angle >= a.start + 90 && angle < a.start + 90 + a.sweep);
      if (hit) choose(hit.key);
    });

  const current = parts.find((p) => p.key === selected) ?? null;
  const share = (value: number) => (total > 0 ? Math.round((value / total) * 100) : 0);

  return (
    <View style={styles.wrap}>
      <GestureDetector gesture={tap}>
        <View style={styles.ring} accessibilityRole="image" accessibilityLabel={parts.map((p) => `${p.label} ${share(p.value)}%`).join(', ')}>
          <Canvas style={StyleSheet.absoluteFill}>
            {arcs.map((arc, index) => {
              const active = arc.key === selected;
              return (
                <Path
                  key={arc.key}
                  path={arc.path}
                  style="stroke"
                  strokeWidth={active ? THICK + 6 : THICK}
                  color={parts[index]!.color}
                  opacity={selected && !active ? 0.3 : 1}
                />
              );
            })}
          </Canvas>
          <View style={styles.center} pointerEvents="none">
            <Text style={[type.caption1, styles.secondary]} numberOfLines={1} maxFontSizeMultiplier={FONT_SCALE_MAX.compact}>
              {current ? current.label : totalLabel}
            </Text>
            <Text style={[type.headline, type.amount, styles.label]} numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={FONT_SCALE_MAX.compact}>
              {format(current ? current.value : total)}
            </Text>
            {current ? <Text style={[type.caption1, styles.secondary]}>{`${share(current.value)}%`}</Text> : null}
          </View>
        </View>
      </GestureDetector>

      <View style={styles.legend}>
        {parts.map((part) => {
          const active = part.key === selected;
          return (
            <Pressable
              key={part.key}
              onPress={() => choose(part.key)}
              style={({ pressed }) => [styles.row, active && styles.rowActive, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <View style={[styles.dot, { backgroundColor: part.color, opacity: selected && !active ? 0.35 : 1 }]} />
              <View style={styles.flex}>
                <Text style={[type.subhead, styles.label]} numberOfLines={1}>
                  {part.label}
                </Text>
                {part.caption ? (
                  <Text style={[type.caption1, styles.secondary]} numberOfLines={1}>
                    {part.caption}
                  </Text>
                ) : null}
              </View>
              <Text style={[type.footnote, styles.secondary]}>{`${share(part.value)}%`}</Text>
              <Text style={[type.subhead, type.amount, styles.label, styles.value]} numberOfLines={1}>
                {format(part.value)}
              </Text>
            </Pressable>
          );
        })}
        {current && onOpen ? (
          <Pressable
            onPress={() => {
              haptic.light();
              onOpen(current.key);
            }}
            style={({ pressed }) => [styles.open, pressed && styles.pressed]}
            accessibilityRole="link"
          >
            <Text style={[type.subhead, styles.accent]}>{openLabel ? openLabel(current) : `Подробнее: ${current.label}`}</Text>
            <SymbolView name="chevron.right" size={12} weight="semibold" tintColor={colors.accent} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.md },
  ring: { width: SIZE, height: SIZE, alignSelf: 'center' },
  center: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center', paddingHorizontal: THICK + 12 },
  legend: { gap: 2 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: 7,
    paddingHorizontal: space.sm,
    borderRadius: 10,
    borderCurve: 'continuous',
  },
  rowActive: { backgroundColor: colors.fill },
  pressed: { opacity: 0.6 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  flex: { flex: 1, minWidth: 0 },
  label: { color: colors.label },
  secondary: { color: colors.secondaryLabel },
  accent: { color: colors.accent },
  value: { minWidth: 84, textAlign: 'right' },
  open: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: space.sm, paddingTop: space.sm },
});
