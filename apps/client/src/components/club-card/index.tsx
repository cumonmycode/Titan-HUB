// Карта клуба в духе Apple Wallet: металл, голографическая фольга или пасс.
// Карта «ловит свет» при повороте телефона: датчик гравитации читается прямо на
// UI-потоке (Reanimated), а «ноль» медленно догоняет текущее положение — держите
// телефон спокойно, и карта выравнивается, как в Wallet. Пальцем карту тоже можно
// наклонить. Вид выбирается в «Профиль → Вид карты».
import { useIsFocused } from 'expo-router';
import type { ReactElement } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  SensorType, type SharedValue, useAnimatedReaction, useAnimatedSensor, useAnimatedStyle,
  useDerivedValue, useReducedMotion, useSharedValue, withSpring,
} from 'react-native-reanimated';

import { type CardStyle, useCardStyle } from '@/lib/card-style';
import { bonus as fmtBonus } from '@/lib/format';
import { haptic } from '@/lib/haptics';

import { FoilFace, MetalFace, PassFace } from './faces';
import { CARD_RATIO, type ClubCardData, type FaceProps } from './shared';

export type { ClubCardData } from './shared';

// Локальная копия для worklet-ов (они захватывают значения, а не модули).
const RATIO = CARD_RATIO;
/** Поворот телефона (доля g, ≈15°) для полного наклона карты. */
const FULL_TILT = 0.26;
/** Скорость, с которой «ноль» догоняет положение телефона (за отсчёт ~60 Гц): 1–2 с. */
const BASE_FOLLOW = 0.012;
/** Сглаживание дрожания датчика. */
const SMOOTH = 0.18;
const MAX_ROTATE_X = 7;
const MAX_ROTATE_Y = 9;
// Android отдаёт гравитацию с обратным знаком относительно iOS.
const AXIS_SIGN = Platform.OS === 'ios' ? 1 : -1;

const FACES: Record<CardStyle, (p: FaceProps) => ReactElement> = {
  metal: MetalFace,
  foil: FoilFace,
  pass: PassFace,
};

interface ClubCardProps {
  data: ClubCardData;
  /** Вид; по умолчанию — выбранный в профиле. */
  variant?: CardStyle;
  onPress?: () => void;
  /** false — без датчика (превью в списке). */
  motion?: boolean;
  /** false — карта не перехватывает касания (внутри листаемых страниц). */
  interactive?: boolean;
}

export function ClubCard({ data, variant, onPress, motion = true, interactive = true }: ClubCardProps) {
  const chosen = useCardStyle((s) => s.style);
  const Face = FACES[variant ?? chosen];
  const reduceMotion = useReducedMotion();
  const focused = useIsFocused();
  const sensorX = useSharedValue(0);
  const sensorY = useSharedValue(0);
  const fingerX = useSharedValue(0);
  const fingerY = useSharedValue(0);
  const finger = useSharedValue(0);
  const width = useSharedValue(0);

  // Палец перекрывает датчик, пока касается карты.
  const tx = useDerivedValue(() => sensorX.get() * (1 - finger.get()) + fingerX.get() * finger.get());
  const ty = useDerivedValue(() => sensorY.get() * (1 - finger.get()) + fingerY.get() * finger.get());

  // Горизонтальное ведение наклоняет карту; вертикальное отдаётся прокрутке экрана.
  const pan = Gesture.Pan()
    .activeOffsetX([-6, 6])
    .failOffsetY([-10, 10])
    .onBegin((e) => {
      const w = width.get();
      if (w <= 0) return;
      fingerX.set(Math.max(-1, Math.min(1, (e.x / w - 0.5) * 2)));
      fingerY.set(Math.max(-1, Math.min(1, (e.y / (w / RATIO) - 0.5) * 2)));
      finger.set(withSpring(1, { damping: 16, stiffness: 220 }));
    })
    .onUpdate((e) => {
      const w = width.get();
      if (w <= 0) return;
      fingerX.set(Math.max(-1, Math.min(1, (e.x / w - 0.5) * 2)));
      fingerY.set(Math.max(-1, Math.min(1, (e.y / (w / RATIO) - 0.5) * 2)));
    })
    .onFinalize(() => {
      finger.set(withSpring(0, { damping: 16, stiffness: 140 }));
    })
    .runOnJS(false);

  const tap = Gesture.Tap().onEnd(() => {
    if (!onPress) return;
    haptic.soft();
    onPress();
  }).runOnJS(true);

  const frame = useAnimatedStyle(() => ({
    transform: [
      { perspective: 1000 },
      { rotateX: `${-ty.get() * MAX_ROTATE_X}deg` },
      { rotateY: `${tx.get() * MAX_ROTATE_Y}deg` },
      { scale: 1 + 0.015 * finger.get() },
    ],
  }));

  const label = data.bonusHidden
    ? `Карта клуба, статус ${data.tierLabel}`
    : `Карта клуба, статус ${data.tierLabel}, ${fmtBonus(data.bonus)} бонусов${data.expiring ? `, ${data.expiring}` : ''}`;

  const card = (
      <Animated.View
        style={[styles.shadow, frame]}
        onLayout={(e) => width.set(e.nativeEvent.layout.width)}
        accessibilityRole={onPress ? 'button' : 'summary'}
        accessibilityLabel={label}
        accessibilityHint={onPress ? 'Открыть бонусную программу' : undefined}
      >
        {motion && focused && !reduceMotion ? <GravityTilt x={sensorX} y={sensorY} /> : null}
        <View style={styles.card} pointerEvents="none">
          <Face data={data} tx={tx} ty={ty} width={width} />
        </View>
      </Animated.View>
  );
  if (!interactive) return card;
  return <GestureDetector gesture={Gesture.Simultaneous(pan, tap)}>{card}</GestureDetector>;
}

/** Подписка на датчик — монтируется, только пока карта на видимом экране (бережём батарею). */
function GravityTilt({ x, y }: { x: SharedValue<number>; y: SharedValue<number> }) {
  const gravity = useAnimatedSensor(SensorType.GRAVITY, { interval: 'auto' });
  const base = useSharedValue({ x: 0, y: 0, ready: false });

  useAnimatedReaction(() => gravity.sensor.get(), (g) => {
    const m = Math.hypot(g.x, g.y, g.z);
    if (!m) return;
    const nx = (g.x / m) * AXIS_SIGN;
    const ny = (g.y / m) * AXIS_SIGN;
    const b = base.get();
    const bx = b.ready ? b.x + (nx - b.x) * BASE_FOLLOW : nx;
    const by = b.ready ? b.y + (ny - b.y) * BASE_FOLLOW : ny;
    base.set({ x: bx, y: by, ready: true });
    const targetX = Math.max(-1, Math.min(1, (nx - bx) / FULL_TILT));
    const targetY = Math.max(-1, Math.min(1, (ny - by) / FULL_TILT));
    x.set(x.get() + (targetX - x.get()) * SMOOTH);
    y.set(y.get() + (targetY - y.get()) * SMOOTH);
  });

  return null;
}

const styles = StyleSheet.create({
  shadow: {
    width: '100%',
    aspectRatio: CARD_RATIO,
    borderRadius: 20,
    borderCurve: 'continuous',
    boxShadow: '0 18px 36px rgba(0,0,0,0.45), 0 2px 6px rgba(0,0,0,0.3)',
  },
  card: {
    flex: 1,
    borderRadius: 20,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
});
