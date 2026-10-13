import { Canvas, Group, RadialGradient, Rect, RoundedRect, SweepGradient, vec } from '@shopify/react-native-skia';
import { useIsFocused } from 'expo-router';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { StyleSheet, useWindowDimensions, View, type LayoutChangeEvent, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useDerivedValue,
  useFrameCallback,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { GlassView } from '@/components/glass';
import { Text } from '@/components/text';
import { useAuraPalette, withAlpha, type TaiAuraPalette } from '@/lib/tai-aura';
import { radius } from '@/lib/theme';

/*
 * «Аура» — свет за матовым стеклом. Здесь три поверхности Tai:
 *  • TaiAuraBackdrop — живое свечение на весь экран чата;
 *  • TaiGlass — стеклянная карточка со светом изнутри; у предложения (ждёт решения)
 *    по краю бежит сияние, после решения оно гаснет;
 *  • ShimmerText — строка «что Tai делает сейчас» с бегущим по ней светом.
 * Живые эффекты рисует Skia в своём полотне: анимированный фон под десятками системных
 * стёкол заставлял бы их перерисовываться каждый кадр (см. ambient-backdrop).
 */

const EASE = Easing.out(Easing.cubic);
type Size = { width: number; height: number };

/* ─────────────────────────── Свечение экрана ─────────────────────────── */

type Blob = { x: number; y: number; r: number; color: keyof TaiAuraPalette; alpha: number };
const BLOBS: Blob[] = [
  { x: 0.1, y: 0.06, r: 0.8, color: 'violet', alpha: 0.3 },
  { x: 0.95, y: 0.32, r: 0.7, color: 'rose', alpha: 0.2 },
  { x: 0.35, y: 0.96, r: 0.85, color: 'sky', alpha: 0.2 },
  { x: 0.85, y: 0.82, r: 0.5, color: 'peach', alpha: 0.13 },
];

/** Медленно плывущее свечение под чатом Tai. `active` — Tai работает: свет ярче и быстрее. */
export function TaiAuraBackdrop({ active = false }: { active?: boolean }) {
  const pal = useAuraPalette();
  const reduce = useReducedMotion();
  const focused = useIsFocused();
  const { width, height } = useWindowDimensions();
  const time = useSharedValue(0);
  const boost = useSharedValue(active ? 1 : 0);

  useEffect(() => {
    boost.set(withTiming(active ? 1 : 0, { duration: reduce ? 0 : 900, easing: EASE }));
  }, [active, boost, reduce]);

  const frame = useFrameCallback((info) => {
    const dt = Math.min(0.1, (info.timeSincePreviousFrame ?? 16) / 1000);
    time.set(time.get() + dt * (0.6 + 0.9 * boost.get()));
  }, false);
  useEffect(() => {
    frame.setActive(!reduce && focused);
  }, [frame, reduce, focused]);

  return (
    <Canvas style={[styles.backdrop, { width, height }]} pointerEvents="none">
      {BLOBS.map((blob, i) => (
        <BackdropBlob key={blob.color} blob={blob} index={i} width={width} height={height} time={time} boost={boost} color={pal[blob.color] as string} glow={pal.glow} />
      ))}
    </Canvas>
  );
}

function BackdropBlob({ blob, index, width, height, time, boost, color, glow }: { blob: Blob; index: number; width: number; height: number; time: SharedValue<number>; boost: SharedValue<number>; color: string; glow: number }) {
  const r = blob.r * Math.max(width, height) * 0.6;
  const center = useDerivedValue(() => {
    const t = time.get();
    return vec((blob.x + 0.07 * Math.sin(t * 0.21 + index * 1.7)) * width, (blob.y + 0.05 * Math.cos(t * 0.17 + index * 2.3)) * height);
  });
  const opacity = useDerivedValue(() => Math.min(1, blob.alpha * glow * (1 + 0.6 * boost.get())));
  return (
    <Rect x={0} y={0} width={width} height={height} opacity={opacity}>
      <RadialGradient c={center} r={r} colors={[color, withAlpha(color, 0)]} />
    </Rect>
  );
}

/* ─────────────────────────── Стекло Tai ─────────────────────────── */

/** Свойства раскладки — снаружи (обёртка с сиянием), остальное — самому стеклу. */
const OUTER_KEYS = new Set([
  'flex', 'flexGrow', 'flexShrink', 'flexBasis', 'alignSelf', 'width', 'height', 'minWidth', 'minHeight', 'maxWidth', 'maxHeight',
  'margin', 'marginTop', 'marginBottom', 'marginLeft', 'marginRight', 'marginHorizontal', 'marginVertical', 'marginStart', 'marginEnd',
  'position', 'top', 'left', 'right', 'bottom', 'zIndex',
]);

function splitStyle(style: StyleProp<ViewStyle>) {
  const flat = (StyleSheet.flatten(style) ?? {}) as Record<string, unknown>;
  const entries = Object.entries(flat);
  const outer = Object.fromEntries(entries.filter(([key]) => OUTER_KEYS.has(key))) as ViewStyle;
  const inner = Object.fromEntries(entries.filter(([key]) => !OUTER_KEYS.has(key))) as ViewStyle;
  const fills = outer.flex != null || outer.height != null || outer.flexGrow != null || outer.minHeight != null;
  const corner = typeof flat.borderRadius === 'number' ? flat.borderRadius : radius.card;
  return { outer, inner: fills ? { ...inner, flexGrow: 1 } : inner, corner };
}

type GlassProps = {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Tai предлагает и ждёт решения: по краю бежит сияние. */
  proposal?: boolean;
  /** Решение принято — сияние гаснет, карточка остаётся обычным стеклом. */
  decided?: boolean;
  interactive?: boolean;
};

/** Стекло со светом изнутри — все карточки, которые показывает Tai. */
export function TaiGlass({ children, style, proposal = false, decided = false, interactive }: GlassProps) {
  const pal = useAuraPalette();
  const [size, setSize] = useState<Size | null>(null);
  const { outer, inner, corner } = useMemo(() => splitStyle(style), [style]);
  const waiting = proposal && !decided;

  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSize((prev) => (prev && Math.abs(prev.width - width) < 0.5 && Math.abs(prev.height - height) < 0.5 ? prev : { width, height }));
  };

  return (
    <View style={[outer, waiting && { boxShadow: `0 10px 30px -14px ${withAlpha(pal.violet, 0.55)}` }]} onLayout={onLayout}>
      <GlassView isInteractive={interactive} style={[styles.glass, { borderRadius: corner }, inner]}>
        {size ? <AuraFill size={size} corner={corner} pal={pal} /> : null}
        {children}
      </GlassView>
      {proposal && size ? <AuraRim size={size} corner={corner} pal={pal} active={waiting} /> : null}
    </View>
  );
}

/** Свет изнутри стекла: три мягких пятна палитры, неподвижные — дёшево и спокойно. */
function AuraFill({ size, corner, pal }: { size: Size; corner: number; pal: TaiAuraPalette }) {
  const { width, height } = size;
  const strength = 0.14 * pal.glow;
  const spots: { x: number; y: number; r: number; color: string }[] = [
    { x: 0.12, y: 0.15, r: 0.7, color: pal.violet },
    { x: 0.95, y: 0.9, r: 0.65, color: pal.rose },
    { x: 0.8, y: 0.05, r: 0.5, color: pal.sky },
  ];
  return (
    <Canvas style={[styles.fill, { width, height, borderRadius: corner }]} pointerEvents="none">
      {spots.map((s) => (
        <Rect key={s.color} x={0} y={0} width={width} height={height}>
          <RadialGradient c={vec(s.x * width, s.y * height)} r={s.r * Math.max(width, height)} colors={[withAlpha(s.color, strength), withAlpha(s.color, 0)]} />
        </Rect>
      ))}
    </Canvas>
  );
}

/** Сияние по краю карточки-предложения: цвета палитры обходят рамку по кругу. */
function AuraRim({ size, corner, pal, active }: { size: Size; corner: number; pal: TaiAuraPalette; active: boolean }) {
  const reduce = useReducedMotion();
  const focused = useIsFocused();
  const angle = useSharedValue(0);
  const opacity = useSharedValue(active ? 1 : 0);
  const { width, height } = size;

  useEffect(() => {
    opacity.set(withTiming(active ? 1 : 0, { duration: reduce ? 0 : 500, easing: EASE }));
  }, [active, opacity, reduce]);

  useEffect(() => {
    if (!active || reduce || !focused) {
      cancelAnimation(angle);
      return;
    }
    const from = angle.get() % (Math.PI * 2);
    angle.set(from);
    angle.set(withRepeat(withTiming(from + Math.PI * 2, { duration: 4500, easing: Easing.linear }), -1, false));
    return () => cancelAnimation(angle);
  }, [active, angle, focused, reduce]);

  const center = vec(width / 2, height / 2);
  const turn = useDerivedValue(() => [{ rotate: angle.get() }]);
  const inset = 0.75;
  return (
    <Canvas style={[styles.rim, { width, height }]} pointerEvents="none">
      <Group opacity={opacity}>
        <RoundedRect x={inset} y={inset} width={width - inset * 2} height={height - inset * 2} r={Math.max(0, corner - inset)} style="stroke" strokeWidth={1.5}>
          <SweepGradient c={center} colors={[pal.violet, pal.rose, pal.sky, pal.peach, pal.violet]} transform={turn} origin={center} />
        </RoundedRect>
      </Group>
    </Canvas>
  );
}

/* ─────────────────────────── Мерцающая строка ─────────────────────────── */

/** Полосы света: широкая фиолетовая, розовая и узкая бирюзовая сердцевина. */
const BANDS: { width: number; color: keyof TaiAuraPalette; opacity: number }[] = [
  { width: 84, color: 'violet', opacity: 0.55 },
  { width: 46, color: 'rose', opacity: 0.8 },
  { width: 16, color: 'sky', opacity: 1 },
];
const BAND_PAD = 50;

/**
 * Строка «что Tai делает сейчас»: вторичный текст, по которому слева направо бежит
 * цветной свет. Свет — это та же строка в цвете, видимая через узкое движущееся окно,
 * поэтому шрифт и переносы совпадают один в один.
 */
export function ShimmerText({ text, style }: { text: string; style?: StyleProp<TextStyle> }) {
  const pal = useAuraPalette();
  const reduce = useReducedMotion();
  const [width, setWidth] = useState(0);
  const x = useSharedValue(-BAND_PAD);

  useEffect(() => {
    if (!width || reduce) return;
    x.set(-BAND_PAD);
    x.set(withRepeat(withTiming(width + BAND_PAD, { duration: Math.max(1500, width * 9), easing: Easing.inOut(Easing.quad) }), -1, false));
    return () => cancelAnimation(x);
  }, [width, reduce, x]);

  return (
    <View style={styles.shimmer}>
      <Text style={[style, { color: pal.secondary }]} numberOfLines={1} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        {text}
      </Text>
      {width && !reduce
        ? BANDS.map((band) => <ShimmerBand key={band.color} x={x} band={band} color={pal[band.color] as string} text={text} style={style} textWidth={width} />)
        : null}
    </View>
  );
}

function ShimmerBand({ x, band, color, text, style, textWidth }: { x: SharedValue<number>; band: (typeof BANDS)[number]; color: string; text: string; style?: StyleProp<TextStyle>; textWidth: number }) {
  const half = band.width / 2;
  const window = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() - half }] }));
  const counter = useAnimatedStyle(() => ({ transform: [{ translateX: half - x.get() }] }));
  return (
    <Animated.View style={[styles.band, { width: band.width, opacity: band.opacity }, window]} pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <Animated.View style={[{ width: textWidth }, counter]}>
        <Text style={[style, { color }]} numberOfLines={1}>
          {text}
        </Text>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  backdrop: { position: 'absolute', left: 0, top: 0 },
  glass: { borderCurve: 'continuous', overflow: 'hidden' },
  fill: { position: 'absolute', left: 0, top: 0, overflow: 'hidden' },
  rim: { position: 'absolute', left: 0, top: 0 },
  shimmer: { flexShrink: 1, minWidth: 0 },
  band: { position: 'absolute', top: 0, bottom: 0, left: 0, overflow: 'hidden' },
});
