// Нажимаемая область: пружинит при нажатии и даёт лёгкий тактильный отклик.
import type { ReactNode } from 'react';
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { haptic } from '@/lib/haptics';
import { springs } from '@/lib/theme';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export interface TapProps extends PressableProps {
  style?: StyleProp<ViewStyle>;
  scaleTo?: number;
  hapticOnPress?: boolean;
  children?: ReactNode;
}

export function Tap({ children, style, scaleTo = 0.97, hapticOnPress = true, onPress, disabled, ...rest }: TapProps) {
  const scale = useSharedValue(1);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <AnimatedPressable
      {...rest}
      disabled={disabled}
      onPressIn={(e) => { scale.set(withSpring(scaleTo, springs.snappy)); rest.onPressIn?.(e); }}
      onPressOut={(e) => { scale.set(withSpring(1, springs.snappy)); rest.onPressOut?.(e); }}
      onPress={(e) => { if (hapticOnPress) haptic.tap(); onPress?.(e); }}
      style={[style, animated, disabled && { opacity: 0.5 }]}
    >
      {children}
    </AnimatedPressable>
  );
}
