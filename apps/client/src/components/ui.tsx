// Мелкие элементы интерфейса: поверхность контента, аватар, иконка в цветной плашке,
// бейдж статуса, пустые состояния, скелетоны, заголовок секции, разделитель.
import { Image } from 'expo-image';
import { type ReactNode, useEffect } from 'react';
import { type StyleProp, StyleSheet, Text, View, type ViewProps, type ViewStyle } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

import { colors, space, type } from '@/lib/theme';

import { Icon, type IconName } from './icon';
import { Tap } from './tap';

export interface SurfaceProps extends ViewProps {
  /** Смысловой цвет карточки (депозит, предупреждение) — лёгкая подкраска фона и края. */
  tone?: string;
  children?: ReactNode;
}

/**
 * Поверхность контента: карточки, группы списков, чек. Не стекло: по правилам iOS 26
 * Liquid Glass — слой управления (кнопки, таб-бар, шапки, шторки), а контент под ним
 * спокойный. Иначе в шторках выходит мутное «стекло на стекле».
 */
export function Surface({ tone, style, children, ...rest }: SurfaceProps) {
  return (
    <View {...rest} style={[styles.surface, tone ? { backgroundColor: `${tone}17`, borderColor: `${tone}3d` } : null, style]}>
      {children}
    </View>
  );
}

export function Avatar({ uri, name, size = 44, ring }: { uri?: string | null; name?: string | null; size?: number; ring?: boolean }) {
  const initial = (name ?? '?').trim().slice(0, 1).toUpperCase() || '?';
  return (
    <View style={[{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden' }, ring && styles.ring]}>
      {uri ? (
        <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.avatarFallback]}>
          <Text style={[styles.initial, { fontSize: size * 0.4 }]}>{initial}</Text>
        </View>
      )}
    </View>
  );
}

/** Иконка в скруглённой плашке своего цвета — как значки в Настройках iOS, но в тонах Titan. */
export function IconTile({ name, color, size = 40 }: { name: IconName; color: string; size?: number }) {
  return (
    <View style={[styles.tile, { width: size, height: size, borderRadius: size * 0.3, backgroundColor: `${color}24` }]}>
      <Icon name={name} size={size * 0.5} color={color} />
    </View>
  );
}

/** Бейдж статуса клиента: цвет из справочника тарифов. */
export function TierBadge({ label, color, onCard }: { label: string; color: string; onCard?: boolean }) {
  return (
    <View style={[styles.tier, { borderColor: color, backgroundColor: onCard ? 'rgba(0,0,0,0.25)' : `${color}22` }]}>
      <Text style={[styles.tierText, !onCard && { color }]}>{label}</Text>
    </View>
  );
}

export function SectionHeader({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle} accessibilityRole="header">{title}</Text>
      {action ? (
        <Tap onPress={onAction} hitSlop={10} scaleTo={0.94} accessibilityRole="button" accessibilityLabel={action}>
          <Text style={styles.sectionAction}>{action}</Text>
        </Tap>
      ) : null}
    </View>
  );
}

export function EmptyState({ icon, title, text, children }: { icon: IconName; title: string; text?: string; children?: ReactNode }) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Icon name={icon} size={28} color={colors.violetLight} />
      </View>
      <Text style={[type.headline, styles.center]}>{title}</Text>
      {text ? <Text style={[type.callout, styles.emptyText]}>{text}</Text> : null}
      {children ? <View style={styles.emptyActions}>{children}</View> : null}
    </View>
  );
}

/** Мерцающая заглушка на время загрузки. */
export function Skeleton({ width, height, style, rounded = 14 }: { width?: number | `${number}%`; height: number; style?: StyleProp<ViewStyle>; rounded?: number }) {
  const o = useSharedValue(0.4);
  useEffect(() => {
    o.set(withRepeat(withTiming(0.85, { duration: 850, easing: Easing.inOut(Easing.quad) }), -1, true));
  }, [o]);
  const animated = useAnimatedStyle(() => ({ opacity: o.value }));
  return <Animated.View style={[{ width: width ?? '100%', height, borderRadius: rounded }, styles.skeleton, animated, style]} />;
}

export function Divider({ inset = 0 }: { inset?: number }) {
  return <View style={[styles.divider, { marginLeft: inset }]} />;
}

const styles = StyleSheet.create({
  surface: {
    backgroundColor: 'rgba(255,255,255,0.055)',
    experimental_backgroundImage: 'linear-gradient(180deg, rgba(255,255,255,0.035) 0%, rgba(255,255,255,0) 60%)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.10)',
    borderCurve: 'continuous',
  },
  ring: { borderWidth: 2, borderColor: 'rgba(167,139,250,0.6)' },
  avatarFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(139,92,246,0.22)' },
  initial: { color: colors.lavender, fontWeight: '800' },
  tile: { alignItems: 'center', justifyContent: 'center', borderCurve: 'continuous' },
  tier: { paddingHorizontal: 11, paddingVertical: 3, borderRadius: 20, borderWidth: 1 },
  tierText: { color: '#fff', fontSize: 11, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase' },
  section: {
    flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between',
    marginBottom: space.md, paddingHorizontal: space.xs,
  },
  sectionTitle: { color: colors.text, fontSize: 20, lineHeight: 25, fontWeight: '700', letterSpacing: -0.3 },
  sectionAction: { color: colors.lavender, fontSize: 16, fontWeight: '500' },
  empty: { alignItems: 'center', paddingVertical: space.xxxl, paddingHorizontal: space.xl },
  emptyIcon: {
    width: 64, height: 64, borderRadius: 32, backgroundColor: colors.violetTint,
    alignItems: 'center', justifyContent: 'center', marginBottom: space.lg,
  },
  center: { textAlign: 'center' },
  emptyText: { color: colors.textSecondary, textAlign: 'center', marginTop: 6 },
  emptyActions: { marginTop: space.lg, alignSelf: 'stretch' },
  skeleton: { backgroundColor: 'rgba(255,255,255,0.07)' },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.10)' },
});
