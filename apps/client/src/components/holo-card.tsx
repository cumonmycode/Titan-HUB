// Голографическая карта клуба — главный элемент кошелька (как в веб-версии):
// переливающийся градиент, 3D-наклон за пальцем и блик, который бежит за касанием.
// Нажатие открывает бонусную программу; срок сгорания бонусов — строкой на самой карте.
import { useEffect, useState } from 'react';
import { type LayoutChangeEvent, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing, interpolate, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withSpring, withTiming,
} from 'react-native-reanimated';

import { bonus as fmtBonus } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { colors, holoGradient } from '@/lib/theme';

import { RollingNumber } from './rolling-number';
import { TierBadge } from './ui';

const CARD_HEIGHT = 212;
const TILT = 13;

export function HoloCard({
  nickname, tierLabel, tierColor, bonus, bonusHidden, memberSince, expiring, onPress,
}: {
  nickname: string;
  tierLabel: string;
  tierColor: string;
  bonus: number;
  bonusHidden: boolean;
  memberSince?: string;
  /** «120 сгорят через 3 дня» — показывается под суммой бонусов. */
  expiring?: string | null;
  onPress?: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const [width, setWidth] = useState(0);
  const shift = useSharedValue(0);
  const px = useSharedValue(0.5);
  const py = useSharedValue(0.5);
  const active = useSharedValue(0);

  // Медленный перелив градиента (аналог background-position 0→100% в вебе).
  useEffect(() => {
    if (reduceMotion) return;
    shift.set(withRepeat(withTiming(1, { duration: 9000, easing: Easing.inOut(Easing.sin) }), -1, true));
  }, [reduceMotion, shift]);

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  // Горизонтальное ведение наклоняет карту; вертикальное — отдаётся прокрутке
  // экрана (иначе карта «съедала» бы скролл). Касание сразу клонит карту к пальцу.
  const pan = Gesture.Pan()
    .activeOffsetX([-6, 6])
    .failOffsetY([-10, 10])
    .onBegin((e) => {
      if (width <= 0) return;
      px.set(Math.min(1, Math.max(0, e.x / width)));
      py.set(Math.min(1, Math.max(0, e.y / CARD_HEIGHT)));
      active.set(withSpring(1, { damping: 16, stiffness: 220 }));
    })
    .onUpdate((e) => {
      if (width <= 0) return;
      px.set(Math.min(1, Math.max(0, e.x / width)));
      py.set(Math.min(1, Math.max(0, e.y / CARD_HEIGHT)));
    })
    .onFinalize(() => {
      px.set(withSpring(0.5, { damping: 14, stiffness: 120 }));
      py.set(withSpring(0.5, { damping: 14, stiffness: 120 }));
      active.set(withSpring(0, { damping: 16, stiffness: 160 }));
    })
    .runOnJS(false);

  const tap = Gesture.Tap().onEnd(() => {
    haptic.soft();
    onPress?.();
  }).runOnJS(true);

  const cardStyle = useAnimatedStyle(() => ({
    transform: [
      { perspective: 900 },
      { rotateX: `${-(py.value - 0.5) * TILT * 2 * active.value}deg` },
      { rotateY: `${(px.value - 0.5) * TILT * 2 * active.value}deg` },
      { scale: 1 + 0.02 * active.value },
    ],
  }));
  const holoStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: interpolate(shift.value + (px.value - 0.5) * 0.35 * active.value, [0, 1], [0, -width * 2]) }],
  }));
  const glareStyle = useAnimatedStyle(() => ({
    opacity: 0.35 + 0.45 * active.value,
    transform: [
      { translateX: px.value * width - 170 },
      { translateY: py.value * CARD_HEIGHT - 170 },
    ],
  }));

  const since = memberSince ? new Date(memberSince).getFullYear() : null;

  return (
    <GestureDetector gesture={Gesture.Simultaneous(pan, tap)}>
      <Animated.View style={[styles.card, cardStyle]} onLayout={onLayout} accessibilityRole={onPress ? 'button' : 'summary'}
        accessibilityLabel={`${bonusHidden ? `Карта клуба, статус ${tierLabel}` : `Карта клуба, статус ${tierLabel}, ${fmtBonus(bonus)} бонусов`}${expiring ? `, ${expiring}` : ''}`}
        accessibilityHint={onPress ? 'Открыть бонусную программу' : undefined}>
        <Animated.View style={[styles.holo, { width: width * 3 }, holoStyle]} />
        <Animated.View style={[styles.glare, glareStyle]} pointerEvents="none" />
        <View style={styles.shade} pointerEvents="none" />
        <View style={styles.content} pointerEvents="none">
          <View style={styles.top}>
            <Text style={styles.brand}>TITAN</Text>
            <TierBadge label={tierLabel} color={tierColor} onCard />
          </View>
          <View style={styles.chip} />
          <View>
            {bonusHidden ? (
              <Text style={styles.soon}>Скоро тут появятся бонусы ⭐</Text>
            ) : (
              <>
                <Text style={styles.label}>Бонусный баланс</Text>
                <View style={styles.bonusRow}>
                  <RollingNumber value={bonus} format={fmtBonus} style={styles.bonus} />
                  <Text style={styles.star}> ⭐</Text>
                </View>
                {expiring ? <Text style={styles.expiring} numberOfLines={1}>🔥 {expiring}</Text> : null}
              </>
            )}
            <View style={styles.bottom}>
              <Text style={styles.nick} numberOfLines={1}>@{nickname || 'гость'}</Text>
              {since ? <Text style={styles.since}>с {since}</Text> : null}
            </View>
          </View>
        </View>
      </Animated.View>
    </GestureDetector>
  );
}

const shadowText = { textShadowColor: 'rgba(0,0,0,0.4)', textShadowRadius: 6, textShadowOffset: { width: 0, height: 1 } };

const styles = StyleSheet.create({
  card: {
    height: CARD_HEIGHT,
    borderRadius: 26,
    overflow: 'hidden',
    backgroundColor: colors.violetDeep,
    boxShadow: '0 18px 44px rgba(109,40,217,0.38)',
  },
  holo: { position: 'absolute', top: 0, bottom: 0, left: 0, experimental_backgroundImage: holoGradient },
  glare: {
    position: 'absolute', width: 340, height: 340, borderRadius: 170,
    experimental_backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0) 60%)',
  },
  shade: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    experimental_backgroundImage: 'linear-gradient(180deg, rgba(0,0,0,0.04) 0%, rgba(0,0,0,0.48) 100%)',
  },
  content: { flex: 1, padding: 22, justifyContent: 'space-between' },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brand: { color: '#fff', fontSize: 17, fontWeight: '900', letterSpacing: 3.5, ...shadowText },
  chip: {
    position: 'absolute', left: 22, top: 56, width: 38, height: 28, borderRadius: 7,
    experimental_backgroundImage: 'linear-gradient(135deg, #fde68a 0%, #d4a017 45%, #fef3c7 70%, #b8860b 100%)',
    opacity: 0.85,
  },
  label: { color: '#fff', opacity: 0.85, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', fontWeight: '600', ...shadowText },
  bonusRow: { flexDirection: 'row', alignItems: 'baseline', marginTop: 2 },
  bonus: { color: '#fff', fontSize: 42, lineHeight: 48, fontWeight: '900', fontStyle: 'italic', letterSpacing: -1, ...shadowText },
  star: { fontSize: 24, color: '#fff' },
  expiring: { color: '#fff', fontSize: 12.5, fontWeight: '700', opacity: 0.92, marginTop: -2, ...shadowText },
  soon: { color: '#fff', fontSize: 21, fontWeight: '800', fontStyle: 'italic', maxWidth: 240, lineHeight: 27, ...shadowText },
  bottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  nick: { color: '#fff', fontSize: 15, fontWeight: '700', opacity: 0.95, flexShrink: 1, ...shadowText },
  since: { color: '#fff', opacity: 0.7, fontSize: 12, fontWeight: '600', ...shadowText },
});
