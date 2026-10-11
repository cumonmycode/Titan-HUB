import { SymbolView } from 'expo-symbols';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import type { SFSymbol } from 'sf-symbols-typescript';

import { Text, TextInput } from '@/components/text';
import { sheetStyles } from '@/components/new-check-parts';
import { useAutoFocus } from '@/lib/auto-focus';
import { colors, space, type } from '@/lib/theme';

/** Поля форм в шторках: подпись группы капсом и строка ввода со значком — внутри стеклянной карточки. */

export function FormSection({ title, footer, children }: { title: string; footer?: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={[type.footnote, sheetStyles.sectionTitle]}>{title}</Text>
      {children}
      {footer && <Text style={[type.footnote, styles.footer]}>{footer}</Text>}
    </View>
  );
}

export function FormField({
  icon,
  value,
  onChange,
  placeholder,
  keyboardType,
  autoCapitalize = 'none',
  autoFocus,
  suffix,
}: {
  icon: SFSymbol;
  value: string;
  onChange: (text: string) => void;
  placeholder: string;
  keyboardType?: 'phone-pad' | 'decimal-pad' | 'number-pad';
  autoCapitalize?: 'none' | 'words' | 'sentences';
  autoFocus?: boolean;
  /** Единица справа от значения, например «₽». */
  suffix?: string;
}) {
  const focus = useAutoFocus(!!autoFocus);
  return (
    <View style={styles.field}>
      <SymbolView name={icon} size={16} weight="medium" tintColor={colors.secondaryLabel} />
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.tertiaryLabel}
        selectionColor={colors.accent}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        {...focus}
        accessibilityLabel={placeholder}
        style={[type.body, styles.input]}
      />
      {suffix && value.length > 0 && <Text style={[type.body, sheetStyles.secondary]}>{suffix}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: space.sm },
  footer: { color: colors.secondaryLabel, paddingHorizontal: space.xs },
  field: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 50 },
  input: { flex: 1, color: colors.label, minHeight: 50 },
});
