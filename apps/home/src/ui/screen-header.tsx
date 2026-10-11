import type { LucideIcon } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { IconButton } from './button';
import { T } from './text';

/** Шапка служебных экранов: «назад»/«закрыть» слева, заголовок, действие справа. */
export function ScreenHeader({ icon, label, onBack, title, caption, right }: {
  icon: LucideIcon; label: string; onBack: () => void; title: string; caption?: string | null; right?: ReactNode;
}) {
  return (
    <View style={styles.bar}>
      <IconButton icon={icon} label={label} onPress={onBack} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <T variant="title" numberOfLines={1}>{title}</T>
        {caption ? <T variant="caption" tone="secondary" numberOfLines={2}>{caption}</T> : null}
      </View>
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: 16, minHeight: 56 },
});
