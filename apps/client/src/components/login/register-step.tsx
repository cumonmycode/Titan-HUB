// Вход, номера нет в клубе: анкета нового клиента — фото, никнейм, имя, день рождения.
import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';

import { FormRow } from '@/components/form-row';
import { GlassButton } from '@/components/glass';
import { Icon } from '@/components/icon';
import { Tap } from '@/components/tap';
import { Divider, Surface } from '@/components/ui';
import { maskBirthday } from '@/lib/format';
import { colors, radius, space, type } from '@/lib/theme';

import { OnboardingLayout } from './onboarding-layout';

export interface RegistrationDraft {
  nickname: string;
  fullName: string;
  /** ДД.ММ.ГГГГ, как в поле ввода. */
  birthday: string;
  photoUri: string | null;
}

const PHOTO_SIZE = 104;

interface RegisterStepProps {
  draft: RegistrationDraft;
  onChange: (draft: RegistrationDraft) => void;
  onPickPhoto: () => void;
  busy: boolean;
  error: string | null;
  onSubmit: () => void;
  onBack: () => void;
}

export function RegisterStep({ draft, onChange, onPickPhoto, busy, error, onSubmit, onBack }: RegisterStepProps) {
  const set = (patch: Partial<RegistrationDraft>) => onChange({ ...draft, ...patch });
  return (
    <OnboardingLayout
      onBack={onBack}
      title="Давайте знакомиться"
      subtitle="Этого номера ещё нет в клубе. Заполните анкету — затем подтвердите регистрацию в Telegram."
      footer={<GlassButton title="Продолжить" loading={busy} onPress={onSubmit} />}
    >
      <View style={styles.photoBlock}>
        <Tap onPress={onPickPhoto} scaleTo={0.95} accessibilityRole="button" accessibilityLabel={draft.photoUri ? 'Сменить фото' : 'Добавить фото'}>
          <Surface tone={colors.violet} style={[styles.photo, draft.photoUri ? styles.photoFilled : null]}>
            {draft.photoUri
              ? <Image source={{ uri: draft.photoUri }} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} />
              : <Icon name="camera" size={30} color={colors.lavender} />}
          </Surface>
          <View style={styles.photoBadge}>
            <Icon name={draft.photoUri ? 'refresh' : 'add'} size={14} color="#fff" weight="bold" />
          </View>
        </Tap>
        <Text style={styles.photoHint}>{draft.photoUri ? 'Сменить фото' : 'Добавьте фото — по нему вас узнают в клубе'}</Text>
      </View>

      <Surface style={styles.group}>
        <FormRow label="Никнейм" value={draft.nickname} onChangeText={(t) => set({ nickname: t })}
          maxLength={32} autoCapitalize="none" autoCorrect={false} placeholder="Как вас зовут в клубе" />
        <Divider inset={space.lg} />
        <FormRow label="Имя" value={draft.fullName} onChangeText={(t) => set({ fullName: t })}
          maxLength={80} placeholder="Имя" textContentType="givenName" autoComplete="name-given" />
        <Divider inset={space.lg} />
        <FormRow label="День рождения" value={draft.birthday} onChangeText={(t) => set({ birthday: maskBirthday(t) })}
          keyboardType="number-pad" placeholder="ДД.ММ.ГГГГ" maxLength={10} />
      </Surface>
      <Text style={styles.footer}>В день рождения клуб может подарить бонусы.</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </OnboardingLayout>
  );
}

const styles = StyleSheet.create({
  photoBlock: { alignItems: 'center', marginTop: space.xxl, marginBottom: space.lg },
  photo: {
    width: PHOTO_SIZE, height: PHOTO_SIZE, borderRadius: PHOTO_SIZE / 2, overflow: 'hidden',
    alignItems: 'center', justifyContent: 'center', borderStyle: 'dashed', borderWidth: 1.5,
  },
  photoFilled: { borderStyle: 'solid', borderWidth: 2, borderColor: 'rgba(139,92,246,0.55)' },
  photoBadge: {
    position: 'absolute', right: 2, bottom: 2, width: 30, height: 30, borderRadius: 15,
    backgroundColor: colors.violet, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: colors.background,
  },
  photoHint: { ...StyleSheet.flatten(type.caption), marginTop: space.sm, textAlign: 'center' },
  group: { borderRadius: radius.card, overflow: 'hidden' },
  footer: { ...StyleSheet.flatten(type.caption), marginTop: space.sm, marginHorizontal: space.lg },
  error: { color: colors.red, fontSize: 13, textAlign: 'center', marginTop: space.lg },
});
