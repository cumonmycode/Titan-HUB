// «Профиль»: фото, личные данные, настройки уведомлений, правила бонусов, выход.
import { useQueryClient } from '@tanstack/react-query';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { type ReactNode, useState } from 'react';
import { ActivityIndicator, Alert, Linking, StyleSheet, Switch, Text, View } from 'react-native';

import { Screen, ScreenHeader } from '@/components/screen';
import { Avatar, Button, Divider, Icon, IconBubble, type IconName, Skeleton, Tap, TierBadge } from '@/components/ui';
import { api, API_URL, errorText } from '@/lib/api';
import { longDate } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { photoFile, pickSquarePhoto } from '@/lib/photo';
import { pushPermission, registerForPush, unregisterPush } from '@/lib/push';
import { keys, useUpdatePrefs, useWallet } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { colors, space, type } from '@/lib/theme';
import type { Prefs, Wallet } from '@/lib/types';

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

  return (
    <Screen onRefresh={() => wallet.refetch()} header={<ScreenHeader title="Профиль" />}>
      {!w ? (
        <View style={{ gap: space.lg }}><Skeleton height={120} /><Skeleton height={180} /><Skeleton height={160} /></View>
      ) : (
        <>
          <View style={styles.hero}>
            <Tap onPress={changePhoto} scaleTo={0.95} accessibilityRole="button" accessibilityLabel="Сменить фото">
              <Avatar uri={w.profile.photoUrl} name={w.profile.nickname} size={88} ring />
              <View style={styles.photoEdit}>
                {uploading ? <ActivityIndicator size="small" color="#fff" /> : <Icon name="camera" size={15} color="#fff" />}
              </View>
            </Tap>
            <View style={{ flex: 1, gap: 6 }}>
              <Text style={type.heading} numberOfLines={1}>{w.profile.nickname}</Text>
              {w.profile.fullName ? <Text style={type.callout} numberOfLines={1}>{w.profile.fullName}</Text> : null}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                <TierBadge label={w.tier.label} color={w.tier.color} />
                <Text style={type.caption}>с {longDate(w.profile.memberSince)}</Text>
              </View>
            </View>
          </View>

          {demo ? (
            <View style={styles.demo}>
              <Icon name="flask" size={18} color={colors.amber} />
              <Text style={[type.callout, { color: colors.amber, flex: 1 }]}>Демо-режим: данные ненастоящие, оплата проходит понарошку.</Text>
            </View>
          ) : null}

          <Group title="Личные данные">
            <Row icon="person" color={colors.violetLight} title="Имя и никнейм" value={w.profile.fullName || w.profile.nickname} onPress={() => router.push('/profile-edit')} />
            <Row icon="call" color={colors.green} title="Телефон" value={w.profile.phone || 'Не указан'} onPress={() => router.push('/profile-edit')} />
            <Row icon="gift" color={colors.pink} title="День рождения" value={w.profile.birthday ? longDate(w.profile.birthday) : 'Не указан'} onPress={() => router.push('/profile-edit')} />
            <Row icon="paper-plane" color={colors.telegram} title="Telegram" value={w.profile.tgUsername ? `@${w.profile.tgUsername}` : w.profile.telegramLinked ? 'Привязан' : 'Не привязан'} />
          </Group>

          <NotificationPrefs prefs={w.prefs} wallet={w} onPush={togglePush} onChange={(p) => prefs.mutate(p)} />

          <Group title="Клуб">
            <Row icon="sparkles" color="#FACC15" title="Бонусная программа" onPress={() => router.push('/bonus-rules')} />
            <Row icon="chatbubbles" color={colors.telegram} title="Написать в бот клуба" value={`@${BOT}`}
              onPress={() => void Linking.openURL(`https://t.me/${BOT}`)} />
            <Row icon="document-text" color={colors.textSecondary} title="Политика конфиденциальности"
              onPress={() => void WebBrowser.openBrowserAsync(`${API_URL}/privacy`, { toolbarColor: colors.background, controlsColor: colors.violetLight })} />
          </Group>

          <Button title={demo ? 'Выйти из демо' : 'Выйти'} variant="danger" icon="log-out-outline" onPress={confirmLogout} style={{ marginTop: space.xxl }} />
          <Text style={styles.version}>My Titan {Constants.expoConfig?.version ?? ''}</Text>
        </>
      )}
    </Screen>
  );
}

function NotificationPrefs({
  prefs, wallet, onPush, onChange,
}: { prefs: Prefs; wallet: Wallet; onPush: (on: boolean) => void; onChange: (p: Partial<Prefs>) => void }) {
  return (
    <Group title="Уведомления">
      <ToggleRow icon="notifications" color={colors.violetLight} title="Push на телефон" text="Бонусы, депозит, долг и оплаты"
        value={prefs.push} onChange={onPush} />
      <ToggleRow icon="paper-plane" color={colors.telegram} title="Сообщения в Telegram" text={wallet.profile.telegramLinked ? `От бота @${BOT}` : 'Telegram не привязан'}
        value={prefs.telegram && wallet.profile.telegramLinked} disabled={!wallet.profile.telegramLinked} onChange={(v) => onChange({ telegram: v })} />
      <ToggleRow icon="megaphone" color={colors.pink} title="Новости клуба" text="Турниры, события и объявления"
        value={prefs.news} onChange={(v) => onChange({ news: v })} />
    </Group>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  const rows = Array.isArray(children) ? children.filter(Boolean) : [children];
  return (
    <View style={{ marginTop: space.xxl }}>
      <Text style={[type.overline, { marginBottom: space.sm, marginLeft: space.xs }]}>{title}</Text>
      <View style={styles.group}>
        {rows.map((row, i) => (
          <View key={i}>
            {i > 0 ? <Divider inset={64} /> : null}
            {row}
          </View>
        ))}
      </View>
    </View>
  );
}

function Row({ icon, color, title, value, onPress }: { icon: IconName; color: string; title: string; value?: string; onPress?: () => void }) {
  const content = (
    <View style={styles.row}>
      <IconBubble name={icon} color={color} size={34} />
      <Text style={[styles.rowTitle, !value && { flex: 1 }]}>{title}</Text>
      {value ? <Text style={styles.rowValue} numberOfLines={1}>{value}</Text> : null}
      {onPress ? <Icon name="chevron-forward" size={16} color={colors.textMuted} /> : null}
    </View>
  );
  return onPress ? <Tap onPress={onPress} scaleTo={0.985} accessibilityRole="button" accessibilityLabel={value ? `${title}: ${value}` : title}>{content}</Tap> : content;
}

function ToggleRow({
  icon, color, title, text, value, onChange, disabled,
}: { icon: IconName; color: string; title: string; text: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <View style={[styles.row, disabled && { opacity: 0.55 }]}>
      <IconBubble name={icon} color={color} size={34} />
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={type.caption}>{text}</Text>
      </View>
      <Switch
        value={value}
        disabled={disabled}
        onValueChange={(v) => { haptic.select(); onChange(v); }}
        trackColor={{ false: 'rgba(255,255,255,0.14)', true: colors.violet }}
        thumbColor="#fff"
        ios_backgroundColor="rgba(255,255,255,0.14)"
        accessibilityLabel={title}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  photoEdit: {
    position: 'absolute', right: -2, bottom: -2, width: 30, height: 30, borderRadius: 15,
    backgroundColor: colors.violet, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: colors.background,
  },
  demo: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.xl, padding: space.md,
    borderRadius: 14, backgroundColor: colors.amberTint, borderWidth: 1, borderColor: 'rgba(251,191,36,0.25)',
  },
  group: { backgroundColor: colors.surface, borderRadius: 18, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md, minHeight: 56 },
  rowTitle: { color: colors.textBody, fontSize: 15, fontWeight: '600', flexShrink: 0 },
  rowValue: { flex: 1, textAlign: 'right', color: colors.textSecondary, fontSize: 14 },
  version: { color: colors.textMuted, fontSize: 12, textAlign: 'center', marginTop: space.lg },
});
