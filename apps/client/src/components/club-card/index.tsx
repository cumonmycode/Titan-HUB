// Карта клуба в духе Apple Wallet на настоящих текстурах (виды — faces.tsx).
// • Наклон: датчик гравитации на UI-потоке (Reanimated), «ноль» медленно догоняет
//   положение телефона — держите телефон спокойно, и карта выравнивается, как в Wallet.
// • Вращение (на главной): горизонтальный свайп крутит карту за пальцем, быстрый —
//   раскручивает с инерцией; карта ложится лицом или обратной стороной.
// Вид выбирается в «Профиль → Вид карты».
import { useIsFocused } from 'expo-router';
import { Platform, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation, type SharedValue, SensorType, useAnimatedReaction, useAnimatedSensor, useAnimatedStyle,
  useReducedMotion, useSharedValue, withDecay, withSpring,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { type CardStyle, useCardStyle } from '@/lib/card-style';
import { bonus as fmtBonus } from '@/lib/format';
import { haptic } from '@/lib/haptics';

import { CardBack } from './back';
import { CardFace, LOOKS } from './faces';
import { CARD_RATIO, type ClubCardData } from './shared';

export type { ClubCardData } from './shared';

/** Поворот телефона (доля g, ≈15°) для полного наклона карты. */
const FULL_TILT = 0.26;
/** Скорость, с которой «ноль» догоняет положение телефона (за отсчёт ~60 Гц): 1–2 с. */
const BASE_FOLLOW = 0.012;
/** Сглаживание дрожания датчика. */
const SMOOTH = 0.18;
const MAX_ROTATE_X = 7;
const MAX_ROTATE_Y = 9;
/** Градусов поворота на пиксель свайпа. */
const SPIN_PER_PX = 0.55;
/** Предел скорости раскрутки, °/с — чтобы карта не превращалась в пропеллер. */
const MAX_SPIN_VELOCITY = 2600;
/** Сдвиг пальца, после которого касание — уже свайп, а не нажатие. */
const TAP_SLOP = 10;
// Android отдаёт гравитацию с обратным знаком относительно iOS.
const AXIS_SIGN = Platform.OS === 'ios' ? 1 : -1;

interface ClubCardProps {
  data: ClubCardData;
  /** Вид; по умолчанию — выбранный в профиле. */
  variant?: CardStyle;
  onPress?: () => void;
  /** false — без датчика (неактивные превью). */
  motion?: boolean;
  /** false — карта не перехватывает касания (внутри листаемых лент). */
  interactive?: boolean;
}

export function ClubCard({ data, variant, onPress, motion = true, interactive = true }: ClubCardProps) {
  const chosen = useCardStyle((s) => s.style);
  const look = LOOKS[variant ?? chosen];
  const reduceMotion = useReducedMotion();
  const focused = useIsFocused();
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const spin = useSharedValue(0);
  const spinStart = useSharedValue(0);
  const width = useSharedValue(0);

  // Ложимся на ближайшую сторону (кратно 180°) мягкой пружиной.
  const settle = () => {
    'worklet';
    const target = Math.round(spin.get() / 180) * 180;
    if (Math.abs(spin.get() - target) < 0.5) { spin.set(target); return; }
    spin.set(withSpring(target, { damping: 14, stiffness: 120 }, (done) => {
      if (done) scheduleOnRN(haptic.soft);
    }));
  };

  const pan = Gesture.Pan()
    .activeOffsetX([-8, 8])
    .failOffsetY([-12, 12])
    // Касание ловит крутящуюся карту; отпустили без свайпа — она ложится на ближайшую сторону.
    .onBegin(() => { cancelAnimation(spin); spinStart.set(spin.get()); })
    .onUpdate((e) => { spin.set(spinStart.get() + e.translationX * SPIN_PER_PX); })
    .onEnd((e) => {
      const velocity = Math.max(-MAX_SPIN_VELOCITY, Math.min(MAX_SPIN_VELOCITY, e.velocityX * SPIN_PER_PX));
      if (Math.abs(velocity) < 250) { settle(); return; }
      spin.set(withDecay({ velocity, deceleration: 0.996 }, (done) => { if (done) settle(); }));
    })
    .onFinalize((_e, success) => { if (!success) settle(); })
    .runOnJS(false);

  // Нажатие открывает бонусы, только если карта лежала спокойно (а не была поймана на лету).
  const tap = Gesture.Tap().maxDistance(TAP_SLOP).onEnd(() => {
    if (!onPress || Math.abs(spinStart.get() % 180) > 1) return;
    haptic.soft();
    onPress();
  }).runOnJS(true);

  const front = useAnimatedStyle(() => ({
    transform: [
      { perspective: 1100 },
      { rotateY: `${spin.get() + tx.get() * MAX_ROTATE_Y}deg` },
      { rotateX: `${-ty.get() * MAX_ROTATE_X}deg` },
    ],
  }));
  const back = useAnimatedStyle(() => ({
    transform: [
      { perspective: 1100 },
      { rotateY: `${spin.get() + 180 + tx.get() * MAX_ROTATE_Y}deg` },
      { rotateX: `${-ty.get() * MAX_ROTATE_X}deg` },
    ],
  }));

  const label = data.bonusHidden
    ? `Карта клуба, статус ${data.tierLabel}`
    : `Карта клуба, статус ${data.tierLabel}, ${fmtBonus(data.bonus)} бонусов${data.expiring ? `, ${data.expiring}` : ''}`;

  const card = (
    <View
      style={styles.frame}
      onLayout={(e) => width.set(e.nativeEvent.layout.width)}
      accessible
      accessibilityRole={onPress ? 'button' : 'summary'}
      accessibilityLabel={label}
      accessibilityHint={onPress ? 'Открыть бонусную программу. Смахните в сторону, чтобы перевернуть карту' : undefined}
    >
      {motion && focused && !reduceMotion ? <GravityTilt x={tx} y={ty} /> : null}
      <Animated.View style={[styles.side, front]}>
        <View style={styles.clip} pointerEvents="none">
          <CardFace look={look} data={data} tx={tx} ty={ty} width={width} />
        </View>
      </Animated.View>
      {interactive ? (
        <Animated.View style={[styles.side, back]}>
          <View style={styles.clip} pointerEvents="none">
            <CardBack look={look} data={data} />
          </View>
        </Animated.View>
      ) : null}
    </View>
  );
  if (!interactive) return card;
  return <GestureDetector gesture={Gesture.Race(pan, tap)}>{card}</GestureDetector>;
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
  frame: { width: '100%', aspectRatio: CARD_RATIO },
  side: {
    ...StyleSheet.absoluteFill,
    borderRadius: 20,
    borderCurve: 'continuous',
    backfaceVisibility: 'hidden',
    boxShadow: '0 18px 36px rgba(0,0,0,0.45), 0 2px 6px rgba(0,0,0,0.3)',
  },
  clip: { flex: 1, borderRadius: 20, borderCurve: 'continuous', overflow: 'hidden' },
});
