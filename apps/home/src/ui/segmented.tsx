// Сегменты в «утопленной» капсуле: режимы кондиционера, обдув, чаевые, ориентация.
import type { LucideIcon } from 'lucide-react-native';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { glassStyle } from './glass';
import { Icon } from './icon';
import { Press } from './press';
import { T } from './text';
import { color, radius } from './tokens';

export type Segment<K extends string> = { key: K; label: string; icon?: LucideIcon; tone?: string };

export function Segmented<K extends string>({
  options, value, onChange, height = 52, disabled, style, stacked,
}: {
  options: Segment<K>[];
  value: K | null;
  onChange: (key: K) => void;
  height?: number;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  /** Иконка над подписью (узкие сегменты режимов). */
  stacked?: boolean;
}) {
  return (
    <View style={[styles.track, glassStyle('inset', stacked ? 22 : radius.pill), style]} accessibilityRole="radiogroup">
      {options.map((o) => {
        const active = o.key === value;
        const tone = active ? o.tone ?? color.text : color.textSecondary;
        return (
          <Press
            key={o.key}
            onPress={() => { if (!active) onChange(o.key); }}
            disabled={disabled}
            scaleTo={0.95}
            accessibilityRole="radio"
            accessibilityLabel={o.label}
            accessibilityState={{ selected: active, checked: active }}
            style={[
              styles.item,
              { height, borderRadius: stacked ? 18 : radius.pill },
              stacked ? styles.stacked : styles.inline,
              active && glassStyle('raised', stacked ? 18 : radius.pill),
              active && o.tone ? { borderColor: `${o.tone}88`, backgroundColor: `${o.tone}2E` } : null,
            ]}
          >
            {o.icon ? <Icon as={o.icon} size={stacked ? 20 : 18} tone={tone} /> : null}
            <T
              variant={stacked ? 'small' : 'label'}
              style={{ color: active ? color.text : color.textSecondary }}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.75}
            >
              {o.label}
            </T>
          </Press>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { flexDirection: 'row', padding: 4, gap: 4 },
  item: { flex: 1, minWidth: 0, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'transparent' },
  inline: { flexDirection: 'row', gap: 8, paddingHorizontal: 8 },
  stacked: { flexDirection: 'column', gap: 3 },
});
