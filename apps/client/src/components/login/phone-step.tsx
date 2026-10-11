// Вход, шаг 1: номер телефона.
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';

import { FormRow } from '@/components/form-row';
import { GlassButton } from '@/components/glass';
import { HoloCard } from '@/components/holo-card';
import { Surface } from '@/components/ui';
import { isFullPhone, maskPhone } from '@/lib/format';
import { colors, radius, space, type } from '@/lib/theme';

interface PhoneStepProps {
  phone: string;
  onChangePhone: (phone: string) => void;
  busy: boolean;
  error: string | null;
  onSubmit: () => void;
  onDemo: () => void;
}

export function PhoneStep({ phone, onChangePhone, busy, error, onSubmit, onDemo }: PhoneStepProps) {
  return (
    <Animated.View entering={FadeIn.duration(250)}>
      <Animated.View entering={FadeInDown.duration(600).springify().damping(16)}>
        <HoloCard nickname="titan" tierLabel="Резидент" tierColor={colors.violet} bonus={1240} bonusHidden={false} />
      </Animated.View>

      <View style={styles.intro}>
        <Text style={styles.kicker}>MY TITAN</Text>
        <Text style={styles.headline}>Кошелёк клуба{'\n'}в вашем телефоне</Text>
        <Text style={styles.lead}>
          Войдите по номеру телефона и подтвердите вход в Telegram — это нужно сделать один раз.
        </Text>
      </View>

      <Surface style={styles.group}>
        <FormRow
          label="Телефон"
          value={phone}
          onChangeText={(t) => onChangePhone(maskPhone(t))}
          keyboardType="phone-pad"
          textContentType="telephoneNumber"
          autoComplete="tel"
          placeholder="+7 900 000-00-00"
          maxLength={16}
          returnKeyType="done"
          onSubmitEditing={onSubmit}
        />
      </Surface>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <GlassButton title="Продолжить" loading={busy} disabled={!isFullPhone(phone)} onPress={onSubmit} style={styles.submit} />
      <GlassButton title="Посмотреть демо" variant="secondary" size="md" style={styles.demo} onPress={onDemo} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  intro: { marginTop: space.xxl, marginBottom: space.xl },
  kicker: { color: colors.violetLight, fontSize: 12, fontWeight: '900', letterSpacing: 3 },
  headline: { ...StyleSheet.flatten(type.title), marginTop: 6 },
  lead: { ...StyleSheet.flatten(type.callout), color: colors.textSecondary, marginTop: space.sm },
  group: { borderRadius: radius.card, overflow: 'hidden' },
  error: { color: colors.red, fontSize: 13, textAlign: 'center', marginTop: space.md },
  submit: { marginTop: space.xl },
  demo: { marginTop: space.lg },
});
