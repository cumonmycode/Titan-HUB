import { SymbolView } from 'expo-symbols';
import { useEffect } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { Text } from '@/components/text';
import { GlassView } from '@/components/glass';
import { haptic } from '@/lib/haptics';
import { FONT_SCALE_MAX } from '@/lib/text-scale';
import { colors, space, springs } from '@/lib/theme';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'delete'] as const;
export type PinKey = (typeof KEYS)[number];

const KEY_SIZE = 78;
/** Клавиши на невысоком экране: «Увеличенный» вид 14 Pro (320×693), iPhone SE. */
const KEY_SIZE_SHORT = 68;
const SHORT_SCREEN = 740;
const GAP_X = 28;

/** Точки PIN: заполняются пружиной, при ошибке экран встряхивается. */
export function PinDots({ length, filled, shakeKey }: { length: number; filled: number; shakeKey: number }) {
  const offset = useSharedValue(0);

  useEffect(() => {
    if (shakeKey === 0) return;
    offset.value = withSequence(
      withTiming(-14, { duration: 50 }),
      withTiming(12, { duration: 70 }),
      withTiming(-8, { duration: 70 }),
      withTiming(5, { duration: 60 }),
      withSpring(0, springs.snappy),
    );
  }, [shakeKey, offset]);

  const shake = useAnimatedStyle(() => ({ transform: [{ translateX: offset.value }] }));

  return (
    <Animated.View style={[styles.dots, shake]} accessibilityLabel={`Введено цифр: ${filled} из ${length}`}>
      {Array.from({ length }, (_, i) => (
        <Dot key={i} active={i < filled} />
      ))}
    </Animated.View>
  );
}

function Dot({ active }: { active: boolean }) {
  const scale = useSharedValue(1);

  useEffect(() => {
    if (active) {
      scale.value = withSequence(withTiming(1.25, { duration: 90 }), withSpring(1, springs.bouncy));
    }
  }, [active, scale]);

  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return <Animated.View style={[styles.dot, active && styles.dotActive, style]} />;
}

/** Цифровая клавиатура из стеклянных клавиш iOS 26. */
export function PinPad({ onKey, disabled, canDelete }: { onKey: (key: PinKey) => void; disabled?: boolean; canDelete: boolean }) {
  // Клавиатура по размеру экрана: на «Увеличенном» виде (320×693) клавиши 78 pt не помещались
  // по ширине и вместе с шапкой и кнопками выталкивали экран блокировки за край.
  const { width, height } = useWindowDimensions();
  const short = height < SHORT_SCREEN;
  const size = Math.min(short ? KEY_SIZE_SHORT : KEY_SIZE, Math.floor((width - 2 * space.xl - 2 * GAP_X) / 3));
  const cellSize = { width: size, height: size };
  const keyShape = { width: size, height: size, borderRadius: size / 2 };
  return (
    <View style={[styles.pad, { width: size * 3 + GAP_X * 2, rowGap: short ? 12 : 16 }]}>
      {KEYS.map((key, index) => {
        if (key === '') return <View key={index} style={[styles.cell, cellSize]} />;
        if (key === 'delete') {
          return (
            <Pressable
              key={index}
              style={[styles.cell, cellSize]}
              disabled={disabled || !canDelete}
              onPress={() => {
                haptic.selection();
                onKey('delete');
              }}
              accessibilityRole="button"
              accessibilityLabel="Стереть">
              {canDelete && <SymbolView name="delete.left" size={26} tintColor={colors.label} />}
            </Pressable>
          );
        }
        return (
          <View key={index} style={[styles.cell, cellSize]}>
            <GlassView isInteractive style={[styles.key, keyShape]}>
              <Pressable
                style={styles.keyPress}
                disabled={disabled}
                onPress={() => {
                  haptic.selection();
                  onKey(key);
                }}
                accessibilityRole="button"
                accessibilityLabel={key}>
                {/* Цифра в круге фиксированного размера растёт чуть-чуть, как у системной клавиатуры. */}
                <Text style={styles.digit} maxFontSizeMultiplier={FONT_SCALE_MAX.display}>
                  {key}
                </Text>
              </Pressable>
            </GlassView>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  dots: { flexDirection: 'row', gap: 22, justifyContent: 'center', paddingVertical: 8 },
  dot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: colors.label,
  },
  dotActive: { backgroundColor: colors.label },
  pad: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: GAP_X,
    alignSelf: 'center',
  },
  cell: { alignItems: 'center', justifyContent: 'center' },
  key: { overflow: 'hidden' },
  keyPress: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  digit: { fontSize: 34, fontWeight: '400', color: colors.label, fontVariant: ['tabular-nums'] },
});
