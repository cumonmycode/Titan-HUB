// Вход, шаг 2 (номера нет в клубе): анкета нового клиента — фото, никнейм, имя, день рождения.
import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { Field } from '@/components/field';
import { Button, Icon, Tap } from '@/components/ui';
import { maskBirthday } from '@/lib/format';
import { colors, space, type } from '@/lib/theme';

export interface RegistrationDraft {
  nickname: string;
  fullName: string;
  /** ДД.ММ.ГГГГ, как в поле ввода. */
  birthday: string;
  photoUri: string | null;
}

const PHOTO_SIZE = 104;

interface RegisterStepProps {
  phone: string;
  draft: RegistrationDraft;
  onChange: (draft: RegistrationDraft) => void;
  onPickPhoto: () => void;
  busy: boolean;
  error: string | null;
  onSubmit: () => void;
  onBack: () => void;
}

export function RegisterStep({ phone, draft, onChange, onPickPhoto, busy, error, onSubmit, onBack }: RegisterStepProps) {
  const set = (patch: Partial<RegistrationDraft>) => onChange({ ...draft, ...patch });
  return (
    <Animated.View entering={FadeIn.duration(250)}>
      <Tap onPress={onBack} scaleTo={0.94} hitSlop={10} style={styles.back} accessibilityRole="button" accessibilityLabel="Изменить номер">
        <Icon name="chevron-back" size={18} color={colors.violetLight} />
        <Text style={styles.backText}>{phone}</Text>
      </Tap>

      <Text style={[type.title, { marginTop: space.lg }]}>Давайте знакомиться</Text>
      <Text style={styles.lead}>
        Этого номера ещё нет в клубе. Заполните анкету, а затем подтвердите регистрацию в Telegram.
      </Text>

      <View style={styles.photoBlock}>
        <Tap onPress={onPickPhoto} scaleTo={0.95} accessibilityRole="button" accessibilityLabel={draft.photoUri ? 'Сменить фото' : 'Добавить фото'}>
          <View style={[styles.photo, draft.photoUri ? styles.photoFilled : null]}>
            {draft.photoUri
              ? <Image source={{ uri: draft.photoUri }} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} />
              : <Icon name="camera" size={30} color={colors.violetLight} />}
          </View>
          <View style={styles.photoBadge}>
            <Icon name={draft.photoUri ? 'sync' : 'add'} size={16} color="#fff" />
          </View>
        </Tap>
        <Text style={styles.photoHint}>{draft.photoUri ? 'Сменить фото' : 'Добавьте фото — по нему вас узнают в клубе'}</Text>
      </View>

      <Field label="Никнейм" value={draft.nickname} onChangeText={(t) => set({ nickname: t })}
        maxLength={32} autoCapitalize="none" autoCorrect={false} placeholder="Как вас зовут в клубе" />
      <Field label="Имя" value={draft.fullName} onChangeText={(t) => set({ fullName: t })}
        maxLength={80} placeholder="Имя" textContentType="givenName" autoComplete="name-given" />
      <Field label="День рождения" value={draft.birthday} onChangeText={(t) => set({ birthday: maskBirthday(t) })}
        keyboardType="number-pad" placeholder="ДД.ММ.ГГГГ" maxLength={10}
        hint="В день рождения клуб может подарить бонусы" />

      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Button title="Продолжить" loading={busy} onPress={onSubmit} style={{ marginTop: space.xl }} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  back: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 2 },
  backText: { color: colors.violetLight, fontSize: 15, fontWeight: '700' },
  lead: { ...type.callout, color: colors.textSecondary, marginTop: space.sm },
  photoBlock: { alignItems: 'center', marginTop: space.xl },
  photo: {
    width: PHOTO_SIZE, height: PHOTO_SIZE, borderRadius: PHOTO_SIZE / 2, overflow: 'hidden',
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.violetTint,
    borderWidth: 1.5, borderColor: colors.borderViolet, borderStyle: 'dashed',
  },
  photoFilled: { borderStyle: 'solid', borderColor: 'rgba(139,92,246,0.55)', borderWidth: 2 },
  photoBadge: {
    position: 'absolute', right: 2, bottom: 2, width: 30, height: 30, borderRadius: 15,
    backgroundColor: colors.violet, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: colors.background,
  },
  photoHint: { ...type.caption, marginTop: space.sm, textAlign: 'center' },
  error: { color: colors.red, fontSize: 13, textAlign: 'center', marginTop: space.lg },
});
