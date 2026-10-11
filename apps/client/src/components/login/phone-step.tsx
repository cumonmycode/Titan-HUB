// Вход, шаг 1: номер телефона.
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';

import { Field } from '@/components/field';
import { HoloCard } from '@/components/holo-card';
import { Button } from '@/components/ui';
import { isFullPhone, maskPhone } from '@/lib/format';
import { colors, space, type } from '@/lib/theme';

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

      <Animated.View entering={FadeInDown.delay(120).duration(500)} style={{ marginTop: space.xxl }}>
        <Text style={styles.kicker}>MY TITAN</Text>
        <Text style={[type.title, { marginTop: 6 }]}>Кошелёк клуба{'\n'}в вашем телефоне</Text>
        <Text style={styles.lead}>
          Войдите по номеру телефона и подтвердите вход в Telegram — это нужно сделать один раз.
        </Text>
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(200).duration(500)}>
        <Field
          label="Номер телефона"
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
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Button
          title="Продолжить"
          loading={busy}
          disabled={!isFullPhone(phone)}
          onPress={onSubmit}
          style={{ marginTop: space.xl }}
        />
        <View style={styles.demo}>
          <Button title="Посмотреть демо" variant="ghost" size="md" onPress={onDemo} />
        </View>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  kicker: { color: colors.violetLight, fontSize: 12, fontWeight: '900', letterSpacing: 3 },
  lead: { ...type.callout, color: colors.textSecondary, marginTop: space.sm },
  error: { color: colors.red, fontSize: 13, textAlign: 'center', marginTop: space.md },
  demo: { marginTop: space.sm },
});
