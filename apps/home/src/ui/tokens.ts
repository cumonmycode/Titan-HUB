// Дизайн-токены Titan Home 2.0: «стекло» в духе Liquid Glass поверх тёмного
// статичного фона. Размытия в реальном времени нет — фон неподвижен, поэтому
// стекло = полупрозрачная заливка + светлая верхняя кромка + волосяная граница.
// Цвет — только по смыслу: акцент у главного действия, статусы — зелёный/янтарный/красный.

export const color = {
  ground: '#0c0a11',
  text: '#F4F2F8',
  textSecondary: 'rgba(236,232,245,0.70)',
  textTertiary: 'rgba(236,232,245,0.56)',
  onAccent: '#FFFFFF',

  accent: '#8B5CF6',
  accentSoft: '#C4B5FD',
  accentFill: 'rgba(139,92,246,0.66)',
  accentBorder: 'rgba(206,190,255,0.50)',
  accentTint: 'rgba(139,92,246,0.18)',

  glassPanel: 'rgba(255,255,255,0.065)',
  glassControl: 'rgba(255,255,255,0.10)',
  glassRaised: 'rgba(255,255,255,0.14)',
  glassInset: 'rgba(0,0,0,0.22)',
  // Слои поверх содержимого (шторки, панель комнаты, корзина): без размытия
  // заливка плотнее, чтобы текст под ней не мешал.
  glassOverlay: 'rgba(27,23,36,0.975)',

  border: 'rgba(255,255,255,0.12)',
  borderStrong: 'rgba(255,255,255,0.17)',
  highlight: 'rgba(255,255,255,0.26)',
  hairline: 'rgba(255,255,255,0.08)',
  scrim: 'rgba(8,6,12,0.58)',

  green: '#34D399',
  greenTint: 'rgba(52,211,153,0.14)',
  amber: '#FBBF24',
  amberTint: 'rgba(251,191,36,0.10)',
  amberBorder: 'rgba(251,191,36,0.32)',
  red: '#F87171',
  redTint: 'rgba(248,113,113,0.12)',
  cool: '#8FD8F8',
  coolTint: 'rgba(143,216,248,0.16)',
  warm: '#FFC46E',
  warmTint: 'rgba(255,190,105,0.30)',
  warmBorder: 'rgba(255,206,140,0.50)',
} as const;

export const radius = { panel: 34, card: 28, tile: 24, inner: 20, pill: 999 } as const;
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 } as const;

/** Отступ содержимого от краёв экрана. */
export const GUTTER = 24;

/** Минимальная цель касания на столе кабинки. */
export const TOUCH = 56;

export const font = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
} as const;

export const motion = {
  /** Появление слоёв и шторок. */
  enter: 220,
  exit: 180,
  /** Отклик нажатия — на UI-потоке. */
  pressIn: 80,
  pressOut: 160,
} as const;
