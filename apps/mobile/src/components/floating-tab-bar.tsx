import { useRouter } from 'expo-router';
import type { BottomTabBarProps } from 'expo-router/tabs';
import { SymbolView, type AndroidSymbol, type SFSymbol } from 'expo-symbols';
import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useKeyboardState } from 'react-native-keyboard-controller';
import Animated, { FadeInDown, FadeOutDown, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/text';
import { haptic } from '@/lib/haptics';
import { SHEET_ROUTES, TAB_BAR_GAP, TAB_BAR_HEIGHT } from '@/lib/tab-bar';
import { colors, space, springs, useAccentHex } from '@/lib/theme';

type Item = { key: string; label: string; icon: { ios: SFSymbol; android: AndroidSymbol }; action?: boolean };

/** Те же вкладки и значки, что у системного таб-бара iPhone (app/(app)/_layout.tsx). */
const ITEMS: Item[] = [
  { key: 'pos', label: 'Касса', icon: { ios: 'rublesign.circle', android: 'currency_ruble' } },
  { key: 'events', label: 'События', icon: { ios: 'calendar', android: 'calendar_month' } },
  // «Новый» — не вкладка, а кнопка: открывает шторку создания чека.
  { key: 'new', label: 'Новый', icon: { ios: 'plus.circle.fill', android: 'add_circle' }, action: true },
  { key: 'analytics', label: 'Отчёты', icon: { ios: 'chart.bar', android: 'bar_chart' } },
  { key: 'manage', label: 'Меню', icon: { ios: 'gearshape', android: 'settings' } },
];

const PAD = 6;

const routeKey = (name: string) => name.replace(/\/index$/, '');

/**
 * Панель вкладок Android в духе таб-бара iOS 26: плавающая капсула с отступами от краёв,
 * выбранная вкладка подсвечена «таблеткой», которая переезжает пружиной. Над капсулой —
 * плашка смены или чека (как BottomAccessory на iPhone), поэтому они больше не наезжают
 * друг на друга. Контент прокручивается под панелью; отступ под неё даёт useTabBarClearance.
 */
export function FloatingTabBar({ state, navigation, accessory }: BottomTabBarProps & { accessory: ReactNode }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const accent = useAccentHex();
  const keyboardOpen = useKeyboardState((s) => s.isVisible);
  const [width, setWidth] = useState(0);

  const focused = state.routes[state.index]!;
  const focusedKey = routeKey(focused.name);
  // Шторка внутри вкладки лежит в её области — на это время панель уезжает, как на iOS.
  const nested = focused.state as { index?: number; routes: { name: string }[] } | undefined;
  const nestedName = nested?.index != null ? nested.routes[nested.index]?.name : undefined;
  const sheetOpen = !!nestedName && !!SHEET_ROUTES[focusedKey]?.has(nestedName);
  const hidden = keyboardOpen || sheetOpen;

  const activeIndex = ITEMS.findIndex((item) => item.key === focusedKey);
  const itemWidth = width > 0 ? (width - PAD * 2) / ITEMS.length : 0;

  const pillX = useSharedValue(0);
  useEffect(() => {
    if (itemWidth <= 0 || activeIndex < 0) return;
    const target = PAD + activeIndex * itemWidth;
    // Первый раз — сразу на место, дальше таблетка переезжает пружиной.
    pillX.set(pillX.value === 0 ? target : withSpring(target, springs.snappy));
  }, [activeIndex, itemWidth, pillX]);
  const pillStyle = useAnimatedStyle(() => ({ transform: [{ translateX: pillX.value }] }));

  const away = useSharedValue(0);
  useEffect(() => {
    away.set(withTiming(hidden ? 1 : 0, { duration: 220 }));
  }, [hidden, away]);
  const barStyle = useAnimatedStyle(() => ({
    opacity: 1 - away.value,
    transform: [{ translateY: away.value * (TAB_BAR_HEIGHT + 40) }],
  }));

  const press = (item: Item) => {
    if (item.action) {
      haptic.light();
      router.push('/new-check');
      return;
    }
    const route = state.routes.find((r) => routeKey(r.name) === item.key);
    if (!route) return;
    haptic.selection();
    const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
    // Повторное нажатие на выбранную вкладку стек вкладки сам возвращает к её началу.
    if (route.key !== focused.key && !event.defaultPrevented) navigation.navigate(route.name, route.params);
  };

  return (
    <Animated.View
      pointerEvents={hidden ? 'none' : 'box-none'}
      style={[styles.wrap, { bottom: insets.bottom + TAB_BAR_GAP, left: insets.left + space.lg, right: insets.right + space.lg }, barStyle]}>
      {accessory ? (
        <Animated.View entering={FadeInDown.duration(220)} exiting={FadeOutDown.duration(180)}>
          {accessory}
        </Animated.View>
      ) : null}

      <View style={styles.capsule} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        {itemWidth > 0 && activeIndex >= 0 && (
          <Animated.View pointerEvents="none" style={[styles.pill, { width: itemWidth, backgroundColor: `${accent}24` }, pillStyle]} />
        )}
        {ITEMS.map((item) => {
          const selected = item.key === focusedKey;
          const tint = item.action || selected ? accent : colors.label;
          return (
            <Pressable
              key={item.key}
              onPress={() => press(item)}
              onLongPress={() => {
                const route = state.routes.find((r) => routeKey(r.name) === item.key);
                if (route && !item.action) navigation.emit({ type: 'tabLongPress', target: route.key });
              }}
              style={styles.item}
              accessibilityRole={item.action ? 'button' : 'tab'}
              accessibilityState={item.action ? undefined : { selected }}
              accessibilityLabel={item.label}>
              <SymbolView name={item.icon} size={item.action ? 26 : 24} tintColor={tint} />
              <Text style={[styles.label, { color: tint }, (selected || item.action) && styles.labelActive]} numberOfLines={1}>
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', gap: TAB_BAR_GAP },
  capsule: {
    height: TAB_BAR_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: PAD,
    borderRadius: TAB_BAR_HEIGHT / 2,
    backgroundColor: colors.floating,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.separator,
    elevation: 10,
  },
  pill: { position: 'absolute', left: 0, top: PAD, bottom: PAD, borderRadius: (TAB_BAR_HEIGHT - PAD * 2) / 2 },
  item: { flex: 1, height: '100%', alignItems: 'center', justifyContent: 'center', gap: 2 },
  label: { fontSize: 11, lineHeight: 13, fontWeight: '500' },
  labelActive: { fontWeight: '700' },
});
