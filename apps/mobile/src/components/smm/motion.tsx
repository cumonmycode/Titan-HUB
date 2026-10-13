import { useEffect, type ReactNode } from 'react';
import { Pressable, StyleSheet, View, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  FadeInDown,
  LinearTransition,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { haptic } from '@/lib/haptics';
import { colors } from '@/lib/theme';

/**
 * Движение раздела «СММ» — быстрое и без отскока (медленные пружины владелец не хочет):
 * короткое появление снизу по очереди, перестановка строк за 180 мс, «вдавливание»
 * карточек при нажатии, пульс Tai, пока он работает, и скелетон с бегущим бликом. «Уменьшение движения» в системе — всё без анимации
 * (Reanimated соблюдает его сам, а циклы здесь не запускаются).
 */

const STAGGER_MS = 30;
const MAX_STAGGER = 6;
const EASE_OUT = Easing.out(Easing.cubic);

/** Появление элемента списка: коротко снизу, по очереди (первые шесть). */
export const appear = (index = 0) => FadeInDown.duration(200).delay(Math.min(index, MAX_STAGGER) * STAGGER_MS).easing(EASE_OUT);

/** Перестановка и изменение размеров соседей — быстро, без отскока. */
export const glide = LinearTransition.duration(180).easing(EASE_OUT);

export function Appear({ index = 0, children, style }: { index?: number; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <Animated.View entering={appear(index)} layout={glide} style={style}>
      {children}
    </Animated.View>
  );
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type PressScaleProps = Omit<PressableProps, 'style'> & {
  style?: StyleProp<ViewStyle>;
  /** Насколько «вдавливается»: 0.97 — карточка, 0.94 — маленькая кнопка. */
  scaleTo?: number;
  feedback?: 'selection' | 'light' | false;
};

/** Нажатие с «вдавливанием» (быстро, без отскока) и тактильным щелчком. */
export function PressScale({ style, scaleTo = 0.97, feedback = 'selection', onPressIn, onPressOut, onPress, disabled, children, ...rest }: PressScaleProps) {
  const scale = useSharedValue(1);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));
  return (
    <AnimatedPressable
      {...rest}
      disabled={disabled}
      onPressIn={(e) => {
        scale.set(withTiming(scaleTo, { duration: 80, easing: EASE_OUT }));
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        scale.set(withTiming(1, { duration: 120, easing: EASE_OUT }));
        onPressOut?.(e);
      }}
      onPress={(e) => {
        if (feedback) haptic[feedback]();
        onPress?.(e);
      }}
      style={[style, animated, disabled && styles.disabled]}>
      {children}
    </AnimatedPressable>
  );
}

/** Мягкий пульс (значок Tai, пока он работает). */
export function Pulse({ children, active = true }: { children: ReactNode; active?: boolean }) {
  const reduce = useReducedMotion();
  const t = useSharedValue(0);
  useEffect(() => {
    if (!active || reduce) {
      t.set(0);
      return;
    }
    t.set(withRepeat(withSequence(withTiming(1, { duration: 700, easing: Easing.inOut(Easing.sin) }), withTiming(0, { duration: 700, easing: Easing.inOut(Easing.sin) })), -1, false));
  }, [active, reduce, t]);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: 1 + t.get() * 0.14 }], opacity: 0.75 + t.get() * 0.25 }));
  return <Animated.View style={animated}>{children}</Animated.View>;
}

/** Блик, бегущий слева направо, — внутри шкалы или скелетона (родитель обрезает края). */
export function Sheen({ color = 'rgba(255,255,255,0.35)', duration = 1400 }: { color?: string; duration?: number }) {
  const reduce = useReducedMotion();
  const t = useSharedValue(0);
  useEffect(() => {
    if (reduce) return;
    t.set(withRepeat(withTiming(1, { duration, easing: Easing.inOut(Easing.quad) }), -1, false));
  }, [duration, reduce, t]);
  const animated = useAnimatedStyle(() => ({ left: `${-40 + t.get() * 140}%` }));
  if (reduce) return null;
  return <Animated.View pointerEvents="none" style={[styles.sheen, { backgroundColor: color }, animated]} />;
}

/** Скелетон: серый блок с бегущим бликом — пока что-то грузится или рисуется. */
export function Skeleton({ style }: { style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.skeleton, style]}>
      <Sheen color="rgba(255,255,255,0.18)" duration={1200} />
    </View>
  );
}

const styles = StyleSheet.create({
  disabled: { opacity: 0.5 },
  sheen: { position: 'absolute', top: 0, bottom: 0, width: '35%', borderRadius: 999 },
  skeleton: { overflow: 'hidden', backgroundColor: colors.fill, borderRadius: 14, borderCurve: 'continuous' },
});
