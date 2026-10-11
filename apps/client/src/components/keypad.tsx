// Цифровая клавиатура суммы (как в Apple Pay): крупные клавиши, запятая, стирание.
// Своя, а не системная — не перекрывает шторку и одинакова на iOS и Android.
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { haptic } from '@/lib/haptics';
import { colors } from '@/lib/theme';

import { Icon } from './icon';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', ',', '0', 'del'] as const;

/** Применить нажатие к строке суммы: не больше 2 знаков после запятой и 7 до. */
export function applyKey(value: string, key: string): string {
  if (key === 'del') return value.slice(0, -1);
  if (key === ',') {
    if (value.includes(',')) return value;
    return value === '' ? '0,' : `${value},`;
  }
  const [int, frac] = value.split(',');
  if (frac !== undefined) return frac.length >= 2 ? value : value + key;
  if ((int ?? '').length >= 7) return value;
  if (value === '0') return key;
  return value + key;
}

export function parseAmount(value: string): number {
  const n = Number(value.replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

export function amountToInput(n: number): string {
  if (!(n > 0)) return '';
  const r = Math.round(n * 100) / 100;
  return Number.isInteger(r) ? String(r) : r.toFixed(2).replace('.', ',');
}

export function Keypad({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <View style={styles.grid}>
      {KEYS.map((k) => (
        <Pressable
          key={k}
          disabled={disabled}
          onPress={() => { haptic.tap(); onChange(applyKey(value, k)); }}
          onLongPress={k === 'del' ? () => { haptic.soft(); onChange(''); } : undefined}
          style={styles.cell}
          accessibilityRole="button"
          accessibilityLabel={k === 'del' ? 'Стереть' : k === ',' ? 'Запятая' : k}
        >
          {({ pressed }) => (
            <View style={[styles.key, pressed && styles.keyPressed]}>
              {k === 'del'
                ? <Icon name="backspace" size={24} color={colors.textBody} weight="medium" />
                : <Text style={styles.keyText} maxFontSizeMultiplier={1.2}>{k}</Text>}
            </View>
          )}
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 6 },
  cell: { width: '33.333%', alignItems: 'center' },
  key: { width: '82%', minHeight: 54, alignItems: 'center', justifyContent: 'center', borderRadius: 27 },
  keyPressed: { backgroundColor: 'rgba(255,255,255,0.10)' },
  keyText: { color: colors.text, fontSize: 28, fontWeight: '500', fontVariant: ['tabular-nums'] },
});
