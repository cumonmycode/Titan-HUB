// Значок «В эфире»: красная точка мягко пульсирует (опасити, без пружин) — эфир идёт сейчас.
import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

import { colors, radius, space } from '@/lib/theme';

const PULSE_MS = 900;

export function LiveBadge({ label = 'В эфире' }: { label?: string }) {
  const reduced = useReducedMotion();
  const o = useSharedValue(1);
  useEffect(() => {
    if (reduced) return;
    o.set(withRepeat(withTiming(0.35, { duration: PULSE_MS, easing: Easing.inOut(Easing.quad) }), -1, true));
  }, [o, reduced]);
  const pulse = useAnimatedStyle(() => ({ opacity: o.value }));
  return (
    <View style={styles.badge} accessible accessibilityLabel={label}>
      <Animated.View style={[styles.dot, pulse]} />
      <Text style={styles.text}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
    paddingHorizontal: space.md, paddingVertical: 5, borderRadius: radius.pill,
    backgroundColor: colors.redTint, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(248,113,113,0.35)',
  },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.red },
  text: { color: colors.red, fontSize: 12, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase' },
});
