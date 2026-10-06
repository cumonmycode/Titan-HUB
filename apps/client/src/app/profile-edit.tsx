// Правка своих данных: никнейм, имя, телефон, день рождения (PATCH /auth/me).
// Форма как в «Настройках» iOS: поля — строки одной группы, подпись слева.
// Шторка по высоте содержимого; при вводе iOS сам поднимает её над клавиатурой.
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  StyleSheet, Text, TextInput, type TextInputProps, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlassButton } from '@/components/glass';
import { SheetHeader, useCloseSheet } from '@/components/sheet';
import { Divider, Surface } from '@/components/ui';
import { api, errorText } from '@/lib/api';
import { birthdayToInput, inputToBirthday, maskBirthday, normalizePhone } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { keys, useWallet } from '@/lib/queries';
import { colors, GUTTER, MAX_WIDTH, radius, space, type } from '@/lib/theme';

const LABEL_WIDTH = 124;

export default function ProfileEditScreen() {
  const insets = useSafeAreaInsets();
  const close = useCloseSheet('/profile');
  const qc = useQueryClient();
  const { data: w } = useWallet();
  const [nickname, setNickname] = useState(w?.profile.nickname ?? '');
  const [fullName, setFullName] = useState(w?.profile.fullName ?? '');
  const [phone, setPhone] = useState(w?.profile.phone ?? '');
  const [birthday, setBirthday] = useState(birthdayToInput(w?.profile.birthday));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const bd = inputToBirthday(birthday);
    if (!nickname.trim()) { setError('Укажите никнейм'); return; }
    if (bd === 'invalid') { setError('Дата рождения — в формате ДД.ММ.ГГГГ'); return; }
    if (phone && phone.replace(/\D/g, '').length !== 11) { setError('Телефон — 11 цифр, например +7 900 000-00-00'); return; }
    setSaving(true);
    setError(null);
    try {
      await api.patch('/auth/me', { nickname: nickname.trim(), fullName: fullName.trim() || null, phone: phone || null, birthday: bd });
      await qc.invalidateQueries({ queryKey: keys.wallet });
      haptic.success();
      close();
    } catch (e) {
      haptic.error();
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <View>
      <SheetHeader title="Личные данные" onClose={close} />
      <View style={[styles.content, { paddingBottom: insets.bottom + space.xl }]}>
        <View style={styles.column}>
          <Surface style={styles.group}>
            <Field label="Никнейм" value={nickname} onChangeText={setNickname} maxLength={40} autoCapitalize="none" autoCorrect={false} />
            <Divider inset={space.lg} />
            <Field label="Имя" value={fullName} onChangeText={setFullName} maxLength={120} placeholder="Как к вам обращаться" textContentType="name" />
            <Divider inset={space.lg} />
            <Field label="Телефон" value={phone} onChangeText={(t) => setPhone(normalizePhone(t))} keyboardType="phone-pad" placeholder="+7…" textContentType="telephoneNumber" />
            <Divider inset={space.lg} />
            <Field label="День рождения" value={birthday} onChangeText={(t) => setBirthday(maskBirthday(t))} keyboardType="number-pad" placeholder="ДД.ММ.ГГГГ" />
          </Surface>
          <Text style={styles.footer}>В день рождения клуб может подарить бонусы.</Text>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <GlassButton title="Сохранить" loading={saving} onPress={() => void save()} style={styles.save} />
        </View>
      </View>
    </View>
  );
}

function Field({ label, ...props }: TextInputProps & { label: string }) {
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
  content: { paddingHorizontal: GUTTER },
  column: { width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center' },
  group: { borderRadius: radius.card, overflow: 'hidden', marginTop: space.sm },
  field: { flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingHorizontal: space.lg },
  label: { width: LABEL_WIDTH, color: colors.text, fontSize: 16, fontWeight: '500' },
  input: { flex: 1, color: colors.text, fontSize: 16, paddingVertical: space.md },
  footer: { ...StyleSheet.flatten(type.caption), marginTop: space.sm, marginHorizontal: space.lg },
  error: { color: colors.red, fontSize: 13, marginTop: space.lg, textAlign: 'center' },
  save: { marginTop: space.xl },
});
