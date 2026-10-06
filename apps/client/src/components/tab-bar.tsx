// Панель вкладок Android: плавающая тёмная капсула, выбранная вкладка подсвечена
// «таблеткой», которая переезжает пружиной. На iOS вместо неё системный таб-бар
// Liquid Glass (app/(tabs)/_layout.tsx).
import type { BottomTabBarProps } from 'expo-router/tabs';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { haptic } from '@/lib/haptics';
import { colors, IS_IOS, springs } from '@/lib/theme';

import { Icon, type IconName } from './icon';

export const TAB_BAR_HEIGHT = 64;
const PAD = 6;

/** Нижний отступ контента над капсулой (Android). На iOS отступ даёт система. */
export function useTabClearance(): number {
  const insets = useSafeAreaInsets();
  return IS_IOS ? 0 : TAB_BAR_HEIGHT + Math.max(insets.bottom, 12) + 20;
}

const SLOTS: { key: string; label: string; icon: IconName }[] = [
  { key: '(home)', label: 'Главная', icon: 'wallet' },
  { key: 'history', label: 'История', icon: 'history' },
  { key: 'profile', label: 'Профиль', icon: 'person' },
];

export function TabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const [width, setWidth] = useState(0);

  const focusedName = state.routes[state.index]?.name ?? '(home)';
  const slotIndex = Math.max(0, SLOTS.findIndex((s) => s.key === focusedName));
  const slotWidth = width > 0 ? (width - PAD * 2) / SLOTS.length : 0;

  const x = useSharedValue(0);
  useEffect(() => {
    if (slotWidth > 0) x.set(withSpring(PAD + slotIndex * slotWidth, springs.snappy));
  }, [slotIndex, slotWidth, x]);
  const pill = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, 12) }]}>
      <View style={styles.bar} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        {slotWidth > 0 ? <Animated.View style={[styles.pill, { width: slotWidth }, pill]} /> : null}
        {SLOTS.map((slot) => {
          const route = state.routes.find((r) => r.name === slot.key);
          const focused = focusedName === slot.key;
          const onPress = () => {
            if (!route) return;
            const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (!focused && !event.defaultPrevented) {
              haptic.select();
              navigation.navigate(route.name, route.params);
            }
          };
          return (
            <Pressable
              key={slot.key}
              onPress={onPress}
              style={styles.slot}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={slot.label}
            >
              <Icon name={slot.icon} size={23} color={focused ? colors.lavender : colors.textSecondary} />
              <Text style={[styles.label, focused && styles.labelOn]}>{slot.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center', paddingHorizontal: 14 },
  bar: {
    width: '100%', maxWidth: 420, height: TAB_BAR_HEIGHT, borderRadius: 32,
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: PAD,
    backgroundColor: 'rgba(29,26,36,0.96)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)',
    boxShadow: '0 12px 32px rgba(0,0,0,0.45)',
  },
  pill: {
    position: 'absolute', left: 0, top: PAD, bottom: PAD, borderRadius: 26,
    backgroundColor: 'rgba(139,92,246,0.16)', borderWidth: 1, borderColor: 'rgba(139,92,246,0.25)',
  },
  slot: { flex: 1, height: '100%', alignItems: 'center', justifyContent: 'center', gap: 2 },
  label: { fontSize: 10.5, fontWeight: '600', color: colors.textSecondary },
  labelOn: { color: colors.lavender, fontWeight: '700' },
});
