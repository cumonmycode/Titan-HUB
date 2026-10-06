// Сегментный переключатель — системный UISegmentedControl (на iOS 26 со стеклянным
// бегунком), выбранный сегмент — в violet Titan. На Android библиотека рисует свой
// аналог на RN в тех же цветах.
import SegmentedControl from '@react-native-segmented-control/segmented-control';
import { StyleSheet } from 'react-native';

import { haptic } from '@/lib/haptics';
import { colors } from '@/lib/theme';

export function Segmented<T extends string>({
  options, value, onChange,
}: { options: { key: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  const index = Math.max(0, options.findIndex((o) => o.key === value));
  return (
    <SegmentedControl
      values={options.map((o) => o.label)}
      selectedIndex={index}
      onChange={(e) => {
        const next = options[e.nativeEvent.selectedSegmentIndex];
        if (next && next.key !== value) {
          haptic.select();
          onChange(next.key);
        }
      }}
      appearance="dark"
      tintColor={colors.violet}
      backgroundColor="rgba(255,255,255,0.08)"
      fontStyle={{ color: colors.textSecondary, fontSize: 14, fontWeight: '600' }}
      activeFontStyle={{ color: '#ffffff', fontSize: 14, fontWeight: '700' }}
      style={styles.control}
    />
  );
}

const styles = StyleSheet.create({
  control: { height: 36 },
});
