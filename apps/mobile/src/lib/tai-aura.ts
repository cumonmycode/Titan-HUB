// «Аура» — оформление Tai: свет за матовым стеклом. Палитра и состояния знака.
// Цвета — конкретные строки, а не PlatformColor: их рисует Skia и смешивает Reanimated.
import { Platform, useColorScheme, type ImageSourcePropType } from 'react-native';

export type TaiAuraPalette = {
  violet: string;
  iris: string;
  rose: string;
  sky: string;
  peach: string;
  /** Основной текст — в него «остывают» только что появившиеся слова. */
  label: string;
  /** Вторичный текст — основа мерцающей строки «что делает Tai». */
  secondary: string;
  /** Сила свечения фона: в тёмной теме свет должен быть заметнее. */
  glow: number;
};

const LIGHT: TaiAuraPalette = {
  violet: '#7C3AED',
  iris: '#6366F1',
  rose: '#EC4899',
  sky: '#06B6D4',
  peach: '#F59E0B',
  label: '#000000',
  secondary: 'rgba(60,60,67,0.6)',
  glow: 1,
};

const DARK: TaiAuraPalette = {
  violet: '#A78BFA',
  iris: '#818CF8',
  rose: '#F472B6',
  sky: '#22D3EE',
  peach: '#FBBF24',
  label: '#FFFFFF',
  secondary: 'rgba(235,235,245,0.6)',
  glow: 1.45,
};

export function useAuraPalette(): TaiAuraPalette {
  return useColorScheme() === 'dark' ? DARK : LIGHT;
}

/** Что делает Tai: от этого зависит, как живёт знак. */
export type TaiMarkState = 'idle' | 'think' | 'write' | 'speak' | 'done';

/**
 * Параметры знака по состояниям: скорость перелива, разлёт света внутри сферы,
 * реакция на голос и сила ореола. Между состояниями знак переходит плавно.
 */
export const MARK_PARAMS: Record<TaiMarkState, { speed: number; spread: number; energy: number; glow: number }> = {
  idle: { speed: 0.45, spread: 0, energy: 0, glow: 0.15 },
  think: { speed: 2.3, spread: 1, energy: 0.25, glow: 0.6 },
  write: { speed: 1.3, spread: 0.3, energy: 0.15, glow: 0.45 },
  speak: { speed: 0.8, spread: 0.15, energy: 1, glow: 0.5 },
  done: { speed: 0.3, spread: 0, energy: 0, glow: 0.35 },
};

/** `#RRGGBB` или `rgba(r,g,b,a)` → [r, g, b, a] (0…255, альфа 0…1). */
export function parseColor(color: string): [number, number, number, number] {
  if (color.startsWith('#')) {
    const n = parseInt(color.slice(1, 7), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const parts = color.replace(/[^\d.,]/g, '').split(',').map(Number);
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts[3] ?? 1];
}

/** Цвет с другой прозрачностью — для градиентов Skia. */
export function withAlpha(color: string, alpha: number): string {
  const [r, g, b] = parseColor(color);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Смесь двух цветов: t = 0 — первый, 1 — второй. */
export function mixColor(a: string, b: string, t: number): string {
  const x = parseColor(a);
  const y = parseColor(b);
  const k = Math.min(1, Math.max(0, t));
  const ch = (i: number) => Math.round(x[i]! + (y[i]! - x[i]!) * k);
  const alpha = x[3] + (y[3] - x[3]) * k;
  return `rgba(${ch(0)},${ch(1)},${ch(2)},${alpha.toFixed(3)})`;
}

/** Статичная сфера для нативных кнопок шапки, где свой рисунок не встроить. */
export const TAI_MARK_IMAGE: ImageSourcePropType = require('../../assets/images/tai-mark.png');

/**
 * Иконка кнопки «Спросить Tai» в нативной шапке: на iOS — сфера Ауры в исходных цветах
 * (iconRenderingMode="original"), на Android шапка перекрашивает картинки в один цвет —
 * там остаётся символ «искры».
 */
export const TAI_TOOLBAR_ICON = Platform.OS === 'ios' ? TAI_MARK_IMAGE : ('sparkles' as const);
