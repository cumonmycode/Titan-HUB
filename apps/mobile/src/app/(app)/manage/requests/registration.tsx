import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Card, ContactButtons, InfoRow, ProfileHeader } from '@/components/profile-parts';
import { AppRefreshControl } from '@/components/refresh-control';
import { Text } from '@/components/text';
import { SOURCE_LOOK, sourceKeyOf } from '@/lib/bookings-api';
import { decideRegistration, whenText } from '@/lib/clients-api';
import { normalizePhone } from '@/lib/events-api';
import { plural } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { usePageGutter } from '@/lib/layout';
import { deviceText, invalidateLeads, useLeadRegistration } from '@/lib/leads-api';
import { useSession } from '@/lib/session';
import { colors, space, type } from '@/lib/theme';

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const STATUS: Record<string, { label: string; color: string }> = {
  pending: { label: 'Ждёт подтверждения', color: '#FF9500' },
  approved: { label: 'Подтверждена', color: '#34C759' },
  rejected: { label: 'Отклонена', color: '#FF3B30' },
};
const REQUEST_STATUS: Record<string, string> = { new: 'новая', confirmed: 'подтверждена', cancelled: 'отклонена', done: 'обработана' };

function birthdayText(value: string | null): string | null {
  const m = value ? /^(\d{4})-(\d{2})-(\d{2})/.exec(value) : null;
  return m ? `${m[3]}.${m[2]}.${m[1]}` : value;
}

/**
 * Регистрация из My Titan: откуда (приложение, устройство), когда, что человек указал
 * в анкете, переписка с Tai и его заявки с этого номера. Подтвердить — он становится
 * клиентом (бонусы, оплата в приложении); отклонить — профиль уходит в архив.
 */
export default function RegistrationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const gutter = usePageGutter();
  const query = useLeadRegistration(id);
  const isOwner = useSession((s) => s.user?.role === 'owner');
  const [busy, setBusy] = useState(false);
  const [pulling, setPulling] = useState(false);
  const data = query.data;

  if (!data) {
    return (
      <View style={[styles.screen, styles.center]}>
        {query.isError ? <Text style={[type.body, styles.secondary, styles.centerText]}>{`Не загрузилось. ${errorText(query.error)}`}</Text> : <ActivityIndicator />}
      </View>
    );
  }

  const r = data.registration;
  const status = STATUS[r.status ?? 'pending'] ?? STATUS.pending!;
  const phone = r.phone ? normalizePhone(r.phone) : null;
  const tgUrl = r.tgUsername ? `https://t.me/${r.tgUsername.replace(/^@/, '')}` : null;
  const pending = r.status === 'pending';
  const device = deviceText(r);

  const decide = async (action: 'approve' | 'reject') => {
    haptic.medium();
    setBusy(true);
    try {
      await decideRegistration(r.id, action);
      invalidateLeads();
      haptic.success();
      if (action === 'approve') router.replace({ pathname: '/manage/clients/[clientId]', params: { clientId: r.id } });
      else router.back();
    } catch (error) {
      haptic.error();
      Alert.alert('Решение не сохранилось', errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const reject = () =>
    Alert.alert('Отклонить регистрацию?', `${r.nickname} уйдёт в архив, приложение клиента выйдет на экран входа.`, [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Отклонить', style: 'destructive', onPress: () => void decide('reject') },
    ]);

  const openDialog = () => {
    if (r.chat) router.push({ pathname: '/tai-dialog', params: { tgId: r.chat.tgId } });
  };

  return (
    <View style={styles.screen}>
      <Stack.Title>Регистрация</Stack.Title>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[styles.content, gutter]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <AppRefreshControl
            tintColor={colors.accent}
            refreshing={pulling}
            onRefresh={() => {
              setPulling(true);
              void query.refetch().finally(() => setPulling(false));
            }}
          />
        }>
        <ProfileHeader name={r.nickname} photoUrl={r.photoUrl} title={r.nickname} subtitle={r.fullName} chip={{ text: status.label, color: status.color }} />

        <ContactButtons
          items={[
            { icon: 'phone.fill', label: 'Позвонить', onPress: phone ? () => void Linking.openURL(`tel:+${phone}`) : undefined },
            r.chat
              ? { icon: 'sparkles', label: 'Диалог с Tai', onPress: openDialog }
              : { icon: 'paperplane.fill', label: 'Telegram', onPress: tgUrl ? () => void Linking.openURL(tgUrl) : undefined },
            { icon: 'message.fill', label: 'WhatsApp', onPress: phone ? () => void Linking.openURL(`https://wa.me/${phone}`) : undefined },
          ]}
        />

        <Card title="Откуда" footer="Номер телефона подтверждён в Telegram-боте клуба — это его собственный номер.">
          <InfoRow icon="iphone" iconColor="#007AFF" label="Сам в приложении My Titan" />
          {device ? <InfoRow label="Устройство" value={device} /> : null}
          <InfoRow label="Когда" value={r.createdAt ? whenText(r.createdAt) : '—'} />
        </Card>

        <Card title="Анкета">
          <InfoRow label="Ник" value={r.nickname} />
          <InfoRow label="Имя" value={r.fullName ?? 'не указано'} muted={!r.fullName} />
          <InfoRow label="Телефон" value={r.phone ?? 'не указан'} muted={!r.phone} onPress={phone ? () => void Linking.openURL(`tel:+${phone}`) : undefined} />
          <InfoRow label="День рождения" value={birthdayText(r.birthday) ?? 'не указан'} muted={!r.birthday} />
          <InfoRow label="Telegram" value={r.tgUsername ? `@${r.tgUsername.replace(/^@/, '')}` : 'привязан'} onPress={tgUrl ? () => void Linking.openURL(tgUrl) : undefined} />
        </Card>

        <Card title="Переписка с Tai" footer={r.chat ? undefined : 'В личку боту клуба он пока не писал — только подтвердил номер.'}>
          {r.chat ? (
            <InfoRow
              icon="sparkles"
              iconColor="#8B5CF6"
              label={r.chat.needsAttention ? 'Ждёт ответа' : r.chat.aiPaused ? 'Диалог ведёт сотрудник' : 'Общается с Tai'}
              value={`${r.chat.messages} ${plural(r.chat.messages, ['сообщение', 'сообщения', 'сообщений'])}`}
              chevron
              onPress={openDialog}
            />
          ) : (
            <InfoRow label="Переписки нет" muted />
          )}
        </Card>

        {data.requests.length > 0 ? (
          <Card title="Заявки с этого номера">
            {data.requests.map((req) => {
              const look = SOURCE_LOOK[sourceKeyOf(req.source)];
              return (
                <InfoRow
                  key={req.id}
                  icon={look.icon}
                  iconColor={look.color}
                  label={req.title ?? 'Заявка'}
                  value={[REQUEST_STATUS[req.status] ?? req.status, req.createdAt ? whenText(req.createdAt) : null].filter(Boolean).join(' · ')}
                  chevron
                  onPress={() => router.push({ pathname: '/manage/requests/booking', params: { bookingId: req.id } })}
                />
              );
            })}
          </Card>
        ) : null}

        <Card>
          <InfoRow icon="pencil" iconColor="#8E8E93" label="Изменить анкету" chevron onPress={() => router.push({ pathname: '/manage/clients/edit', params: { clientId: r.id } })} />
          {isOwner ? (
            <InfoRow icon="bubble.left.and.bubble.right" iconColor="#2AABEE" label="Чаты Telegram" chevron onPress={() => router.push({ pathname: '/manage/clients/chats', params: { clientId: r.id } })} />
          ) : null}
        </Card>

        {pending ? (
          <View style={styles.buttons}>
            <Pressable disabled={busy} onPress={reject} style={({ pressed }) => [styles.button, styles.reject, pressed && styles.pressed]} accessibilityRole="button">
              <Text style={[type.headline, styles.rejectText]}>Отклонить</Text>
            </Pressable>
            <Pressable
              disabled={busy}
              onPress={() => void decide('approve')}
              style={({ pressed }) => [styles.button, styles.confirm, pressed && styles.pressed]}
              accessibilityRole="button">
              {busy ? <ActivityIndicator color="white" /> : <SymbolView name="checkmark" size={14} weight="bold" tintColor="white" />}
              <Text style={[type.headline, styles.confirmText]}>Подтвердить</Text>
            </Pressable>
          </View>
        ) : null}
        {pending ? <Text style={[type.footnote, styles.secondary, styles.note]}>До подтверждения клиенту не начисляются бонусы и закрыта оплата в приложении.</Text> : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.groupedBackground },
  center: { alignItems: 'center', justifyContent: 'center', padding: space.xl },
  centerText: { textAlign: 'center' },
  content: { gap: space.xl, paddingTop: space.sm, paddingBottom: space.xxxl },
  secondary: { color: colors.secondaryLabel },
  note: { paddingHorizontal: space.lg, marginTop: -space.md },
  buttons: { flexDirection: 'row', gap: space.md },
  button: { flex: 1, minHeight: 48, borderRadius: 14, borderCurve: 'continuous', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  reject: { backgroundColor: colors.fill },
  rejectText: { color: colors.red },
  confirm: { backgroundColor: colors.accent },
  confirmText: { color: 'white' },
  pressed: { opacity: 0.7 },
});
