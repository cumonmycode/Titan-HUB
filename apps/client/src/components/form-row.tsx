// Строка формы как в «Настройках» iOS: подпись слева, поле справа. Строки собираются
// в группу на Surface с Divider между ними (личные данные, анкета при входе).
import { StyleSheet, Text, TextInput, type TextInputProps, View } from 'react-native';

import { colors, space } from '@/lib/theme';

const LABEL_WIDTH = 124;

export function FormRow({ label, ...props }: TextInputProps & { label: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        {...props}
        placeholderTextColor={colors.textMuted}
        selectionColor={colors.violet}
        cursorColor={colors.violet}
        keyboardAppearance="dark"
        style={styles.input}
        accessibilityLabel={label}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  field: { flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingHorizontal: space.lg },
  label: { width: LABEL_WIDTH, color: colors.text, fontSize: 16, fontWeight: '500' },
  input: { flex: 1, color: colors.text, fontSize: 16, paddingVertical: space.md },
});
