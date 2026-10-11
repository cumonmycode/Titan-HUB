// Кнопки-капсулы: главная (акцент), стеклянная, тихая; круглая кнопка-иконка.
import type { LucideIcon } from 'lucide-react-native';
import { ActivityIndicator, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { glassStyle } from './glass';
import { Icon } from './icon';
import { Press } from './press';
import { T } from './text';
import { color, radius } from './tokens';

type Variant = 'primary' | 'glass' | 'quiet' | 'danger';
type Size = 'lg' | 'md' | 'sm';

const HEIGHT: Record<Size, number> = { lg: 64, md: 52, sm: 42 };

export function Button({
  title, icon, onPress, variant = 'glass', size = 'md', loading, disabled, style, iconRight,
}: {
  title: string;
  icon?: LucideIcon;
  iconRight?: LucideIcon;
  onPress?: () => void;
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const fg = variant === 'primary' ? color.onAccent : variant === 'danger' ? color.red : color.text;
  const surface = variant === 'primary' ? glassStyle('accent', radius.pill)
    : variant === 'glass' ? glassStyle('control', radius.pill)
    : variant === 'danger' ? { borderRadius: radius.pill, borderWidth: 1, borderColor: 'rgba(248,113,113,0.35)', backgroundColor: color.redTint }
    : { borderRadius: radius.pill };
  return (
    <Press
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityLabel={title}
      style={[styles.base, { height: HEIGHT[size], paddingHorizontal: size === 'sm' ? 16 : 24 }, surface, style]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <View style={styles.row}>
          {icon ? <Icon as={icon} size={size === 'sm' ? 18 : 22} tone={fg} /> : null}
          <T variant="label" style={[{ color: fg }, size === 'lg' && { fontSize: 18 }]}>{title}</T>
          {iconRight ? <Icon as={iconRight} size={size === 'sm' ? 18 : 20} tone={fg} /> : null}
        </View>
      )}
    </Press>
  );
}

export function IconButton({
  icon, label, onPress, size = 52, tone, variant = 'glass', disabled, style,
}: {
  icon: LucideIcon;
  label: string;
  onPress?: () => void;
  size?: number;
  tone?: string;
  variant?: 'glass' | 'primary' | 'quiet';
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const surface = variant === 'primary' ? glassStyle('accent', radius.pill) : variant === 'glass' ? glassStyle('control', radius.pill) : null;
  return (
    <Press
      onPress={onPress}
      disabled={disabled}
      accessibilityLabel={label}
      hitSlop={8}
      scaleTo={0.92}
      style={[styles.icon, { width: size, height: size }, surface, style]}
    >
      <Icon as={icon} size={Math.round(size * 0.44)} tone={tone ?? (variant === 'primary' ? color.onAccent : color.text)} stroke={2} />
    </Press>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  icon: { alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill },
});
