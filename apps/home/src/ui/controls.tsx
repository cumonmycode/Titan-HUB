// Мелкие элементы: переключатель (рисунок внутри плитки), степпер, загрузка, бейдж.
import { Minus, Plus } from 'lucide-react-native';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { glassStyle } from './glass';
import { Icon } from './icon';
import { Press } from './press';
import { T } from './text';
import { color, radius } from './tokens';

/** Рисунок переключателя: само нажатие обрабатывает плитка вокруг. */
export function SwitchKnob({ on, onTone = 'rgba(255,214,150,0.6)' }: { on: boolean; onTone?: string }) {
  return (
    <View style={[styles.track, { backgroundColor: on ? onTone : 'rgba(255,255,255,0.14)', justifyContent: on ? 'flex-end' : 'flex-start' }]}>
      <View style={[styles.knob, { backgroundColor: on ? '#fff' : color.textSecondary }]} />
    </View>
  );
}

export function Stepper({ value, onMinus, onPlus, size = 44 }: { value: number; onMinus: () => void; onPlus: () => void; size?: number }) {
  return (
    <View style={[styles.stepper, { height: size + 8, borderRadius: radius.pill, backgroundColor: color.accentTint, borderColor: color.accentBorder }]}>
      <Press onPress={onMinus} scaleTo={0.9} accessibilityLabel="Убрать одну" style={[styles.stepBtn, { width: size, height: size }, glassStyle('control', radius.pill)]}>
        <Icon as={Minus} size={20} stroke={2.2} />
      </Press>
      <T variant="label" numeric style={styles.stepValue}>{value}</T>
      <Press onPress={onPlus} scaleTo={0.9} accessibilityLabel="Добавить ещё" style={[styles.stepBtn, { width: size, height: size }, glassStyle('accent', radius.pill)]}>
        <Icon as={Plus} size={20} stroke={2.2} tone={color.onAccent} />
      </Press>
    </View>
  );
}

export function Loader({ label }: { label?: string }) {
  return (
    <View style={styles.loader}>
      <ActivityIndicator color={color.accentSoft} size="large" />
      {label ? <T variant="caption" tone="secondary" style={{ textAlign: 'center' }}>{label}</T> : null}
    </View>
  );
}

export function CountBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <View style={styles.badge}>
      <T variant="small" tone="onAccent" style={styles.badgeText}>{count > 99 ? '99+' : count}</T>
    </View>
  );
}

const styles = StyleSheet.create({
  track: { width: 48, height: 28, borderRadius: 14, padding: 3, flexDirection: 'row' },
  knob: { width: 22, height: 22, borderRadius: 11 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 4, padding: 4, borderWidth: 1 },
  stepBtn: { alignItems: 'center', justifyContent: 'center' },
  stepValue: { minWidth: 26, textAlign: 'center', fontSize: 18 },
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  badge: {
    position: 'absolute', top: -3, right: -3, minWidth: 22, height: 22, paddingHorizontal: 6, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center', backgroundColor: color.accent, borderWidth: 2, borderColor: color.ground,
  },
  badgeText: { fontSize: 12, lineHeight: 15 },
});
