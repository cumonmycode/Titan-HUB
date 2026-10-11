// Android-двойники модификаторов @expo/ui/swift-ui.
//
// В SwiftUI модификатор — нативный дескриптор. Здесь это простой объект {$type, …},
// который компоненты из ./index.tsx читают через resolve() и переводят в стили RN.
// Модификаторы, у которых на Android нет смысла (стекло, курсив SF), сохраняются
// в списке, но игнорируются при рендере — экраны при этом остаются рабочими.
import { Platform, type ColorValue, type KeyboardTypeOptions, type TextStyle, type ViewStyle } from 'react-native';

import { colors } from '@/lib/theme';

export type ViewModifier = { $type: string; [key: string]: unknown };

const mod = (type: string, payload: Record<string, unknown> = {}): ViewModifier => ({ $type: type, ...payload });

/** Шрифт: либо системный стиль (`textStyle`), либо размер с насыщенностью. */
export const font = (spec: { size?: number; weight?: TextStyle['fontWeight'] | string; design?: 'default' | 'rounded' | 'monospaced' | 'serif'; textStyle?: string }) => mod('font', { spec });
export const foregroundStyle = (color: ColorValue) => mod('foregroundStyle', { color });
export const tint = (color: ColorValue) => mod('tint', { color });
export const background = (color: ColorValue, shape?: ViewModifier) => mod('background', { color, shape });
export const frame = (spec: { width?: number; height?: number; minWidth?: number; maxWidth?: number; minHeight?: number; maxHeight?: number }) => mod('frame', { spec });
export const monospacedDigit = () => mod('monospacedDigit');
export const disabled = (value = true) => mod('disabled', { value });

/** Стили контролов: на Android влияют на оформление наших RN-двойников. */
export const pickerStyle = (style: 'segmented' | 'menu' | 'wheel' | 'inline' | 'automatic' | string) => mod('pickerStyle', { style });
export const buttonStyle = (style: string) => mod('buttonStyle', { style });
export const buttonBorderShape = (shape: string) => mod('buttonBorderShape', { shape });
export const controlSize = (size: 'mini' | 'small' | 'regular' | 'large' | 'extraLarge' | string) => mod('controlSize', { size });
export const labelStyle = (style: string) => mod('labelStyle', { style });
export const menuStyle = (style: string) => mod('menuStyle', { style });
export const listStyle = (style: string) => mod('listStyle', { style });
export const scrollContentBackground = (visibility: 'visible' | 'hidden' | string) => mod('scrollContentBackground', { visibility });
export const multilineTextAlignment = (alignment: 'center' | 'leading' | 'trailing') => mod('multilineTextAlignment', { alignment });
export const lineLimit = (limit?: number) => mod('lineLimit', { limit });
export const labelsHidden = () => mod('labelsHidden');
export const layoutPriority = (value: number) => mod('layoutPriority', { value });

/** Текстовые поля. */
export const keyboardType = (type: KeyboardTypeOptions | string) => mod('keyboardType', { type });
export const submitLabel = (label: string) => mod('submitLabel', { label });
export const onSubmit = (handler: () => void) => mod('onSubmit', { handler });
export const autocorrectionDisabled = (value = true) => mod('autocorrectionDisabled', { value });
export const textContentType = (type: string) => mod('textContentType', { type });
export const textInputAutocapitalization = (mode: 'never' | 'words' | 'sentences' | 'characters' | string) => mod('textInputAutocapitalization', { mode });

/** Списки и окружение. */
export const refreshable = (handler: () => Promise<void> | void) => mod('refreshable', { handler });
export const environment = (key: string, value: unknown) => mod('environment', { key, value });
export const tag = (value: unknown) => mod('tag', { value });

/** Анимации: RN-двойники перерисовываются сами, поэтому дескриптор только хранится. */
export const animation = (animation: unknown, value?: unknown) => mod('animation', { animation, value });
export const contentTransition = (kind: string) => mod('contentTransition', { kind });

export const Animation = {
  default: { kind: 'default' },
  spring: (config?: unknown) => ({ kind: 'spring', config }),
  easeInOut: (config?: unknown) => ({ kind: 'easeInOut', config }),
  easeIn: (config?: unknown) => ({ kind: 'easeIn', config }),
  easeOut: (config?: unknown) => ({ kind: 'easeOut', config }),
  linear: (config?: unknown) => ({ kind: 'linear', config }),
};

export const shapes = {
  circle: () => mod('shape', { shape: 'circle' }),
  capsule: () => mod('shape', { shape: 'capsule' }),
  rectangle: () => mod('shape', { shape: 'rectangle' }),
  roundedRectangle: (spec?: { cornerRadius?: number }) => mod('shape', { shape: 'roundedRectangle', cornerRadius: spec?.cornerRadius }),
};

// ——— чтение модификаторов компонентами ———

const WEIGHTS: Record<string, TextStyle['fontWeight']> = {
  ultraLight: '100', thin: '200', light: '300', regular: '400',
  medium: '500', semibold: '600', bold: '700', heavy: '800', black: '900',
};

/** Размеры системных текстовых стилей iOS — чтобы Android читался так же. */
const TEXT_STYLES: Record<string, { fontSize: number; lineHeight: number }> = {
  largeTitle: { fontSize: 34, lineHeight: 41 },
  title: { fontSize: 28, lineHeight: 34 },
  title2: { fontSize: 22, lineHeight: 28 },
  title3: { fontSize: 20, lineHeight: 25 },
  headline: { fontSize: 17, lineHeight: 22 },
  body: { fontSize: 17, lineHeight: 22 },
  callout: { fontSize: 16, lineHeight: 21 },
  subheadline: { fontSize: 15, lineHeight: 20 },
  footnote: { fontSize: 13, lineHeight: 18 },
  caption: { fontSize: 12, lineHeight: 16 },
  caption2: { fontSize: 11, lineHeight: 13 },
};

export type ResolvedModifiers = {
  style: ViewStyle;
  text: TextStyle;
  tint?: ColorValue;
  pickerStyle?: string;
  buttonStyle?: string;
  controlSize?: string;
  listStyle?: string;
  labelStyle?: string;
  borderShape?: string;
  keyboardType?: KeyboardTypeOptions;
  submitLabel?: string;
  onSubmit?: () => void;
  autocorrect?: boolean;
  autocapitalize?: 'none' | 'words' | 'sentences' | 'characters';
  refresh?: () => Promise<void> | void;
  disabled?: boolean;
  tag?: unknown;
  editMode?: boolean;
  hideScrollBackground?: boolean;
  lineLimit?: number;
  labelsHidden?: boolean;
  /** frame(maxWidth: .infinity): вью занимает всю ширину, соседи в ряду делят её поровну. */
  fill?: boolean;
};

/** maxWidth от этого значения — это `.infinity` SwiftUI (экраны пишут 10_000). */
const INFINITE_WIDTH = 10_000;

/**
 * SwiftUI принимает в foregroundStyle и имена цветов ('red'), и иерархию
 * ({ type: 'hierarchical', style: 'secondary' }). RN такие значения цветом не считает:
 * объект превращался в «нет цвета», и текст на тёмной теме становился чёрным.
 */
const NAMED_COLORS: Record<string, ColorValue> = {
  red: colors.red,
  green: colors.green,
  orange: colors.orange,
  yellow: colors.yellow,
  blue: colors.blue,
  purple: colors.purple,
  pink: colors.pink,
  gray: colors.gray,
  mint: colors.mint,
  teal: colors.teal,
  cyan: colors.cyan,
  indigo: colors.indigo,
  brown: colors.brown,
  primary: colors.label,
  secondary: colors.secondaryLabel,
};

const HIERARCHY: Record<string, ColorValue> = {
  primary: colors.label,
  secondary: colors.secondaryLabel,
  tertiary: colors.tertiaryLabel,
  quaternary: colors.tertiaryLabel,
};

function foregroundColor(value: unknown): TextStyle['color'] {
  if (typeof value === 'string') return (NAMED_COLORS[value] ?? value) as TextStyle['color'];
  if (value && typeof value === 'object') {
    const spec = value as { type?: string; style?: string };
    if (spec.type === 'hierarchical' && spec.style) return HIERARCHY[spec.style] as TextStyle['color'];
    // PlatformColor и DynamicColor — тоже объекты, их RN понимает сам.
    if (!('type' in spec)) return value as TextStyle['color'];
  }
  return undefined;
}

const CAPITALIZE: Record<string, ResolvedModifiers['autocapitalize']> = {
  never: 'none', words: 'words', sentences: 'sentences', characters: 'characters',
};

/** Переводит список модификаторов в стили и пропсы React Native. */
export function resolve(modifiers?: ViewModifier[] | null): ResolvedModifiers {
  const out: ResolvedModifiers = { style: {}, text: {} };
  for (const m of modifiers ?? []) {
    if (!m || typeof m !== 'object') continue;
    switch (m.$type) {
      case 'font': {
        const spec = m.spec as { size?: number; weight?: string; design?: string; textStyle?: string };
        if (spec?.textStyle && TEXT_STYLES[spec.textStyle]) Object.assign(out.text, TEXT_STYLES[spec.textStyle]);
        if (spec?.size) out.text.fontSize = spec.size;
        if (spec?.weight) out.text.fontWeight = WEIGHTS[spec.weight] ?? (spec.weight as TextStyle['fontWeight']);
        if (spec?.design === 'monospaced') out.text.fontVariant = ['tabular-nums'];
        // Скруглённый SF Pro есть только на iOS; на Android остаётся системный шрифт.
        if (spec?.design === 'rounded' && Platform.OS === 'ios') out.text.fontFamily = 'ui-rounded';
        break;
      }
      case 'foregroundStyle': {
        const color = foregroundColor(m.color);
        if (color !== undefined) out.text.color = color;
        break;
      }
      case 'tint':
        out.tint = m.color as ColorValue;
        break;
      case 'background': {
        out.style.backgroundColor = m.color as string;
        const shape = m.shape as ViewModifier | undefined;
        if (shape?.shape === 'circle' || shape?.shape === 'capsule') out.style.borderRadius = 9999;
        else if (shape?.shape === 'roundedRectangle') out.style.borderRadius = (shape.cornerRadius as number) ?? 12;
        break;
      }
      case 'frame': {
        const spec = m.spec as Record<string, number>;
        // Раньше maxWidth: .infinity становился просто ограничением ширины: плитки показателей
        // и кнопки «Внести / Изъять» не растягивались и жались к левому краю.
        if (spec?.maxWidth != null && spec.maxWidth >= INFINITE_WIDTH) out.fill = true;
        for (const key of ['width', 'height', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight'] as const) {
          if (key === 'maxWidth' && out.fill) continue;
          if (spec?.[key] != null) (out.style as Record<string, unknown>)[key] = spec[key];
        }
        break;
      }
      case 'monospacedDigit':
        out.text.fontVariant = ['tabular-nums'];
        break;
      case 'pickerStyle': out.pickerStyle = m.style as string; break;
      case 'buttonStyle': out.buttonStyle = m.style as string; break;
      case 'controlSize': out.controlSize = m.size as string; break;
      case 'listStyle': out.listStyle = m.style as string; break;
      case 'labelStyle': out.labelStyle = m.style as string; break;
      case 'buttonBorderShape': out.borderShape = m.shape as string; break;
      case 'keyboardType': out.keyboardType = m.type as KeyboardTypeOptions; break;
      case 'submitLabel': out.submitLabel = m.label as string; break;
      case 'onSubmit': out.onSubmit = m.handler as () => void; break;
      case 'autocorrectionDisabled': out.autocorrect = !(m.value as boolean); break;
      case 'textInputAutocapitalization': out.autocapitalize = CAPITALIZE[m.mode as string] ?? 'sentences'; break;
      case 'refreshable': out.refresh = m.handler as () => Promise<void>; break;
      case 'disabled': out.disabled = m.value as boolean; break;
      case 'tag': out.tag = m.value; break;
      case 'scrollContentBackground': out.hideScrollBackground = m.visibility === 'hidden'; break;
      case 'multilineTextAlignment':
        out.text.textAlign = m.alignment === 'trailing' ? 'right' : m.alignment === 'center' ? 'center' : 'left';
        break;
      case 'lineLimit': out.lineLimit = m.limit as number | undefined; break;
      case 'labelsHidden': out.labelsHidden = true; break;
      case 'environment':
        if (m.key === 'editMode') out.editMode = m.value === 'active';
        break;
      default:
        break;
    }
  }
  return out;
}
