import { Stack } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';

import { BigButton, Card, PlatformBadge } from '@/components/smm/parts';
import { Text, TextInput } from '@/components/text';
import { ApiError } from '@/lib/api';
import { haptic } from '@/lib/haptics';
import { usePageGutter } from '@/lib/layout';
import { useClubKey } from '@/lib/queries';
import { setInstagramToken, useSmmInstagram } from '@/lib/smm-api';
import { colors, space, type, useAccentHex } from '@/lib/theme';

const STEPS: { title: string; text: string; link?: string }[] = [
  { title: 'Профессиональный аккаунт', text: 'В Instagram: Настройки → «Тип аккаунта и инструменты» → «Переключиться на профессиональный» (Бизнес или Автор). Бесплатно.' },
  { title: 'Приложение Meta', text: 'На developers.facebook.com → «Мои приложения» → «Создать приложение». Сценарий — «Управлять сообщениями и контентом в Instagram», тип — «Бизнес».', link: 'https://developers.facebook.com/apps' },
  { title: 'Добавить аккаунт клуба', text: 'В приложении: Instagram → «Настройка API со входом через Instagram» → «Добавить аккаунт» и войдите в Instagram клуба. Если попросят подтвердить приглашение тестировщика — в Instagram: Настройки → «Приложения и сайты».' },
  { title: 'Получить ключ', text: 'Там же нажмите «Сгенерировать токен» рядом с аккаунтом, разрешите доступ и скопируйте ключ целиком. Он действует 60 дней — дальше Tai продлевает его сам.' },
  { title: 'Вставить сюда', text: 'Вставьте ключ в поле ниже и нажмите «Подключить». Нужен VPN на телефоне, если Instagram у вас открывается только с ним.' },
];

function daysLeft(iso: string): number {
  return Math.max(0, Math.round((Date.parse(iso) - Date.now()) / 86_400_000));
}

/**
 * Instagram по официальному API: Tai сам берёт цифры и ссылки и выкладывает посты,
 * карусели, рилс и сторис. Подключение — ключом из кабинета Meta (вход в Instagram
 * делается там, пароль в HUB не попадает).
 */
export default function SmmInstagramScreen() {
  const club = useClubKey();
  const gutter = usePageGutter();
  const accent = useAccentHex();
  const query = useSmmInstagram();
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const state = query.data?.state ?? null;

  const connect = async () => {
    setBusy(true);
    try {
      const r = await setInstagramToken(club, token.trim());
      setToken('');
      haptic.success();
      Alert.alert('Instagram подключён', `@${r.state?.username ?? ''}: Tai теперь сам берёт цифры и выкладывает одобренные публикации.`);
    } catch (error) {
      Alert.alert('Не подключился', error instanceof ApiError ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const disconnect = () =>
    Alert.alert('Отключить Instagram?', 'Tai перестанет выкладывать сам — будет снова присылать файлы человеку.', [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Отключить', style: 'destructive', onPress: () => void setInstagramToken(club, null).catch((e) => Alert.alert('Не получилось', String(e))) },
    ]);

  return (
    <View style={styles.screen}>
      <Stack.Title>Instagram</Stack.Title>
      <KeyboardAvoidingView behavior="padding" style={styles.flex}>
        <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={[styles.content, gutter]} keyboardShouldPersistTaps="handled">
          <Card>
            <View style={styles.head}>
              <PlatformBadge platform="instagram" size={40} />
              <View style={styles.flex}>
                <Text style={[type.title3, styles.label]}>{state ? `@${state.username}` : 'Не подключён'}</Text>
                <Text style={[type.footnote, styles.secondary]}>
                  {state ? `Tai выкладывает сам и берёт цифры. Ключ ещё ${daysLeft(state.expiresAt)} дн., продлевается сам.` : 'Сейчас Tai присылает файлы и текст человеку и ждёт ссылку.'}
                </Text>
              </View>
            </View>
            {state?.error ? <Text style={[type.footnote, { color: colors.orange }]}>{state.error}</Text> : null}
            {state ? <BigButton tone="destructive" title="Отключить" icon="xmark" onPress={disconnect} /> : null}
          </Card>

          <Text style={[type.title3, styles.label]}>{state ? 'Заменить ключ' : 'Как подключить'}</Text>
          {STEPS.map((step, i) => (
            <View key={step.title} style={styles.step}>
              <View style={[styles.number, { backgroundColor: accent }]}>
                <Text style={[type.footnote, styles.onAccent]}>{i + 1}</Text>
              </View>
              <View style={styles.flex}>
                <Text style={[type.headline, styles.label]}>{step.title}</Text>
                <Text style={[type.subhead, styles.secondary]}>{step.text}</Text>
                {step.link ? (
                  <Pressable onPress={() => void Linking.openURL(step.link!)} accessibilityRole="link" hitSlop={6}>
                    <Text style={[type.subhead, { color: accent }]}>Открыть кабинет Meta</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          ))}

          <View style={styles.input}>
            <TextInput
              value={token}
              onChangeText={setToken}
              placeholder="Ключ доступа (начинается с IG…)"
              placeholderTextColor={colors.tertiaryLabel}
              selectionColor={colors.accent}
              autoCapitalize="none"
              autoCorrect={false}
              multiline
              style={[type.body, styles.inputText]}
              accessibilityLabel="Ключ доступа Instagram"
            />
          </View>
          <BigButton title="Подключить" icon="link" busy={busy} disabled={token.trim().length < 40} onPress={() => void connect()} />
          <View style={styles.note}>
            <SymbolView name="lock.fill" size={14} tintColor={colors.secondaryLabel} />
            <Text style={[type.footnote, styles.secondary, styles.flex]}>Ключ хранится на сервере клуба зашифрованным и никому не показывается. Пароль от Instagram HUB не видит.</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.groupedBackground },
  flex: { flex: 1, minWidth: 0 },
  content: { gap: space.md, paddingTop: space.md, paddingBottom: space.xxxl },
  label: { color: colors.label },
  secondary: { color: colors.secondaryLabel },
  onAccent: { color: 'white', fontWeight: '700' },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  step: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  number: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  input: { backgroundColor: colors.card, borderRadius: 14, borderCurve: 'continuous', paddingHorizontal: space.md, paddingVertical: space.sm },
  inputText: { color: colors.label, minHeight: 80 },
  note: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
});
