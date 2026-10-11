import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Text } from '@/components/text';
import { PinDots, PinPad, type PinKey } from '@/components/pin-pad';
import { api, ApiError } from '@/lib/api';
import { haptic } from '@/lib/haptics';
import { useSession } from '@/lib/session';
import { colors, space, type } from '@/lib/theme';
import type { LoginResponse } from '@/lib/types';

const PIN_LENGTH = 4;

export default function LoginScreen() {
  const router = useRouter();
  const club = useSession((s) => s.club);
  const [pin, setPin] = useState('');
  const [shakeKey, setShakeKey] = useState(0);

  const login = useMutation({
    mutationFn: (code: string) =>
      api.post<LoginResponse>('/auth/login/pin', { pin: code }, { auth: false }),
    onSuccess: async (res) => {
      haptic.success();
      await useSession.getState().signIn(res.token, res.user);
    },
    onError: (error) => {
      haptic.error();
      setPin('');
      if (error instanceof ApiError && error.status === 401) {
        setShakeKey((k) => k + 1);
      } else {
        Alert.alert('Не удалось войти', error.message);
      }
    },
  });

  const onKey = (key: PinKey) => {
    if (login.isPending) return;
    if (key === 'delete') {
      setPin((p) => p.slice(0, -1));
      return;
    }
    if (pin.length >= PIN_LENGTH) return;
    const next = pin + key;
    setPin(next);
    if (next.length === PIN_LENGTH) login.mutate(next);
  };

  const changeClub = () => {
    Alert.alert('Сменить клуб?', `Сейчас выбран ${club?.name ?? 'клуб'} (${club?.host}).`, [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Сменить', onPress: () => void useSession.getState().forgetClub() },
    ]);
  };

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Text style={[type.subhead, styles.club]} numberOfLines={1}>
          {club?.name}
        </Text>
        <Text style={[type.title2, styles.title]}>
          {login.isPending ? 'Входим…' : 'Введите PIN'}
        </Text>
        <PinDots length={PIN_LENGTH} filled={login.isPending ? PIN_LENGTH : pin.length} shakeKey={shakeKey} />
      </View>

      <PinPad onKey={onKey} disabled={login.isPending} canDelete={pin.length > 0} />

      <View style={styles.footer}>
        <Pressable onPress={() => router.push('/password')} hitSlop={12} accessibilityRole="button">
          <Text style={[type.body, styles.link]}>Войти по паролю</Text>
        </Pressable>
        <Pressable onPress={changeClub} hitSlop={12} accessibilityRole="button">
          <Text style={[type.body, styles.link]}>Сменить клуб</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'space-evenly',
    alignItems: 'center',
    paddingHorizontal: space.xl,
  },
  header: { alignItems: 'center', gap: space.md },
  club: { color: colors.secondaryLabel },
  title: { color: colors.label },
  // С крупным текстом две ссылки в ряд не помещаются — вторая переносится под первую.
  footer: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', columnGap: space.xxxl, rowGap: space.md },
  link: { color: colors.accent },
});
