// Элементы панели сотрудника: стеклянные секции, строки, переключатель, PIN.
import { ChevronRight, Delete, type LucideIcon } from 'lucide-react-native';
import { type ReactNode, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';

import { haptic } from '@/lib/haptics';
import { SwitchKnob } from '@/ui/controls';
import { Glass, glassStyle } from '@/ui/glass';
import { Icon } from '@/ui/icon';
import { Press } from '@/ui/press';
import { T } from '@/ui/text';
import { color, radius } from '@/ui/tokens';

export function Section({ title, children, footer }: { title: string; children: ReactNode; footer?: string }) {
  return (
    <View style={styles.section}>
      <T variant="overline" tone="secondary" style={{ paddingHorizontal: 6 }}>{title}</T>
      <Glass kind="panel" radius={radius.card} style={styles.sectionBody}>{children}</Glass>
      {footer ? <T variant="small" tone="tertiary" style={styles.footer}>{footer}</T> : null}
    </View>
  );
}

export function InfoRow({ icon, label, value, tone }: { icon: LucideIcon; label: string; value?: string | null; tone?: string }) {
  return (
    <View style={styles.row}>
      <Icon as={icon} size={22} tone={tone ?? color.textSecondary} />
      <T variant="label" style={{ flex: 1 }}>{label}</T>
      {value ? <T variant="caption" numberOfLines={1} style={[styles.value, { color: tone ?? color.textSecondary }]}>{value}</T> : null}
    </View>
  );
}

export function ActionRow({ icon, label, hint, onPress, tone, disabled }: { icon: LucideIcon; label: string; hint?: string; onPress: () => void; tone?: string; disabled?: boolean }) {
  return (
    <Press onPress={onPress} disabled={disabled} scaleTo={0.985} style={styles.row} accessibilityLabel={label}>
      <Icon as={icon} size={22} tone={tone ?? color.accentSoft} />
      <View style={{ flex: 1 }}>
        <T variant="label" style={tone ? { color: tone } : null}>{label}</T>
        {hint ? <T variant="small" tone="secondary" style={{ marginTop: 2 }}>{hint}</T> : null}
      </View>
      <Icon as={ChevronRight} size={20} tone={color.textTertiary} />
    </Press>
  );
}

export function ToggleRow({ icon, label, hint, value, onChange }: { icon: LucideIcon; label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Press onPress={() => onChange(!value)} scaleTo={0.985} style={styles.row} accessibilityRole="switch" accessibilityLabel={label} accessibilityState={{ checked: value }}>
      <Icon as={icon} size={22} tone={color.accentSoft} />
      <View style={{ flex: 1 }}>
        <T variant="label">{label}</T>
        {hint ? <T variant="small" tone="secondary" style={{ marginTop: 2 }}>{hint}</T> : null}
      </View>
      <SwitchKnob on={value} onTone={color.accentFill} />
    </Press>
  );
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'] as const;

/**
 * PIN сотрудника: 4 точки и крупная цифровая клавиатура (своя — системная
 * клавиатура на киоске не нужна). onSubmit на 4-й цифре; строка — ошибка
 * (точки потрясутся и сбросятся), null — успех.
 */
export function PinPad({ onSubmit }: { onSubmit: (pin: string) => Promise<string | null> }) {
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shake = useSharedValue(0);
  const shakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shake.value }] }));

  const press = async (key: string) => {
    if (busy) return;
    setError(null);
    if (key === 'del') {
      setPin((p) => p.slice(0, -1));
      return;
    }
    if (pin.length >= 4) return;
    const next = pin + key;
    setPin(next);
    if (next.length < 4) return;
    setBusy(true);
    const err = await onSubmit(next);
    setBusy(false);
    if (err) {
      haptic.error();
      setError(err);
      setPin('');
      shake.set(withSequence(
        withTiming(-14, { duration: 50 }), withTiming(14, { duration: 50 }),
        withTiming(-9, { duration: 50 }), withTiming(9, { duration: 50 }), withTiming(0, { duration: 50 }),
      ));
    }
  };

  return (
    <View style={{ alignItems: 'center' }}>
      <Animated.View style={[styles.dots, shakeStyle]}>
        {[0, 1, 2, 3].map((i) => (
          <View key={i} style={[styles.dot, i < pin.length && styles.dotOn]} />
        ))}
      </Animated.View>
      <View style={styles.message}>
        {busy ? <ActivityIndicator color={color.accentSoft} /> : error ? <T variant="label" tone="red">{error}</T> : null}
      </View>
      <View style={styles.keys}>
        {KEYS.map((k, i) =>
          k === '' ? (
            <View key={i} style={styles.key} />
          ) : (
            <Press
              key={i}
              onPress={() => void press(k)}
              disabled={busy}
              scaleTo={0.92}
              accessibilityLabel={k === 'del' ? 'Стереть' : k}
              style={[styles.key, glassStyle('control', 30)]}
            >
              {k === 'del' ? <Icon as={Delete} size={30} /> : <T variant="title" numeric style={{ fontSize: 34, lineHeight: 40 }}>{k}</T>}
            </Press>
          ),
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 8 },
  sectionBody: { overflow: 'hidden' },
  footer: { paddingHorizontal: 6, lineHeight: 18 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 64, paddingHorizontal: 18, paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.10)',
  },
  value: { maxWidth: '55%', textAlign: 'right' },
  dots: { flexDirection: 'row', gap: 18, height: 22, alignItems: 'center' },
  dot: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: 'rgba(255,255,255,0.28)' },
  dotOn: { borderWidth: 0, backgroundColor: color.accentSoft },
  message: { height: 44, alignItems: 'center', justifyContent: 'center' },
  keys: { width: 3 * 92 + 2 * 16, flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  key: { width: 92, height: 92, alignItems: 'center', justifyContent: 'center' },
});
