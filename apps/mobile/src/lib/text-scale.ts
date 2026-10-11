// Крупный текст и режим «Увеличенный» (Display Zoom).
//
// «Увеличенный» вид iPhone отдаёт приложению экран уже — у 14 Pro 320 pt вместо 393, — а
// крупный текст (Настройки → Экран и яркость → Размер текста, или Универсальный доступ) растит
// шрифты. Оба режима оставляют тексту меньше места, поэтому раскладка решает по одной мере:
// ширине окна в «единицах текста» — сколько точек приходится на текст обычного размера.
import { Platform, useWindowDimensions } from 'react-native';

/**
 * Потолки множителя шрифта (maxFontSizeMultiplier). Системный крупный текст растёт до 3,5×
 * у основного текста — на телефоне это 3–4 буквы в строке. Основной текст доходит до
 * уровня «Универсального доступа», плотные элементы и крупные цифры растут меньше.
 */
export const FONT_SCALE_MAX = {
  /** Основной текст: всё обычное меню размеров (до 1,35×) и первые размеры Универсального доступа. */
  text: 2,
  /** Плотные элементы — подписи сегментов, бейджи, карточки сетки кассы, клавиатура PIN. */
  compact: 1.4,
  /** Крупные цифры и заголовки-герои (сумма чека 52 pt): им расти почти некуда. */
  display: 1.25,
} as const;

/** Системные стили текста iOS, по которым UIFontMetrics считает рост шрифта. */
export type TypeRamp = 'caption2' | 'caption1' | 'footnote' | 'subheadline' | 'callout' | 'body' | 'headline' | 'title3' | 'title2' | 'title1' | 'largeTitle';

/**
 * Стиль iOS по кеглю. Крупные стили растут медленнее мелких (Large Title на максимуме
 * обычного меню — 1,18×, сноска — 1,46×): так текст увеличивается, как в системных
 * приложениях, а не одним множителем для всех.
 */
export function rampForSize(size: number | undefined): TypeRamp | undefined {
  if (size == null || Platform.OS !== 'ios') return undefined;
  if (size >= 34) return 'largeTitle';
  if (size >= 28) return 'title1';
  if (size >= 22) return 'title2';
  if (size >= 20) return 'title3';
  if (size >= 17) return 'body';
  if (size >= 16) return 'callout';
  if (size >= 15) return 'subheadline';
  if (size >= 13) return 'footnote';
  if (size >= 12) return 'caption1';
  return 'caption2';
}

/**
 * Класс раскладки по ширине окна в единицах текста (ширина / множитель шрифта):
 * - regular — обычный телефон и обычный текст (от 360);
 * - compact — «Увеличенный» вид или крупный текст (300–359): подписи переносятся, сетки плотнее;
 * - tight — оба сразу или очень крупный текст (меньше 300): сетки — в одну колонку.
 *
 * Отдельно `stacked` (меньше 260 — размеры «Универсального доступа», или «Увеличенный» вид
 * с крупным текстом): строки «подпись — значение» встают в столбик, как в «Настройках» iOS.
 * Ориентиры для 14 Pro: 393 pt — regular, XXXL — 290 (tight); «Увеличенный» 320 pt — compact,
 * с XL — 286 (tight), с XXL — 259 (stacked).
 */
export type LayoutClass = 'regular' | 'compact' | 'tight';

const COMPACT_BELOW = 360;
const TIGHT_BELOW = 300;
const STACKED_BELOW = 260;

export type TextLayout = {
  /** Множитель шрифта системы (1 — обычный размер). */
  fontScale: number;
  /** Ширина окна, делённая на множитель шрифта (не больше потолка основного текста). */
  textWidth: number;
  layout: LayoutClass;
  /** Подписи и значения — в столбик, кнопки — друг под другом. */
  stacked: boolean;
};

/** Множитель, с которым на самом деле растёт основной текст: не меньше 1 и не выше потолка. */
export function effectiveTextScale(fontScale: number): number {
  return Math.min(Math.max(fontScale, 1), FONT_SCALE_MAX.text);
}

export function textLayoutFor(width: number, fontScale: number): TextLayout {
  const textWidth = width / effectiveTextScale(fontScale);
  const layout: LayoutClass = textWidth < TIGHT_BELOW ? 'tight' : textWidth < COMPACT_BELOW ? 'compact' : 'regular';
  return { fontScale, textWidth, layout, stacked: textWidth < STACKED_BELOW };
}

/** Текущая раскладка; пересчитывается при смене размера текста и повороте. */
export function useTextLayout(): TextLayout {
  const { width, fontScale } = useWindowDimensions();
  return textLayoutFor(width, fontScale);
}

/**
 * Размер значка рядом с текстом: SF Symbols в системе растут вместе с текстом, наши
 * SymbolView — нет. Растим умеренно (не больше потолка плотных элементов), чтобы значок
 * не терялся рядом с крупной подписью, а ряд не разъезжался.
 */
export function useScaledSize(size: number, max: number = FONT_SCALE_MAX.compact): number {
  const { fontScale } = useWindowDimensions();
  return Math.round(size * Math.min(Math.max(fontScale, 1), max));
}
