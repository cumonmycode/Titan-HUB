// «Профиль»: фото, личные данные, настройки уведомлений, клуб, выход. Списки — как
// «Настройки» iOS 26 на стекле. Данные здесь только читаются: правка — одной кнопкой
// «Изменить» в шапке (на Android — справа от заголовка). Бонусная программа живёт
// на главной (нажатие на карту), здесь её нет.
import { useQueryClient } from '@tanstack/react-query';
import Constants from 'expo-constants';
import { Stack, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { ActivityIndicator, Alert, Linking, StyleSheet, Text, View } from 'react-native';

import { Glass, GlassButton } from '@/components/glass';
import { Icon } from '@/components/icon';
import { ListRow, ListSection, ToggleRow } from '@/components/list';
import { TabScroll } from '@/components/screen';
import { Tap } from '@/components/tap';
import { Avatar, Skeleton, Surface, TierBadge } from '@/components/ui';
import { api, API_URL, errorText } from '@/lib/api';
import { longDate } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { photoFile, pickSquarePhoto } from '@/lib/photo';
import { pushPermission, registerForPush, unregisterPush } from '@/lib/push';
import { keys, useUpdatePrefs, useWallet } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { colors, IS_IOS, radius, space, type } from '@/lib/theme';

const BOT = 'titanwalletrobot';

export default function ProfileScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const wallet = useWallet();
  const w = wallet.data;
  const demo = useSession((s) => s.status === 'demo');
  const signOut = useSession((s) => s.signOut);
  const prefs = useUpdatePrefs();
  const [uploading, setUploading] = useState(false);
  const edit = () => router.push('/profile-edit');

  async function changePhoto() {
    if (demo) { Alert.alert('Демо-режим', 'Сменить фото можно после входа.'); return; }
    const asset = await pickSquarePhoto();
    if (!asset) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', photoFile(asset.uri));
      const up = await api.post<{ url: string }>('/upload/image', form, { timeoutMs: 45_000 });
      await api.patch('/auth/me', { photoUrl: up.url });
      await qc.invalidateQueries({ queryKey: keys.wallet });
      haptic.success();
    } catch (e) {
      haptic.error();
      Alert.alert('Не удалось обновить фото', errorText(e));
    } finally {
      setUploading(false);
    }
  }

  async function togglePush(on: boolean) {
    if (on) {
      const perm = await pushPermission();
      if (perm === 'denied') {
        Alert.alert('Уведомления выключены в системе', 'Разрешите уведомления для My Titan в настройках телефона.', [
          { text: 'Отмена', style: 'cancel' },
          { text: 'Открыть настройки', onPress: () => void Linking.openSettings() },
        ]);
        return;
      }
      await registerForPush(true);
    }
    prefs.mutate({ push: on });
  }

  function confirmLogout() {
    Alert.alert(demo ? 'Выйти из демо?' : 'Выйти из аккаунта?', demo ? undefined : 'Чтобы войти снова, понадобится подтверждение в Telegram.', [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Выйти', style: 'destructive', onPress: async () => {
          if (!demo) {
            await unregisterPush();
            await api.post('/auth/logout').catch(() => {});
          }
          qc.clear();
          await signOut();
        },
      },
    ]);
  }

  const editAndroid = (
    <Tap onPress={edit} hitSlop={10} accessibilityRole="button" accessibilityLabel="Изменить личные данные">
      <Text style={styles.editText}>Изменить</Text>
    </Tap>
  );

  return (
    <TabScroll title="Профиль" right={w ? editAndroid : undefined} onRefresh={() => wallet.refetch()}>
      {IS_IOS && w ? (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button onPress={edit} accessibilityLabel="Изменить личные данные">Изменить</Stack.Toolbar.Button>
        </Stack.Toolbar>
      ) : null}

      {!w ? (
        <View style={styles.skeletons}>
          <Skeleton height={190} rounded={radius.card} />
          <Skeleton height={240} rounded={radius.card} />
          <Skeleton height={180} rounded={radius.card} />
        </View>
      ) : (
        <>
          <View style={styles.hero}>
            <Tap onPress={changePhoto} scaleTo={0.95} accessibilityRole="button" accessibilityLabel="Сменить фото">
              <Avatar uri={w.profile.photoUrl} name={w.profile.nickname} size={96} ring />
              <Glass interactive tint="rgba(124,58,237,0.85)" fallback={styles.photoEditFallback} style={styles.photoEdit}>
                {uploading ? <ActivityIndicator size="small" color="#fff" /> : <Icon name="camera" size={15} color="#fff" />}
              </Glass>
            </Tap>
            <Text style={styles.name} numberOfLines={1}>{w.profile.nickname}</Text>
            {w.profile.fullName ? <Text style={styles.fullName} numberOfLines={1}>{w.profile.fullName}</Text> : null}
            <View style={styles.badges}>
              <TierBadge label={w.tier.label} color={w.tier.color} />
              <Text style={type.caption}>в клубе с {longDate(w.profile.memberSince)}</Text>
            </View>
          </View>

          {demo ? (
            <Surface tone={colors.amber} style={styles.demo}>
              <Icon name="demo" size={18} color={colors.amber} />
              <Text style={styles.demoText}>Демо-режим: данные ненастоящие, оплата проходит понарошку.</Text>
            </Surface>
          ) : null}

          <ListSection title="Личные данные">
            <ListRow icon="person" color={colors.violetLight} title="Имя" value={w.profile.fullName || 'Не указано'} />
            <ListRow icon="phone" color={colors.green} title="Телефон" value={w.profile.phone || 'Не указан'} />
            <ListRow icon="birthday" color={colors.pink} title="День рождения" value={w.profile.birthday ? longDate(w.profile.birthday) : 'Не указан'} />
            <ListRow icon="telegram" color={colors.telegram} title="Telegram"
              value={w.profile.tgUsername ? `@${w.profile.tgUsername}` : w.profile.telegramLinked ? 'Привязан' : 'Не привязан'} />
          </ListSection>

          <ListSection title="Уведомления">
            <ToggleRow icon="inbox" color={colors.violetLight} title="Push на телефон" subtitle="Бонусы, депозит, долг и оплаты"
              value={w.prefs.push} onChange={(v) => void togglePush(v)} />
            <ToggleRow icon="telegram" color={colors.telegram} title="Сообщения в Telegram"
              subtitle={w.profile.telegramLinked ? `От бота @${BOT}` : 'Telegram не привязан'}
              value={w.prefs.telegram && w.profile.telegramLinked} disabled={!w.profile.telegramLinked}
              onChange={(v) => prefs.mutate({ telegram: v })} />
            <ToggleRow icon="news" color={colors.pink} title="Новости клуба" subtitle="Турниры, события и объявления"
              value={w.prefs.news} onChange={(v) => prefs.mutate({ news: v })} />
          </ListSection>

          <ListSection title="Клуб">
            <ListRow icon="chat" color={colors.telegram} title="Написать в бот клуба" value={`@${BOT}`} external
              onPress={() => void Linking.openURL(`https://t.me/${BOT}`)} />
            <ListRow icon="document" color={colors.textSecondary} title="Политика конфиденциальности" external
              onPress={() => void WebBrowser.openBrowserAsync(`${API_URL}/privacy`, { toolbarColor: colors.background, controlsColor: colors.violetLight })} />
          </ListSection>

          <GlassButton title={demo ? 'Выйти из демо' : 'Выйти'} variant="danger" icon="logout" onPress={confirmLogout} style={styles.logout} />
          <Text style={styles.version}>My Titan {Constants.expoConfig?.version ?? ''}</Text>
        </>
      )}
    </TabScroll>
  );
}

const styles = StyleSheet.create({
  skeletons: { gap: space.lg },
  hero: { alignItems: 'center', paddingTop: space.sm },
  photoEdit: {
    position: 'absolute', right: -2, bottom: -2, width: 32, height: 32, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
  },
  photoEditFallback: { backgroundColor: colors.violet, borderWidth: 2, borderColor: colors.background },
  name: { ...StyleSheet.flatten(type.title), marginTop: space.md, textAlign: 'center' },
  fullName: { ...StyleSheet.flatten(type.callout), color: colors.textSecondary, marginTop: 2 },
  badges: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.sm },
  editText: { color: colors.lavender, fontSize: 16, fontWeight: '600' },
  demo: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.xl, padding: space.md, borderRadius: radius.row },
  demoText: { ...StyleSheet.flatten(type.callout), color: colors.amber, flex: 1 },
  logout: { marginTop: space.xxl + space.xs },
  version: { color: colors.textMuted, fontSize: 12, textAlign: 'center', marginTop: space.lg },
});
