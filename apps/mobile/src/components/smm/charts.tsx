import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';

import { Text } from '@/components/text';
import { colors, space, type, useAccentHex } from '@/lib/theme';

/**
 * Простые графики аналитики СММ на обычных View: столбики по дням, горизонтальные
 * полосы с подписью и сетка показателей. Один акцентный цвет, без библиотек. При
 * появлении столбики вырастают, полосы заполняются — быстро, без отскока.
 */

const GROW_MS = 320;

/** 0 → 1 при появлении (с «Уменьшением движения» — сразу 1). */
function useGrow(): SharedValue<number> {
  const reduce = useReducedMotion();
  const grow = useSharedValue(reduce ? 1 : 0);
  useEffect(() => {
    if (!reduce) grow.set(withTiming(1, { duration: GROW_MS, easing: Easing.out(Easing.cubic) }));
  }, [grow, reduce]);
  return grow;
}

const fmt = (n: number) => n.toLocaleString('ru-RU');

/** Столбики по дням (охват, подписчики): высота — от минимума до максимума ряда. */
export function DayBars({ values, height = 56, fromZero }: { values: number[]; height?: number; fromZero?: boolean }) {
  const accent = useAccentHex();
  const grow = useGrow();
  const growStyle = useAnimatedStyle(() => ({ transform: [{ scaleY: grow.get() }] }));
  if (values.length < 3) return null;
  const max = Math.max(...values, 1);
  const min = fromZero ? 0 : Math.min(...values);
  return (
    <Animated.View style={[styles.bars, { height }, growStyle]} accessible accessibilityLabel={`График: от ${fmt(Math.min(...values))} до ${fmt(max)}`}>
      {values.map((v, i) => (
        <View key={i} style={[styles.bar, { height: 4 + ((v - min) / Math.max(max - min, 1)) * (height - 4), backgroundColor: accent }]} />
      ))}
    </Animated.View>
  );
}

/** Полоса с подписью слева и числом справа (форматы, дни недели, возраст). */
export function HBar({ label, value, max, note, strong }: { label: string; value: number; max: number; note?: string; strong?: boolean }) {
  const accent = useAccentHex();
  const grow = useGrow();
  const share = Math.max(3, (value / Math.max(max, 1)) * 100);
  const fillStyle = useAnimatedStyle(() => ({ width: `${share * grow.get()}%` }));
  return (
    <View style={styles.hbar}>
      <Text style={[type.footnote, styles.hbarLabel, strong && styles.bold]} numberOfLines={1}>
        {label}
      </Text>
      <View style={styles.hbarTrack}>
        <Animated.View style={[styles.hbarFill, { backgroundColor: accent, opacity: strong ? 1 : 0.55 }, fillStyle]} />
      </View>
      <Text style={[type.footnote, styles.hbarValue, strong && styles.bold]}>{note ?? fmt(value)}</Text>
    </View>
  );
}

export interface Metric {
  label: string;
  value: number | null | undefined;
  suffix?: string;
  hint?: string;
}

/** Сетка показателей: крупное число и подпись; пустые не показываем. */
export function MetricGrid({ items }: { items: Metric[] }) {
  const shown = items.filter((m) => m.value != null);
  if (!shown.length) return null;
  return (
    <View style={styles.grid}>
      {shown.map((m) => (
        <View key={m.label} style={styles.metric}>
          <Text style={[type.title3, styles.label, type.amount]}>{`${fmt(m.value!)}${m.suffix ?? ''}`}</Text>
          <Text style={[type.caption1, styles.secondary]} numberOfLines={2}>
            {m.label}
          </Text>
          {m.hint ? <Text style={[type.caption2, styles.secondary]}>{m.hint}</Text> : null}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { color: colors.label },
  secondary: { color: colors.secondaryLabel },
  bold: { fontWeight: '600', color: colors.label },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, transformOrigin: 'bottom' },
  bar: { flex: 1, borderRadius: 2, opacity: 0.8 },
  hbar: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  hbarLabel: { width: 92, color: colors.secondaryLabel },
  hbarTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: colors.fill, overflow: 'hidden' },
  hbarFill: { height: '100%', borderRadius: 4 },
  hbarValue: { minWidth: 44, textAlign: 'right', color: colors.secondaryLabel },
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: space.md, columnGap: space.lg },
  metric: { width: '28%', minWidth: 88, gap: 1 },
});
