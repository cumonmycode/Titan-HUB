// Фирменная тёмная палитра My Titan — та же, что у веб-кошелька (apps/wallet):
// глубокий фиолетово-чёрный фон, violet-акцент, голо-карта. Тема всегда тёмная.
//
// Поверх неё — системные материалы: на iOS 26 карточки, кнопки, таб-бар и шторки
// из Liquid Glass (expo-glass-effect, NativeTabs, formSheet), подкрашенные в violet.
// Стекло преломляет то, что под ним, поэтому у экранов не плоский фон, а статичные
// фирменные «пятна» света (backdrop) — им стекло и обязано цветом.
import { Platform, StyleSheet } from 'react-native';

export const colors = {
  background: '#15121b',
  backgroundDeep: '#0f0c14',
  surface: '#1d1a24',
  surfaceRaised: '#262130',
  surfacePressed: '#2d2738',
  border: 'rgba(255,255,255,0.08)',
  borderStrong: 'rgba(255,255,255,0.14)',
  borderViolet: 'rgba(139,92,246,0.28)',

  text: '#ffffff',
  textBody: '#e2e8f0',
  textSecondary: '#94A3B8',
  textMuted: '#64748B',

  violet: '#8B5CF6',
  violetDeep: '#6d28d9',
  violetLight: '#a78bfa',
  lavender: '#c4b5fd',
  violetTint: 'rgba(139,92,246,0.14)',

  cyan: '#4cd7f6',
  cyanTint: 'rgba(76,215,246,0.10)',
  green: '#34D399',
  greenBright: '#4ade80',
  greenTint: 'rgba(52,211,153,0.10)',
  red: '#F87171',
  redTint: 'rgba(248,113,113,0.10)',
  amber: '#fbbf24',
  amberTint: 'rgba(251,191,36,0.10)',
  gold: '#FACC15',
  pink: '#ec4899',
  telegram: '#2AABEE',
} as const;

/**
 * Подкраска стекла. Светлая — общий фон карточек (стекло остаётся стеклом, но с тёплым
 * фиолетовым отливом), насыщенная — главные кнопки (аналог glassProminent в цвет бренда).
 */
export const glassTint = {
  card: 'rgba(139,92,246,0.10)',
  raised: 'rgba(139,92,246,0.18)',
  prominent: 'rgba(124,58,237,0.82)',
  telegram: 'rgba(42,171,238,0.80)',
  danger: 'rgba(248,113,113,0.16)',
} as const;

/** Голографический градиент карты клуба (как в вебе). */
export const holoGradient =
  'linear-gradient(115deg, #6d28d9 0%, #4cd7f6 18%, #ec4899 36%, #f59e0b 52%, #8B5CF6 68%, #4cd7f6 84%, #6d28d9 100%)';
export const violetGradient = 'linear-gradient(135deg, #8B5CF6 0%, #6d28d9 100%)';

/**
 * Фон экранов: фирменный фиолетово-чёрный и неподвижные пятна света. Задаётся стилем
 * контейнера экрана (contentStyle стека), а не отдельным слоем: iOS 26 размывает край
 * прокрутки под шапкой, только если ScrollView — первый ребёнок экрана.
 */
export const backdrop = {
  backgroundColor: colors.background,
  experimental_backgroundImage:
    'radial-gradient(circle at 6% 2%, rgba(139,92,246,0.34) 0%, rgba(139,92,246,0) 46%), ' +
    'radial-gradient(circle at 100% 30%, rgba(76,215,246,0.16) 0%, rgba(76,215,246,0) 40%), ' +
    'radial-gradient(circle at 10% 78%, rgba(236,72,153,0.12) 0%, rgba(236,72,153,0) 42%), ' +
    'radial-gradient(circle at 92% 96%, rgba(109,40,217,0.26) 0%, rgba(109,40,217,0) 46%)',
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 } as const;
/** Скругления как у системных стёкол iOS 26: крупные, концентричные с краем экрана. */
export const radius = { card: 26, tile: 22, row: 18, control: 16, pill: 999 } as const;

/** Отступ по бокам экрана и ширина колонки на планшетах. */
export const GUTTER = 16;
export const MAX_WIDTH = 560;

export const IS_IOS = Platform.OS === 'ios';

export const type = StyleSheet.create({
  title: { fontSize: 28, lineHeight: 34, fontWeight: '800', color: colors.text, letterSpacing: -0.4 },
  heading: { fontSize: 20, lineHeight: 25, fontWeight: '800', color: colors.text, letterSpacing: -0.2 },
  headline: { fontSize: 16, lineHeight: 21, fontWeight: '700', color: colors.text },
  body: { fontSize: 16, lineHeight: 22, color: colors.textBody },
  callout: { fontSize: 14, lineHeight: 19, color: colors.textBody },
  caption: { fontSize: 12.5, lineHeight: 16, color: colors.textSecondary },
  overline: {
    fontSize: 12, lineHeight: 15, fontWeight: '700', letterSpacing: 0.9,
    textTransform: 'uppercase', color: colors.textSecondary,
  },
  /** Суммы: жирный курсив, цифры одинаковой ширины (как в веб-кошельке). */
  amount: { fontWeight: '800', fontStyle: 'italic', fontVariant: ['tabular-nums'] },
});

/** Пружины Reanimated для анимаций внутри экранов. */
export const springs = {
  snappy: { damping: 18, stiffness: 260, mass: 0.8 },
  smooth: { damping: 22, stiffness: 180 },
  bouncy: { damping: 11, stiffness: 180 },
} as const;
