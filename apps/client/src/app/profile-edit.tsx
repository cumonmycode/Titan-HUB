// Правка своих данных: никнейм, имя, телефон, день рождения (PATCH /auth/me).
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Field } from '@/components/field';
import { Button, Icon, Tap } from '@/components/ui';
import { api, errorText } from '@/lib/api';
import { birthdayToInput, inputToBirthday, maskBirthday, normalizePhone } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { keys, useWallet } from '@/lib/queries';
import { colors, GUTTER, MAX_WIDTH, space, type } from '@/lib/theme';

export default function ProfileEditScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { data: w } = useWallet();
  const [nickname, setNickname] = useState(w?.profile.nickname ?? '');
  const [fullName, setFullName] = useState(w?.profile.fullName ?? '');
  const [phone, setPhone] = useState(w?.profile.phone ?? '');
  const [birthday, setBirthday] = useState(birthdayToInput(w?.profile.birthday));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = () => (router.canGoBack() ? router.back() : router.replace('/profile'));

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
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.background }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[styles.header, { paddingTop: Platform.OS === 'android' ? insets.top + space.md : space.lg }]}>
        <Text style={type.heading}>Личные данные</Text>
        <Tap onPress={close} scaleTo={0.9} style={styles.close} accessibilityLabel="Закрыть">
          <Icon name="close" size={20} color={colors.textBody} />
        </Tap>
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: GUTTER, paddingBottom: insets.bottom + space.xxl }} keyboardShouldPersistTaps="handled">
        <View style={styles.column}>
          <Field label="Никнейм" value={nickname} onChangeText={setNickname} maxLength={40} autoCapitalize="none" autoCorrect={false} />
          <Field label="Имя" value={fullName} onChangeText={setFullName} maxLength={120} placeholder="Как к вам обращаться" textContentType="name" />
          <Field label="Телефон" value={phone} onChangeText={(t) => setPhone(normalizePhone(t))} keyboardType="phone-pad" placeholder="+7…" textContentType="telephoneNumber" />
          <Field label="День рождения" value={birthday} onChangeText={(t) => setBirthday(maskBirthday(t))} keyboardType="number-pad" placeholder="ДД.ММ.ГГГГ"
            hint="В день рождения клуб может подарить бонусы" />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Button title="Сохранить" loading={saving} onPress={() => void save()} style={{ marginTop: space.xl }} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: GUTTER, marginBottom: space.sm },
  close: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center' },
  column: { width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center' },
  error: { color: colors.red, fontSize: 13, marginTop: space.lg, textAlign: 'center' },
});
