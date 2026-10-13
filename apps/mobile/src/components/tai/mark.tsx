import { Canvas, Circle, Group, LinearGradient, RadialGradient, rect, rrect, vec } from '@shopify/react-native-skia';
import { useIsFocused } from 'expo-router';
import { memo, useEffect, useMemo } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { Easing, useDerivedValue, useFrameCallback, useReducedMotion, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';

import { MARK_PARAMS, useAuraPalette, withAlpha, type TaiMarkState } from '@/lib/tai-aura';

const EASE = Easing.out(Easing.cubic);
/** Доля стороны, которую занимает сфера: остальное — ореол. */
const SPHERE = 0.4;
/** С какого размера вокруг сферы расходятся кольца (думает, говорит). */
const RINGS_FROM = 40;

type Props = {
  size?: number;
  state?: TaiMarkState;
  /** Громкость голоса 0…1. Без неё в состоянии «Говорит» знак дышит сам. */
  level?: number;
  /**
   * Дышать в покое. По умолчанию знак в покое неподвижен: живым на экране должен быть
   * один знак (кнопка Tai в шапке, приветствие), остальные оживают, только когда Tai работает.
   */
  breathe?: boolean;
  style?: StyleProp<ViewStyle>;
};

/**
 * Знак Tai «Аура»: стеклянная сфера, внутри которой переливается свет — фиолетовый,
 * розовый, бирюзовый, янтарный. Думает — свет кружит быстрее и расходятся кольца,
 * пишет — течёт, говорит — сфера дышит в такт голосу, готово — короткая вспышка.
 * Рисует Skia, движение считает UI-поток; вне экрана и при «Уменьшении движения» стоит.
 */
export const TaiMark = memo(function TaiMark({ size = 22, state = 'idle', level, breathe = false, style }: Props) {
  const pal = useAuraPalette();
  const reduce = useReducedMotion();
  const focused = useIsFocused();
  const live = !reduce && focused && (breathe || state !== 'idle');

  const start = MARK_PARAMS[state];
  const speed = useSharedValue(start.speed);
  const spread = useSharedValue(start.spread);
  const energy = useSharedValue(start.energy);
  const glow = useSharedValue(start.glow);
  const flash = useSharedValue(0);
  const voice = useSharedValue(0);
  const ownVoice = useSharedValue(level == null);
  const phase = useSharedValue(0.6);
  const time = useSharedValue(0);

  useEffect(() => {
    const p = MARK_PARAMS[state];
    const cfg = { duration: reduce ? 0 : 450, easing: EASE };
    speed.set(withTiming(p.speed, cfg));
    spread.set(withTiming(p.spread, cfg));
    energy.set(withTiming(p.energy, cfg));
    glow.set(withTiming(p.glow, cfg));
    if (state === 'done' && !reduce) flash.set(withSequence(withTiming(1, { duration: 80 }), withTiming(0, { duration: 700, easing: EASE })));
  }, [state, reduce, speed, spread, energy, glow, flash]);

  useEffect(() => {
    ownVoice.set(level == null);
    if (level != null) voice.set(withTiming(level, { duration: 90 }));
  }, [level, ownVoice, voice]);

  const frame = useFrameCallback((info) => {
    const dt = Math.min(0.1, (info.timeSincePreviousFrame ?? 16) / 1000);
    const t = time.get() + dt;
    time.set(t);
    phase.set(phase.get() + speed.get() * dt);
    if (ownVoice.get()) voice.set(Math.abs(Math.sin(t * 7.1) * Math.sin(t * 2.7 + 1.1)) * (0.65 + 0.35 * Math.sin(t * 12.3)));
  }, false);

  useEffect(() => {
    frame.setActive(live);
  }, [frame, live]);

  const c = size / 2;
  const R = size * SPHERE;
  const clip = useMemo(() => rrect(rect(c - R, c - R, R * 2, R * 2), R, R), [c, R]);

  const pulse = useDerivedValue(() => [{ scale: 1 + 0.08 * energy.get() * voice.get() + 0.02 * Math.sin(time.get() * 1.3) + 0.04 * flash.get() }]);
  const halo = useDerivedValue(() => Math.min(1, (0.25 + 0.55 * glow.get() + 0.4 * flash.get()) * pal.glow));
  const shine = useDerivedValue(() => flash.get() * 0.55);
  const reach = (k: number, o: number) => {
    'worklet';
    const a = phase.get() * k + o;
    const s = R * (0.36 + 0.24 * spread.get());
    return vec(c + Math.cos(a) * s, c + Math.sin(a * 1.15) * s);
  };
  const rose = useDerivedValue(() => reach(1, 0));
  const sky = useDerivedValue(() => reach(-1.25, 2.1));
  const amber = useDerivedValue(() => reach(0.75, 4.1));

  const ringAmount = useDerivedValue(() => Math.max(spread.get() * 0.8, energy.get() * voice.get()));
  const ring = (offset: number) => {
    'worklet';
    return (time.get() * 0.85 + offset) % 1;
  };
  const ring1R = useDerivedValue(() => R * (1.04 + ring(0) * 0.2));
  const ring1O = useDerivedValue(() => (1 - ring(0)) * 0.45 * ringAmount.get());
  const ring2R = useDerivedValue(() => R * (1.04 + ring(0.5) * 0.2));
  const ring2O = useDerivedValue(() => (1 - ring(0.5)) * 0.45 * ringAmount.get());

  const center = vec(c, c);
  return (
    <View style={[{ width: size, height: size }, style]} pointerEvents="none" accessible={false}>
      <Canvas style={{ width: size, height: size }}>
        <Circle cx={c} cy={c} r={c} opacity={halo}>
          <RadialGradient c={center} r={c} colors={[withAlpha(pal.violet, 0.55), withAlpha(pal.violet, 0)]} positions={[SPHERE / 0.5, 1]} />
        </Circle>
        {size >= RINGS_FROM ? (
          <>
            <Circle cx={c} cy={c} r={ring1R} opacity={ring1O} style="stroke" strokeWidth={1.2} color={pal.violet} />
            <Circle cx={c} cy={c} r={ring2R} opacity={ring2O} style="stroke" strokeWidth={1.2} color={pal.violet} />
          </>
        ) : null}
        <Group transform={pulse} origin={center}>
          <Group clip={clip}>
            <Circle cx={c} cy={c} r={R}>
              <LinearGradient start={vec(c - R, c - R)} end={vec(c + R, c + R)} colors={[pal.iris, pal.violet]} />
            </Circle>
            <Circle cx={c} cy={c} r={R} blendMode="screen">
              <RadialGradient c={rose} r={R * 0.92} colors={[withAlpha(pal.rose, 0.9), withAlpha(pal.rose, 0)]} />
            </Circle>
            <Circle cx={c} cy={c} r={R} blendMode="screen">
              <RadialGradient c={sky} r={R * 0.92} colors={[withAlpha(pal.sky, 0.9), withAlpha(pal.sky, 0)]} />
            </Circle>
            <Circle cx={c} cy={c} r={R} blendMode="screen">
              <RadialGradient c={amber} r={R * 0.92} colors={[withAlpha(pal.peach, 0.85), withAlpha(pal.peach, 0)]} />
            </Circle>
            {/* Глубина: край сферы темнее середины. */}
            <Circle cx={c} cy={c} r={R}>
              <RadialGradient c={vec(c, c - R * 0.15)} r={R * 1.02} colors={['rgba(20,0,60,0)', 'rgba(20,0,60,0.32)']} positions={[0.44, 1]} />
            </Circle>
            {/* Блик стекла сверху слева и отражённый свет снизу. */}
            <Circle cx={c} cy={c} r={R}>
              <RadialGradient c={vec(c - R * 0.32, c - R * 0.42)} r={R * 0.62} colors={['rgba(255,255,255,0.92)', 'rgba(255,255,255,0.35)', 'rgba(255,255,255,0)']} positions={[0, 0.35, 1]} />
            </Circle>
            <Circle cx={c} cy={c} r={R}>
              <RadialGradient c={vec(c + R * 0.22, c + R * 0.78)} r={R * 0.55} colors={['rgba(255,255,255,0.38)', 'rgba(255,255,255,0)']} />
            </Circle>
            <Circle cx={c} cy={c} r={R} color="white" opacity={shine} />
          </Group>
          <Circle cx={c} cy={c} r={R - 0.5} style="stroke" strokeWidth={1} color="rgba(255,255,255,0.6)" />
        </Group>
      </Canvas>
    </View>
  );
});
