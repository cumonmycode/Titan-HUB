// Стеклянные примитивы My Titan: поверхность, кнопки, круглые кнопки, чипы.
//
// iOS 26 — настоящий Liquid Glass (UIGlassEffect через expo-glass-effect): преломляет
// фирменный фон экрана, подкрашен в violet, «живой» на касание (isInteractive).
// Android и iOS до 26 стекла не умеют — там те же формы рисуются полупрозрачными
// поверхностями в цвет бренда, поэтому вёрстка экранов от платформы не зависит.
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { type ReactNode, useEffect, useState } from 'react';
import {
  ActivityIndicator, Pressable, type StyleProp, StyleSheet, Text, View, type ViewProps, type ViewStyle,
} from 'react-native';

import { haptic } from '@/lib/haptics';
import { colors, glassTint, IS_IOS, radius, space, violetGradient } from '@/lib/theme';

import { Icon, type IconName } from './icon';
import { Tap } from './tap';

/** Настоящее стекло доступно (iOS 26+). Проверяется один раз — от него зависит вёрстка. */
export const LIQUID_GLASS = IS_IOS && isLiquidGlassAvailable();

/** Дольше любой анимации появления в приложении (переход экрана, FadeIn). */
const SETTLE_MS = 450;

/**
 * Стекло iOS 26 не прорисовывается, если в момент применения эффекта кто-то из родителей
 * прозрачен (экран въезжает с анимацией, карточка появляется с FadeIn) — остаётся
 * «пустым», без фона и края. Эффект пересоздаётся при смене его параметра, поэтому после
 * появления один раз переключаем isInteractive туда и обратно (тот же приём, что в
 * приложении персонала apps/mobile/src/components/glass.tsx).
 */
function useSettled(refreshKey: string | number | undefined): boolean {
  const [settled, setSettled] = useState(!LIQUID_GLASS);
  useEffect(() => {
    if (!LIQUID_GLASS) return;
    const reset = setTimeout(() => setSettled(false), 0);
    const settle = setTimeout(() => setSettled(true), SETTLE_MS);
    return () => {
      clearTimeout(reset);
      clearTimeout(settle);
    };
  }, [refreshKey]);
  return settled;
}

export interface GlassProps extends ViewProps {
  /** Подкраска стекла (iOS 26). */
  tint?: string;
  /** Стекло откликается на касание — для нажимаемых поверхностей. */
  interactive?: boolean;
  /** 'clear' — прозрачнее, для стекла поверх пёстрого (голо-карта). */
  variant?: 'regular' | 'clear';
  /** Вид без стекла (Android, iOS до 26). По умолчанию — полупрозрачная поверхность. */
  fallback?: StyleProp<ViewStyle>;
  /** Сменить, чтобы пересоздать эффект (после анимации, перехода). */
  refreshKey?: string | number;
  children?: ReactNode;
}

export function Glass({
  tint = glassTint.card, interactive = false, variant = 'regular', fallback, refreshKey, style, children, ...rest
}: GlassProps) {
  const settled = useSettled(refreshKey);
  if (!LIQUID_GLASS) {
    return <View {...rest} style={[styles.surface, fallback, style]}>{children}</View>;
  }
  return (
    <GlassView
      {...rest}
      glassEffectStyle={variant}
      tintColor={tint}
      colorScheme="dark"
      isInteractive={settled ? interactive : !interactive}
      style={style}
    >
      {children}
    </GlassView>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'telegram' | 'danger' | 'ghost';

const BUTTON_LOOK: Record<Exclude<ButtonVariant, 'ghost'>, { tint: string; fg: string; fallback: ViewStyle }> = {
  primary: {
    tint: glassTint.prominent,
    fg: '#fff',
    fallback: { experimental_backgroundImage: violetGradient, borderWidth: 0, boxShadow: '0 10px 28px rgba(109,40,217,0.35)' },
  },
  telegram: {
    tint: glassTint.telegram,
    fg: '#fff',
    fallback: { backgroundColor: colors.telegram, borderWidth: 0, boxShadow: '0 10px 28px rgba(42,171,238,0.30)' },
  },
  secondary: {
    tint: glassTint.raised,
    fg: colors.textBody,
    fallback: { backgroundColor: 'rgba(255,255,255,0.06)', borderColor: colors.borderStrong },
  },
  danger: {
    tint: glassTint.danger,
    fg: colors.red,
    fallback: { backgroundColor: colors.redTint, borderColor: 'rgba(248,113,113,0.3)' },
  },
};

export interface GlassButtonProps {
  title: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  /** lg — главная кнопка экрана, md — в карточке, sm — в строке списка. */
  size?: 'lg' | 'md' | 'sm';
  style?: StyleProp<ViewStyle>;
}

/** Кнопка-капсула из стекла. primary — насыщенное violet-стекло (glassProminent бренда). */
export function GlassButton({
  title, onPress, variant = 'primary', icon, loading, disabled, size = 'lg', style,
}: GlassButtonProps) {
  const inactive = disabled || loading;
  const sizeStyle = size === 'sm' ? styles.buttonSm : size === 'md' ? styles.buttonMd : styles.buttonLg;
  const textSize = size === 'sm' ? styles.buttonTextSm : size === 'md' ? styles.buttonTextMd : null;
  const iconSize = size === 'sm' ? 13 : size === 'md' ? 16 : 18;
  const fg = variant === 'ghost' ? colors.violetLight : BUTTON_LOOK[variant].fg;
  const content = loading ? (
    <ActivityIndicator color={fg} />
  ) : (
    <>
      {icon ? <Icon name={icon} size={iconSize} color={fg} weight="bold" /> : null}
      <Text style={[styles.buttonText, textSize, { color: fg }]} numberOfLines={1}>{title}</Text>
    </>
  );

  if (variant === 'ghost') {
    return (
      <Tap onPress={onPress} disabled={inactive} scaleTo={0.96} accessibilityRole="button" accessibilityLabel={title}
        style={[styles.button, sizeStyle, style]}>
        {content}
      </Tap>
    );
  }
  const look = BUTTON_LOOK[variant];
  return (
    <Tap onPress={onPress} disabled={inactive} scaleTo={0.97} accessibilityRole="button" accessibilityLabel={title}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }} style={style}>
      <Glass interactive tint={look.tint} fallback={look.fallback} style={[styles.button, sizeStyle]}>
        {content}
      </Glass>
    </Tap>
  );
}

export interface GlassIconButtonProps {
  icon: IconName;
  label: string;
  onPress?: () => void;
  size?: number;
  color?: string;
  tint?: string;
  /** Точка-индикатор (непрочитанное). */
  dot?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** Круглая стеклянная кнопка с иконкой — «закрыть», колокольчик, действия в шапке. */
export function GlassIconButton({
  icon, label, onPress, size = 44, color = colors.textBody, tint = glassTint.card, dot, style,
}: GlassIconButtonProps) {
  return (
    <Tap onPress={onPress} scaleTo={0.9} accessibilityRole="button" accessibilityLabel={label} hitSlop={6} style={style}>
      <Glass interactive tint={tint} style={[styles.circle, { width: size, height: size, borderRadius: size / 2 }]}>
        <Icon name={icon} size={size * 0.42} color={color} weight="semibold" />
      </Glass>
      {dot ? <View style={styles.dot} /> : null}
    </Tap>
  );
}

export interface GlassChipProps {
  label: string;
  icon?: IconName;
  color?: string;
  selected?: boolean;
  onPress?: () => void;
}

/** Чип выбора (назначение платежа, быстрые суммы): выбранный — насыщенное стекло своего цвета. */
export function GlassChip({ label, icon, color = colors.violetLight, selected, onPress }: GlassChipProps) {
  return (
    <Pressable
      onPress={() => { haptic.select(); onPress?.(); }}
      accessibilityRole="radio"
      accessibilityState={{ selected: !!selected }}
      accessibilityLabel={label}
    >
      <Glass
        interactive
        tint={selected ? `${color}55` : glassTint.card}
        fallback={selected ? { backgroundColor: `${color}26`, borderColor: `${color}80` } : null}
        style={styles.chip}
      >
        {icon ? <Icon name={icon} size={15} color={selected ? color : colors.textSecondary} /> : null}
        <Text style={[styles.chipText, selected && styles.chipTextOn]} numberOfLines={1}>{label}</Text>
      </Glass>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  surface: {
    backgroundColor: 'rgba(33,29,42,0.82)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  button: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm,
    paddingHorizontal: space.xl, borderRadius: radius.pill,
  },
  buttonLg: { minHeight: 54 },
  buttonMd: { minHeight: 44, paddingHorizontal: space.lg },
  buttonSm: { minHeight: 32, paddingHorizontal: 14, gap: 5 },
  buttonText: { fontSize: 17, fontWeight: '700', letterSpacing: 0.1 },
  buttonTextMd: { fontSize: 15 },
  buttonTextSm: { fontSize: 14 },
  circle: { alignItems: 'center', justifyContent: 'center' },
  dot: {
    position: 'absolute', top: 9, right: 10, width: 9, height: 9, borderRadius: 5,
    backgroundColor: colors.pink, borderWidth: 1.5, borderColor: colors.background,
  },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6, height: 40, paddingHorizontal: 15,
    borderRadius: radius.pill, maxWidth: 240,
  },
  chipText: { color: colors.textSecondary, fontSize: 14, fontWeight: '700' },
  chipTextOn: { color: colors.text },
});
