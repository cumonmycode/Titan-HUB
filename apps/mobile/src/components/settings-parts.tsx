import { Host, Toggle } from '@expo/ui/swift-ui';
import { disabled as disabledModifier, tint } from '@expo/ui/swift-ui/modifiers';
import { SymbolView } from 'expo-symbols';
import { Children, useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View, type ColorValue } from 'react-native';
import type { SFSymbol } from 'sf-symbols-typescript';

import { Text } from '@/components/text';
import { GlassCard, sheetStyles } from '@/components/new-check-parts';
import { Unavailable } from '@/components/unavailable';
import { saveSettings, useSettings } from '@/lib/admin-api';
import { haptic } from '@/lib/haptics';
import { colors, space, type, useAccentHex } from '@/lib/theme';
import { promptText } from '@/lib/dialog';

/**
 * Строки-настройки как в iOS: цветной значок, подпись, значение справа.
 * Группы — стеклянная карточка с хайрлайнами между строками.
 */

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Настройки клуба правятся по одной строке и сохраняются сразу, как в «Настройках» iOS.
 * До ответа сервера показываем новое значение; на ошибке возвращаем прежнее.
 */
export function useSettingsEditor() {
  const query = useSettings();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const values = useMemo(() => ({ ...(query.data ?? {}), ...draft }), [query.data, draft]);

  const text = (key: string, fallback = '') => values[key] ?? fallback;
  const flag = (key: string, fallback = false) => {
    const raw = values[key];
    return raw === undefined || raw === '' ? fallback : raw === 'true' || raw === '1';
  };
  const number = (key: string, fallback: number) => {
    const parsed = Number(values[key]);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  const save = (patch: Record<string, string>) => {
    setDraft((current) => ({ ...current, ...patch }));
    saveSettings(patch)
      .then(() => haptic.success())
      .catch((error: unknown) => {
        haptic.error();
        setDraft((current) => {
          const next = { ...current };
          for (const key of Object.keys(patch)) delete next[key];
          return next;
        });
        Alert.alert('Настройка не сохранена', errorText(error));
      });
  };

  return { loading: query.isLoading, error: query.error, refetch: query.refetch, text, flag, number, save };
}

/** Правка значения настройки в системном диалоге — без отдельной шторки ради одного поля. */
export function promptValue({
  title,
  message,
  value,
  keyboard,
  onSubmit,
}: {
  title: string;
  message?: string;
  value: string;
  keyboard?: 'default' | 'number-pad' | 'decimal-pad' | 'phone-pad';
  onSubmit: (next: string) => void;
}) {
  haptic.light();
  promptText(
    title,
    message,
    [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Сохранить', onPress: (next?: string) => onSubmit((next ?? '').trim()) },
    ],
    'plain-text',
    value,
    keyboard ?? 'default',
  );
}

export function Group({ title, footer, inset = 62, children }: { title?: string; footer?: string; inset?: number; children: ReactNode }) {
  const rows = Children.toArray(children).filter(Boolean);
  if (rows.length === 0) return null;
  return (
    <View style={styles.group}>
      {title && <Text style={[type.footnote, styles.groupTitle]}>{title.toUpperCase()}</Text>}
      <GlassCard>
        {rows.map((row, index) => (
          <View key={index}>
            {index > 0 && <View style={[sheetStyles.separator, { marginLeft: inset }]} />}
            {row}
          </View>
        ))}
      </GlassCard>
      {footer && <Text style={[type.footnote, styles.footer]}>{footer}</Text>}
    </View>
  );
}

export function Row({
  icon,
  color,
  title,
  subtitle,
  value,
  valueColor,
  chevron,
  destructive,
  dim,
  busy,
  onPress,
}: {
  icon?: SFSymbol;
  color?: ColorValue;
  title: string;
  subtitle?: string;
  value?: string;
  valueColor?: ColorValue;
  chevron?: boolean;
  destructive?: boolean;
  dim?: boolean;
  busy?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable
      onPress={
        onPress &&
        (() => {
          haptic.selection();
          onPress();
        })
      }
      disabled={!onPress || busy}
      style={({ pressed }) => [styles.row, dim && styles.dim, pressed && sheetStyles.pressedRow]}
      accessibilityRole={onPress ? 'button' : undefined}>
      {icon && (
        <View style={[styles.icon, { backgroundColor: color ?? colors.tertiaryLabel }]}>
          <SymbolView name={icon} size={16} weight="semibold" tintColor="white" />
        </View>
      )}
      <View style={styles.flex}>
        <Text style={[type.body, destructive ? styles.destructive : styles.label]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle && (
          <Text style={[type.footnote, styles.secondary]} numberOfLines={2}>
            {subtitle}
          </Text>
        )}
      </View>
      {busy ? (
        <ActivityIndicator />
      ) : (
        value !== undefined && (
          <Text style={[type.body, styles.value, valueColor ? { color: valueColor } : null]} numberOfLines={1}>
            {value}
          </Text>
        )
      )}
      {chevron && onPress && <SymbolView name="chevron.right" size={13} weight="semibold" tintColor={colors.tertiaryLabel} />}
    </Pressable>
  );
}

export function SwitchRow({
  icon,
  color,
  title,
  subtitle,
  value,
  onChange,
  disabled,
}: {
  icon?: SFSymbol;
  color?: ColorValue;
  title: string;
  subtitle?: string;
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  const accent = useAccentHex();
  return (
    <View style={[styles.row, disabled && styles.dim]}>
      {icon && (
        <View style={[styles.icon, { backgroundColor: color ?? colors.tertiaryLabel }]}>
          <SymbolView name={icon} size={16} weight="semibold" tintColor="white" />
        </View>
      )}
      <View style={styles.flex}>
        <Text style={[type.body, styles.label]}>{title}</Text>
        {subtitle && <Text style={[type.footnote, styles.secondary]}>{subtitle}</Text>}
      </View>
      <Host matchContents seedColor={accent}>
        <Toggle
          isOn={value}
          onIsOnChange={(on) => {
            if (disabled) return;
            haptic.selection();
            onChange(on);
          }}
          modifiers={disabled ? [tint(accent), disabledModifier(true)] : [tint(accent)]}
        />
      </Host>
    </View>
  );
}

/** Пустой список — системный ContentUnavailableView, как в остальных разделах. */
export function ListNote({ loading, text, systemImage = 'tray', description }: { loading?: boolean; text: string; systemImage?: SFSymbol; description?: string }) {
  if (loading) return <ActivityIndicator style={styles.note} />;
  return (
    <View style={styles.empty}>
      <Unavailable title={text} systemImage={systemImage} description={description} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  group: { gap: space.sm },
  groupTitle: { color: colors.secondaryLabel, paddingHorizontal: space.xs, fontWeight: '600', letterSpacing: 0.4 },
  footer: { color: colors.secondaryLabel, paddingHorizontal: space.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, minHeight: 56, paddingVertical: space.sm },
  icon: { width: 30, height: 30, borderRadius: 8, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center' },
  label: { color: colors.label },
  secondary: { color: colors.secondaryLabel },
  destructive: { color: colors.red },
  // Длинный адрес или подпись чека: значение сжимается и обрезается, подпись остаётся читаемой.
  // tabular-nums: суммы и проценты в столбце не «пляшут» при смене цифр.
  value: { color: colors.secondaryLabel, flexShrink: 1, maxWidth: '52%', textAlign: 'right', fontVariant: ['tabular-nums'] },
  dim: { opacity: 0.55 },
  centered: { textAlign: 'center' },
  note: { paddingVertical: space.xxl },
  empty: { height: 240 },
});
