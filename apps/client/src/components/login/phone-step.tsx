// Вход: номер телефона, как в Telegram — строка страны, отдельно «+7» и номер.
// Автозаполнение и вставка в любом формате разбираются (lib/format nationalPhoneDigits).
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { GlassButton } from '@/components/glass';
import { Divider, Surface } from '@/components/ui';
import { formatNationalPhone, isFullNationalPhone, nationalPhoneDigits } from '@/lib/format';
import { colors, radius, space } from '@/lib/theme';

import { OnboardingLayout } from './onboarding-layout';

interface PhoneStepProps {
  /** Номер без «+7», до 10 цифр. */
  digits: string;
  onChangeDigits: (digits: string) => void;
  busy: boolean;
  error: string | null;
  onSubmit: () => void;
  onBack: () => void;
}

export function PhoneStep({ digits, onChangeDigits, busy, error, onSubmit, onBack }: PhoneStepProps) {
  return (
    <OnboardingLayout
      onBack={onBack}
      title="Ваш телефон"
      subtitle="Номер, по которому вас знают в клубе. Подтвердить вход нужно будет в Telegram."
      footer={<GlassButton title="Продолжить" loading={busy} disabled={!isFullNationalPhone(digits)} onPress={onSubmit} />}
    >
      <Surface style={styles.group}>
        <View style={styles.row}>
          <Text style={styles.label}>Страна</Text>
          <Text style={styles.value}>Россия</Text>
        </View>
        <Divider inset={space.lg} />
        <View style={styles.row}>
          <Text style={styles.code}>+7</Text>
          <View style={styles.sep} />
          <TextInput
            style={styles.input}
            value={formatNationalPhone(digits)}
            onChangeText={(text) => onChangeDigits(nationalPhoneDigits(digits, text))}
            placeholder="000 000-00-00"
            placeholderTextColor={colors.textMuted}
            keyboardType="phone-pad"
            textContentType="telephoneNumber"
            autoComplete="tel"
            autoFocus
            returnKeyType="done"
            onSubmitEditing={onSubmit}
            selectionColor={colors.violet}
            cursorColor={colors.violet}
            keyboardAppearance="dark"
            accessibilityLabel="Номер телефона"
          />
        </View>
      </Surface>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </OnboardingLayout>
  );
}

const styles = StyleSheet.create({
  group: { marginTop: space.xxl, borderRadius: radius.card, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingHorizontal: space.lg, gap: space.md },
  label: { flex: 1, color: colors.text, fontSize: 16, fontWeight: '500' },
  value: { color: colors.violetLight, fontSize: 16, fontWeight: '600' },
  code: { color: colors.text, fontSize: 20, fontWeight: '600', fontVariant: ['tabular-nums'] },
  sep: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch', marginVertical: space.md, backgroundColor: colors.borderStrong },
  input: { flex: 1, color: colors.text, fontSize: 20, fontWeight: '600', letterSpacing: 0.5, fontVariant: ['tabular-nums'], paddingVertical: space.md },
  error: { color: colors.red, fontSize: 13, textAlign: 'center', marginTop: space.md },
});
