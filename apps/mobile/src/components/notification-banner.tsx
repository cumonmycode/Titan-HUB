import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useEffectEvent, useMemo, useState } from 'react';
import { PanResponder, Pressable, StyleSheet, View } from 'react-native';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/text';
import { GlassView } from '@/components/glass';
import { type Banner, useBanner } from '@/lib/banner';
import { notificationLook } from '@/lib/notifications';
import { colors, space, springs, type } from '@/lib/theme';

const HIDDEN_Y = -160;
const VISIBLE_MS = 5000;

const SYSTEM_COLOR: Record<string, (typeof colors)[keyof typeof colors]> = {
  orange: colors.orange,
  green: colors.green,
  purple: colors.accent,
  cyan: colors.teal,
  red: colors.red,
  blue: colors.blue,
  indigo: colors.indigo,
  pink: colors.pink,
};

/**
 * Баннер важного события — стеклянная капсула сверху, как системные уведомления iOS.
 * Нажатие открывает чек, свайп вверх убирает.
 */
export function NotificationBanner() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const current = useBanner((s) => s.current);
  // Баннер остаётся на экране, пока доигрывает анимация ухода, хотя в сторе его уже нет.
  const [shown, setShown] = useState<Banner | null>(null);
  const [previous, setPrevious] = useState<Banner | null>(null);
  const y = useSharedValue(HIDDEN_Y);

  if (current !== previous) {
    setPrevious(current);
    if (current) setShown(current);
  }

  const dismiss = () => {
    y.set(
      withTiming(HIDDEN_Y, { duration: 220 }, (finished) => {
        if (finished) runOnJS(setShown)(null);
      }),
    );
    useBanner.getState().hide();
  };

  const onTimeout = useEffectEvent(dismiss);

  useEffect(() => {
    if (!current) return;
    y.set(HIDDEN_Y);
    y.set(withSpring(0, springs.snappy));
    const timer = setTimeout(onTimeout, VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [current, y]);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 6,
        onPanResponderMove: (_, g) => {
          y.set(Math.min(0, g.dy));
        },
        onPanResponderRelease: (_, g) => {
          if (g.dy < -30 || g.vy < -0.5) {
            y.set(
              withTiming(HIDDEN_Y, { duration: 220 }, (finished) => {
                if (finished) runOnJS(setShown)(null);
              }),
            );
            useBanner.getState().hide();
          } else {
            y.set(withSpring(0, springs.snappy));
          }
        },
      }),
    [y],
  );

  const style = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));

  if (!shown) return null;
  const look = notificationLook(shown.type);

  return (
    <Animated.View style={[styles.wrap, { top: insets.top + 6 }, style]} {...pan.panHandlers}>
      <GlassView isInteractive style={styles.glass}>
        <Pressable
          style={styles.row}
          onPress={() => {
            dismiss();
            if (shown.checkId && shown.type === 'chat_message') {
              router.push({ pathname: '/pos/[checkId]', params: { checkId: shown.checkId } });
              router.push({ pathname: '/chat', params: { checkId: shown.checkId } });
            } else if (shown.checkId) router.push({ pathname: '/pos/[checkId]', params: { checkId: shown.checkId } });
            else router.push('/notifications');
          }}
          accessibilityRole="button"
          accessibilityLabel={`${shown.title}. ${shown.body}`}>
          <View style={[styles.icon, { backgroundColor: SYSTEM_COLOR[look.color] ?? colors.accent }]}>
            <SymbolView name={look.icon} size={17} tintColor="white" animationSpec={{ effect: { type: 'bounce' } }} />
          </View>
          <View style={styles.texts}>
            <Text style={[type.headline, styles.title]} numberOfLines={1}>
              {shown.title}
            </Text>
            <Text style={[type.subhead, styles.body]} numberOfLines={2}>
              {shown.body}
            </Text>
          </View>
          <Text style={[type.caption1, styles.time]}>сейчас</Text>
        </Pressable>
      </GlassView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: space.sm + 2, right: space.sm + 2, zIndex: 1000 },
  glass: { borderRadius: 28, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md },
  icon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  texts: { flex: 1, minWidth: 0 },
  title: { color: colors.label },
  body: { color: colors.secondaryLabel },
  time: { color: colors.tertiaryLabel, alignSelf: 'flex-start', marginTop: 2 },
});
