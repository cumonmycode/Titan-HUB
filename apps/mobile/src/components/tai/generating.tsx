import { Blur, Canvas, FractalNoise, Image as SkiaImage, RadialGradient, Rect, useImage, vec } from '@shopify/react-native-skia';
import { useIsFocused } from 'expo-router';
import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { Easing, runOnJS, useDerivedValue, useFrameCallback, useReducedMotion, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';

import { Text } from '@/components/text';
import { useAuraPalette, withAlpha } from '@/lib/tai-aura';
import { type } from '@/lib/theme';

import { TaiMark } from './mark';

/*
 * Генерация картинки и видео в стиле «Аура» — «оттаивание»:
 *  • пока Tai рисует, в кадре под инеем кружат цвета будущей картинки;
 *  • когда картинка готова, она проступает из размытия, а иней тает.
 */

const EASE = Easing.out(Easing.cubic);
/** Тёплая палитра «рисунка»: так плитка не похожа на пустой серый скелетон. */
const PAINT = ['#7C3AED', '#E0763A', '#EC4899', '#F5C26B'];
const THAW_MS = 1100;
const BLUR_FROM = 26;

/** Кадр, в котором Tai сейчас рисует или снимает: цвета под инеем, знак и подпись. */
export function TaiGenerating({ width, height, label, hint }: { width: number; height: number; label: string; hint?: string }) {
  const reduce = useReducedMotion();
  const focused = useIsFocused();
  const time = useSharedValue(0);

  const frame = useFrameCallback((info) => {
    time.set(time.get() + Math.min(0.1, (info.timeSincePreviousFrame ?? 16) / 1000));
  }, false);
  useEffect(() => {
    frame.setActive(!reduce && focused);
  }, [frame, reduce, focused]);

  return (
    <View style={[styles.frame, { width, height }]}>
      <Canvas style={{ width, height }} pointerEvents="none">
        <Rect x={0} y={0} width={width} height={height} color="#140E22" />
        {PAINT.map((color, i) => (
          <PaintBlob key={color} index={i} color={color} width={width} height={height} time={time} />
        ))}
        {/* Иней: белая дымка и мелкое зерно поверх цвета. */}
        <Rect x={0} y={0} width={width} height={height} color="rgba(255,255,255,0.1)" />
        <Rect x={0} y={0} width={width} height={height} opacity={0.12}>
          <FractalNoise freqX={0.9} freqY={0.9} octaves={2} />
        </Rect>
      </Canvas>
      <View style={styles.center} pointerEvents="none">
        <TaiMark size={44} state="think" />
        <Text style={[type.subhead, styles.label]}>{label}</Text>
        {hint ? <Text style={[type.caption1, styles.hint]}>{hint}</Text> : null}
      </View>
    </View>
  );
}

function PaintBlob({ index, color, width, height, time }: { index: number; color: string; width: number; height: number; time: SharedValue<number> }) {
  const center = useDerivedValue(() => {
    const a = time.get() * 0.7 * (index % 2 ? 1 : -1) + index * 1.7;
    return vec(width * (0.5 + 0.3 * Math.cos(a)), height * (0.5 + 0.28 * Math.sin(a * 1.3)));
  });
  return (
    <Rect x={0} y={0} width={width} height={height}>
      <RadialGradient c={center} r={width * 0.62} colors={[withAlpha(color, 0.8), withAlpha(color, 0)]} />
    </Rect>
  );
}

/**
 * Готовая картинка проступает из-под инея: размытие тает за ~1 с. Потом экран
 * показывает обычный expo-image (`onDone`). Пока картинка грузится — кадр генерации.
 */
export function TaiRevealImage({ uri, width, height, onDone }: { uri: string; width: number; height: number; onDone: () => void }) {
  const pal = useAuraPalette();
  const reduce = useReducedMotion();
  const image = useImage(uri);
  const thaw = useSharedValue(0);
  const started = useRef(false);
  // Родитель передаёт новый onDone на каждом рендере — сама анимация из-за этого не перезапускается.
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  });

  useEffect(() => {
    if (!image || started.current) return;
    started.current = true;
    const finish = () => done.current();
    thaw.set(withTiming(1, { duration: reduce ? 1 : THAW_MS, easing: EASE }, (finished) => {
      if (finished) runOnJS(finish)();
    }));
  }, [image, reduce, thaw]);

  const blur = useDerivedValue(() => BLUR_FROM * (1 - thaw.get()));
  const frost = useDerivedValue(() => 0.3 * (1 - thaw.get()));
  const glow = useDerivedValue(() => 0.5 * Math.sin(Math.PI * thaw.get()));

  if (!image) return <TaiGenerating width={width} height={height} label="Почти готово…" />;
  return (
    <View style={[styles.frame, { width, height }]}>
      <Canvas style={{ width, height }} pointerEvents="none">
        <SkiaImage image={image} x={0} y={0} width={width} height={height} fit="cover">
          <Blur blur={blur} mode="clamp" />
        </SkiaImage>
        <Rect x={0} y={0} width={width} height={height} color="white" opacity={frost} />
        <Rect x={0} y={0} width={width} height={height} opacity={glow}>
          <RadialGradient c={vec(width / 2, height / 2)} r={Math.max(width, height) * 0.7} colors={[withAlpha(pal.violet, 0), withAlpha(pal.violet, 0.35)]} />
        </Rect>
      </Canvas>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { borderRadius: 20, borderCurve: 'continuous', overflow: 'hidden', backgroundColor: '#140E22' },
  center: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 24 },
  label: { color: 'white', fontWeight: '600', textAlign: 'center' },
  hint: { color: 'rgba(255,255,255,0.7)', textAlign: 'center' },
});
