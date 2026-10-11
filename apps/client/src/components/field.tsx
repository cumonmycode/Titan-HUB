// Поле ввода с подписью и подсказкой — анкета при входе и «Личные данные».
import { useState } from 'react';
import { StyleSheet, Text, TextInput, type TextInputProps, View } from 'react-native';

import { colors, space, type } from '@/lib/theme';

export function Field({ label, hint, ...props }: TextInputProps & { label: string; hint?: string }) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ marginTop: space.lg }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        {...props}
        onFocus={(e) => { setFocused(true); props.onFocus?.(e); }}
        onBlur={(e) => { setFocused(false); props.onBlur?.(e); }}
        placeholderTextColor={colors.textMuted}
        selectionColor={colors.violet}
        keyboardAppearance="dark"
        style={[styles.input, focused && { borderColor: colors.violet }]}
        accessibilityLabel={label}
      />
      {hint ? <Text style={[type.caption, { marginTop: 6, marginLeft: 2 }]}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { color: colors.textSecondary, fontSize: 12, fontWeight: '700', marginBottom: 6, marginLeft: 2 },
  input: {
    height: 50, borderRadius: 13, paddingHorizontal: 14, fontSize: 16, color: colors.text,
    backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: colors.border,
  },
});
