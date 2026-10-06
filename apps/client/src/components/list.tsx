// Сгруппированный список на стекле — как «Настройки» iOS 26 (inset grouped), но в тонах
// Titan: секция — стеклянная плашка, строки с цветными значками, системный переключатель.
import { Children, type ReactNode } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { haptic } from '@/lib/haptics';
import { colors, radius, space, type } from '@/lib/theme';

import { Glass } from './glass';
import { Icon, type IconName } from './icon';
import { Divider, IconTile } from './ui';

const ICON_SIZE = 32;
const ROW_INSET = space.lg + ICON_SIZE + space.md;

export function ListSection({ title, footer, children }: { title?: string; footer?: string; children: ReactNode }) {
  const rows = Children.toArray(children).filter(Boolean);
  return (
    <View style={styles.section}>
      {title ? <Text style={styles.title} accessibilityRole="header">{title}</Text> : null}
      <Glass style={styles.group}>
        {rows.map((row, i) => (
          <View key={i}>
            {i > 0 ? <Divider inset={ROW_INSET} /> : null}
            {row}
          </View>
        ))}
      </Glass>
      {footer ? <Text style={styles.footer}>{footer}</Text> : null}
    </View>
  );
}

export interface ListRowProps {
  icon?: IconName;
  color?: string;
  title: string;
  subtitle?: string;
  value?: string;
  onPress?: () => void;
  /** Внешняя ссылка — стрелка «наружу» вместо шеврона. */
  external?: boolean;
  destructive?: boolean;
}

export function ListRow({ icon, color = colors.violetLight, title, subtitle, value, onPress, external, destructive }: ListRowProps) {
  const body = (
    <>
      {icon ? <IconTile name={icon} color={destructive ? colors.red : color} size={ICON_SIZE} /> : null}
      <View style={styles.texts}>
        <Text style={[styles.rowTitle, destructive && { color: colors.red }]} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={type.caption} numberOfLines={2}>{subtitle}</Text> : null}
      </View>
      {value ? <Text style={styles.value} numberOfLines={1}>{value}</Text> : null}
      {onPress ? <Icon name={external ? 'external' : 'chevron'} size={13} color={colors.textMuted} weight="bold" /> : null}
    </>
  );
  if (!onPress) return <View style={styles.row}>{body}</View>;
  return (
    <Pressable
      onPress={() => { haptic.tap(); onPress(); }}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={value ? `${title}: ${value}` : title}
    >
      {body}
    </Pressable>
  );
}

export interface ToggleRowProps {
  icon: IconName;
  color: string;
  title: string;
  subtitle?: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}

/** Строка с системным переключателем (на iOS 26 — стеклянный UISwitch) в violet. */
export function ToggleRow({ icon, color, title, subtitle, value, onChange, disabled }: ToggleRowProps) {
  return (
    <View style={[styles.row, disabled && styles.disabled]}>
      <IconTile name={icon} color={color} size={ICON_SIZE} />
      <View style={styles.texts}>
        <Text style={styles.rowTitle}>{title}</Text>
        {subtitle ? <Text style={type.caption}>{subtitle}</Text> : null}
      </View>
      <Switch
        value={value}
        disabled={disabled}
        onValueChange={(v) => { haptic.select(); onChange(v); }}
        trackColor={{ false: 'rgba(255,255,255,0.16)', true: colors.violet }}
        thumbColor="#fff"
        ios_backgroundColor="rgba(255,255,255,0.16)"
        accessibilityLabel={title}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: space.xxl },
  title: { ...StyleSheet.flatten(type.overline), marginBottom: space.sm, marginLeft: space.lg },
  footer: { ...StyleSheet.flatten(type.caption), marginTop: space.sm, marginHorizontal: space.lg },
  group: { borderRadius: radius.card, overflow: 'hidden' },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    paddingHorizontal: space.lg, paddingVertical: space.md, minHeight: 58,
  },
  pressed: { backgroundColor: 'rgba(255,255,255,0.07)' },
  disabled: { opacity: 0.5 },
  texts: { flex: 1, minWidth: 0, gap: 1 },
  rowTitle: { color: colors.text, fontSize: 16, fontWeight: '500' },
  value: { color: colors.textSecondary, fontSize: 15, maxWidth: '50%' },
});
