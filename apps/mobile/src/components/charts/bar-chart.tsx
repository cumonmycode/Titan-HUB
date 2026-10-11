import { useEffect, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';

import { Text } from '@/components/text';
import { haptic } from '@/lib/haptics';
import { FONT_SCALE_MAX } from '@/lib/text-scale';
import { colors, type } from '@/lib/theme';

export type BarPoint = { key: string; label: string; value: number };

/**
 * Столбчатый график с выбором: касание выбирает столбец (повторное — снимает), протяжка
 * пальцем по графику листает столбцы с тактильным щелчком — как в «Здоровье». Подписи и
 * переход по выбранному столбцу рисует экран над графиком: так один и тот же график
 * работает и в аналитике, и в ответах Tai.
 */
export function BarChart({
  points,
  color,
  selected,
  onSelect,
  height = 160,
  highlightKey,
  average,
}: {
  points: BarPoint[];
  color: string;
  selected: string | null;
  onSelect: (key: string | null) => void;
  height?: number;
  /** Лучший столбец — зелёный, пока ничего не выбрано. */
  highlightKey?: string | null;
  /** Пунктир среднего значения. */
  average?: number;
}) {
  const [width, setWidth] = useState(0);
  const reduceMotion = useReducedMotion();
  const grow = useSharedValue(reduceMotion ? 1 : 0);
  // Последний выбранный столбец — чтобы протяжка щёлкала только при смене столбца.
  const last = useSharedValue<string | null>(selected);

  useEffect(() => {
    if (!reduceMotion) grow.value = withTiming(1, { duration: 420, easing: Easing.out(Easing.cubic) });
  }, [grow, reduceMotion]);

  const growStyle = useAnimatedStyle(() => ({ transform: [{ scaleY: grow.value }] }));

  const count = points.length;
  const max = Math.max(1, ...points.map((p) => p.value));
  const gap = count > 40 ? 1 : count > 20 ? 2 : 4;
  const indexAt = (x: number) => Math.max(0, Math.min(count - 1, Math.floor((x / Math.max(width, 1)) * count)));

  const pick = (x: number, toggle: boolean) => {
    if (!count || !width) return;
    const key = points[indexAt(x)]!.key;
    const next = toggle && last.value === key ? null : key;
    if (next !== last.value) {
      last.value = next;
      haptic.selection();
      onSelect(next);
    }
  };

  // Протяжка по горизонтали листает столбцы; вертикальный жест отдаём прокрутке экрана.
  const scrub = Gesture.Pan()
    .runOnJS(true)
    .activeOffsetX([-6, 6])
    .failOffsetY([-12, 12])
    .onStart((e) => pick(e.x, false))
    .onUpdate((e) => pick(e.x, false));
  const tap = Gesture.Tap()
    .runOnJS(true)
    .onEnd((e) => pick(e.x, true));

  const labelEvery = Math.max(1, Math.ceil(count / Math.max(1, Math.floor(width / 46))));
  const dimmed = selected !== null;

  return (
    <View
      onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
      accessibilityRole="image"
      accessibilityLabel="График, коснитесь столбца, чтобы увидеть значение"
    >
      <GestureDetector gesture={Gesture.Exclusive(scrub, tap)}>
        <View style={{ height }}>
          <Animated.View style={[styles.bars, { gap, height }, growStyle]}>
            {points.map((point) => {
              const active = point.key === selected;
              const best = !dimmed && point.key === highlightKey && point.value > 0;
              return (
                <View key={point.key} style={styles.slot}>
                  <View
                    style={{
                      height: point.value > 0 ? Math.max(3, (point.value / max) * height) : 2,
                      borderRadius: count > 40 ? 1.5 : 4,
                      backgroundColor: point.value > 0 ? (best ? '#34C759' : color) : colors.fill,
                      opacity: dimmed && !active ? 0.3 : 1,
                    }}
                  />
                </View>
              );
            })}
          </Animated.View>
          {average !== undefined && average > 0 ? <View pointerEvents="none" style={[styles.average, { bottom: (average / max) * height }]} /> : null}
        </View>
      </GestureDetector>
      <View style={styles.labels}>
        {points.map((point, index) => (
          <View key={point.key} style={styles.slot}>
            {index % labelEvery === 0 ? (
              <Text
                style={[type.caption2, styles.label, point.key === selected && styles.labelActive]}
                numberOfLines={1}
                maxFontSizeMultiplier={FONT_SCALE_MAX.compact}
              >
                {point.label}
              </Text>
            ) : null}
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bars: { flexDirection: 'row', alignItems: 'flex-end', transformOrigin: 'bottom' },
  slot: { flex: 1, minWidth: 0, justifyContent: 'flex-end' },
  average: { position: 'absolute', left: 0, right: 0, borderTopWidth: 1, borderStyle: 'dashed', borderColor: colors.secondaryLabel },
  labels: { flexDirection: 'row', marginTop: 4 },
  label: { color: colors.tertiaryLabel, textAlign: 'left', overflow: 'visible', width: 44 },
  labelActive: { color: colors.label, fontWeight: '600' },
});
