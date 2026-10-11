// Нажимаемая поверхность: отклик (лёгкое сжатие и притухание) считается на
// UI-потоке жестом RNGH — кнопка отзывается сразу, даже если JS занят.
// Обработчик нажатия вызывается в JS после отпускания пальца.
import type { ReactNode } from 'react';
import type { AccessibilityRole, AccessibilityState, StyleProp, ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { markActivity } from '@/lib/activity';
import { haptic } from '@/lib/haptics';

import { motion } from './tokens';

/** Дольше — уже не нажатие (палец просто лёг на экран). */
const TAP_MAX_MS = 2000;

export type PressProps = {
  onPress?: () => void;
  disabled?: boolean;
  /** Насколько сжимается при нажатии (1 — не сжимается). */
  scaleTo?: number;
  haptics?: boolean;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
  accessibilityLabel?: string;
  accessibilityRole?: AccessibilityRole;
  accessibilityState?: AccessibilityState;
  hitSlop?: number;
};

export function Press({
  onPress, disabled, scaleTo = 0.97, haptics = true, style, children,
  accessibilityLabel, accessibilityRole = 'button', accessibilityState, hitSlop,
}: PressProps) {
  const pressed = useSharedValue(0);

  const fire = () => {
    markActivity();
    if (haptics) haptic.tap();
    onPress?.();
  };

  const tap = Gesture.Tap()
    .enabled(!disabled && !!onPress)
    .maxDuration(TAP_MAX_MS)
    .hitSlop(hitSlop ?? 0)
    .onBegin(() => {
      pressed.value = withTiming(1, { duration: motion.pressIn });
    })
    .onFinalize(() => {
      pressed.value = withTiming(0, { duration: motion.pressOut });
    })
    .onEnd((_e, success) => {
      if (success) scheduleOnRN(fire);
    });


  const dim = disabled ? 0.42 : 1;
  const animated = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - (1 - scaleTo) * pressed.value }],
    opacity: dim * (1 - 0.14 * pressed.value),
  }), [dim, scaleTo]);

  return (
    <GestureDetector gesture={tap}>
      <Animated.View
        accessible
        accessibilityRole={accessibilityRole}
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ disabled: !!disabled, ...accessibilityState }}
        onAccessibilityTap={disabled ? undefined : fire}
        style={[style, animated]}
      >
        {children}
      </Animated.View>
    </GestureDetector>
  );
}
