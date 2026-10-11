import type { ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, View, type ColorValue, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';

import { GlassView } from '@/components/glass';
import { colors } from '@/lib/theme';

/**
 * Поверхности шторки «Свет и климат» — у каждой платформы своё оформление.
 *
 * iPhone и iPad — как Пункт управления iOS 26: экран под шторкой размыт, плитки — Liquid
 * Glass; включённая плитка подсвечена тоном устройства (свет — тёплым жёлтым).
 * Android — как шторка быстрых настроек: плотная панель и тональные «таблетки» Material,
 * включённая плитка залита акцентом, нажатие — системная рябь.
 */

export const IS_IOS = Platform.OS === 'ios';

/** Android: заливка включённой плитки и подписи на ней. */
export const ANDROID_ON = '#8B5CF6';
export const ANDROID_ON_LABEL = '#FFFFFF';
const RIPPLE = { color: 'rgba(127,127,127,0.22)', foreground: true } as const;

type SurfaceProps = {
  /** Плитка «включена»: iOS — подкраска стекла, Android — заливка акцентом. */
  active?: boolean;
  /** Подкраска включённого стекла на iOS. */
  tint?: ColorValue;
  radius: number;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
};

/** Неподвижная поверхность (карточка кондиционера). */
export function HomeSurface({ active, tint, radius, style, children }: SurfaceProps) {
  if (IS_IOS) {
    return (
      <GlassView glassEffectStyle="regular" tintColor={active ? tint : undefined} style={[{ borderRadius: radius }, styles.clip, style]}>
        {children}
      </GlassView>
    );
  }
  return <View style={[{ borderRadius: radius, backgroundColor: colors.fill }, styles.clip, style]}>{children}</View>;
}

/** Нажимаемая плитка: на iOS отклик рисует само стекло, на Android — рябь Material. */
export function HomePressable({ active, tint, radius, style, children, ...pressable }: SurfaceProps & Omit<PressableProps, 'style' | 'children'>) {
  if (IS_IOS) {
    return (
      <Pressable {...pressable}>
        <GlassView isInteractive glassEffectStyle="regular" tintColor={active ? tint : undefined} style={[{ borderRadius: radius }, styles.clip, style]}>
          {children}
        </GlassView>
      </Pressable>
    );
  }
  return (
    <View style={[{ borderRadius: radius }, styles.clip]}>
      <Pressable {...pressable} android_ripple={RIPPLE} style={[{ borderRadius: radius, backgroundColor: active ? ANDROID_ON : colors.fill }, style]}>
        {children}
      </Pressable>
    </View>
  );
}

/** Круглая кнопка внутри карточки (−, +, питание): не стекло на стекле, а тонкая заливка. */
export function HomeRoundButton({
  size,
  fill,
  disabled,
  children,
  ...pressable
}: { size: number; fill?: ColorValue; children: ReactNode } & Omit<PressableProps, 'style' | 'children'>) {
  return (
    <View style={[styles.clip, { width: size, height: size, borderRadius: size / 2, opacity: disabled ? 0.35 : 1 }]}>
      <Pressable
        {...pressable}
        disabled={disabled}
        android_ripple={RIPPLE}
        hitSlop={6}
        style={({ pressed }) => [
          styles.round,
          { borderRadius: size / 2, backgroundColor: fill ?? (IS_IOS ? colors.fill : colors.card) },
          IS_IOS && pressed && styles.pressed,
        ]}>
        {children}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: 'hidden', borderCurve: 'continuous' },
  round: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.6 },
});
