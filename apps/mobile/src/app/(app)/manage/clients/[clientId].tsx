import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ClientMoveRow } from '@/components/client-moves';
import { Card, ContactButtons, InfoRow, ProfileHeader, StatTile } from '@/components/profile-parts';
import { AppRefreshControl } from '@/components/refresh-control';
import { Text } from '@/components/text';
import { ToolbarButton, ToolbarMenu, ToolbarMenuAction } from '@/components/toolbar';
import {
  adjustVisits,
  archiveClient,
  clientPhoto,
  gomafiaIdOf,
  purgeClient,
  restoreClient,
  tierLook,
  useClient,
  useClientTiers,
  useClientTransactions,
  userTags,
  useVisitProgress,
} from '@/lib/clients-api';
import { normalizePhone } from '@/lib/events-api';
import { formatMoney, plural, toNumber } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { usePageGutter } from '@/lib/layout';
import { useSession } from '@/lib/session';
import { colors, space, type } from '@/lib/theme';

const RECENT = 5;
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const birthdayFormat = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: 'UTC' });

function birthdayText(value: string | null): string | null {
  if (!value) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? birthdayFormat.format(new Date(`${value}T12:00:00Z`)) : value;
}

/**
 * Карточка клиента, как в «Контактах» iOS: шапка с фото и статусом, связь в один тап,
 * плитки «Депозит/Долг» и «Бонусы» (единственное место операций — открывают шторку),
 * прогресс до резидента, контакты и последние движения. Профиль правится по «Изменить».
 */
export default function ClientScreen() {
  const { clientId } = useLocalSearchParams<{ clientId: string }>();
  const router = useRouter();
  const gutter = usePageGutter();
  const client = useClient(clientId);
  const tiers = useClientTiers();
  const isOwner = useSession((s) => s.user?.role === 'owner');
  const data = client.data;
  const visits = useVisitProgress(clientId, data?.clientTier === 'newbie' && !data?.deletedAt);
  const history = useClientTransactions(clientId);
  const [visitBusy, setVisitBusy] = useState(false);
  const [pulling, setPulling] = useState(false);

  if (!data) {
    return (
      <View style={[styles.screen, styles.center]}>
        {client.isError ? <Text style={[type.body, styles.secondary, styles.centerText]}>{`Клиент не загрузился. ${errorText(client.error)}`}</Text> : <ActivityIndicator />}
      </View>
    );
  }

  const tier = tierLook(data.clientTier, tiers.data);
  const balance = toNumber(data.balance);
  const bonus = Math.floor(toNumber(data.bonusPoints));
  const archived = !!data.deletedAt;
  const phone = data.phone ? normalizePhone(data.phone) : null;
  const gomafiaId = gomafiaIdOf(data);
  const tags = userTags(data);
  const debt = balance < -0.004;
  const deposit = balance > 0.004;
  const telegramUrl = data.tgUsername ? `https://t.me/${data.tgUsername.replace(/^@/, '')}` : phone ? `tg://resolve?phone=${phone}` : null;
  const moves = history.data ?? [];

  const open = (url: string) => void Linking.openURL(url);
  const openAdjust = (mode: 'balance' | 'bonus') =>
    router.push({ pathname: '/manage/clients/adjust', params: { clientId, mode, op: mode === 'bonus' ? 'plus' : debt ? 'debt_repay' : 'deposit_add' } });

  const refresh = async () => {
    setPulling(true);
    await Promise.allSettled([client.refetch(), history.refetch(), visits.refetch()]);
    setPulling(false);
  };

  const archive = () =>
    Alert.alert('Отправить в архив?', `${data.nickname} скроется из списков. Вернуть можно в разделе «Архив».`, [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'В архив',
        style: 'destructive',
        onPress: () =>
          archiveClient(data, isOwner)
            .then(() => haptic.success())
            .catch((error: unknown) => {
              haptic.error();
              Alert.alert('Клиент не в архиве', errorText(error));
            }),
      },
    ]);

  const restore = () =>
    restoreClient(data.id)
      .then(() => haptic.success())
      .catch((error: unknown) => {
        haptic.error();
        Alert.alert('Клиент не восстановлен', errorText(error));
      });

  const purge = () =>
    Alert.alert('Удалить навсегда?', `Данные ${data.nickname} будут обезличены без возможности восстановления. История чеков клуба сохранится.`, [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Удалить',
        style: 'destructive',
        onPress: () =>
          purgeClient(data.id)
            .then(() => {
              haptic.success();
              router.back();
            })
            .catch((error: unknown) => {
              haptic.error();
              Alert.alert('Клиент не удалён', errorText(error));
            }),
      },
    ]);

  const changeVisits = async (delta: 1 | -1) => {
    haptic.selection();
    setVisitBusy(true);
    try {
      const result = await adjustVisits(data.id, delta);
      if (result.promoted) {
        haptic.success();
        Alert.alert('Клиент стал резидентом 🎉', `${data.nickname} набрал ${result.threshold} посещений.`);
      }
    } catch (error) {
      haptic.error();
      Alert.alert('Посещение не изменено', errorText(error));
    } finally {
      setVisitBusy(false);
    }
  };

  return (
    <View style={styles.screen}>
      <Stack.Title>{data.nickname}</Stack.Title>
      <Stack.Toolbar placement="right">
        {!archived ? <ToolbarButton onPress={() => router.push({ pathname: '/manage/clients/edit', params: { clientId: data.id } })}>Изменить</ToolbarButton> : null}
        <ToolbarMenu icon="ellipsis" accessibilityLabel="Ещё">
          {!archived && (
            <ToolbarMenuAction icon="archivebox" destructive onPress={archive}>
              В архив
            </ToolbarMenuAction>
          )}
          {archived && (
            <ToolbarMenuAction icon="arrow.uturn.backward" onPress={() => void restore()}>
              Вернуть из архива
            </ToolbarMenuAction>
          )}
          {archived && isOwner && (
            <ToolbarMenuAction icon="trash" destructive onPress={purge}>
              Удалить навсегда
            </ToolbarMenuAction>
          )}
        </ToolbarMenu>
      </Stack.Toolbar>

      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[styles.content, gutter]}
        showsVerticalScrollIndicator={false}
        refreshControl={<AppRefreshControl tintColor={colors.accent} refreshing={pulling} onRefresh={() => void refresh()} />}
      >
        <ProfileHeader
          name={data.nickname}
          photoUrl={clientPhoto(data)}
          title={data.nickname}
          subtitle={data.fullName}
          chip={archived ? { text: `${tier.label} · в архиве`, color: '#8E8E93' } : { text: tier.label, color: tier.color }}
        />

        <ContactButtons
          items={[
            { icon: 'phone.fill', label: 'Позвонить', onPress: phone ? () => open(`tel:+${phone}`) : undefined },
            { icon: 'paperplane.fill', label: 'Telegram', onPress: telegramUrl ? () => open(telegramUrl) : undefined },
            { icon: 'message.fill', label: 'WhatsApp', onPress: phone ? () => open(`https://wa.me/${phone}`) : undefined },
          ]}
        />

        {data.appDeletedAt ? (
          <Card footer="Карточка клиента не изменилась. Войти в приложение снова можно через сутки после удаления.">
            <InfoRow
              icon="person.crop.circle.badge.xmark"
              iconColor="#FF3B30"
              label="Удалил аккаунт My Titan"
              value={new Date(data.appDeletedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}
            />
          </Card>
        ) : null}

        <View style={styles.tiles}>
          <StatTile
            label={debt ? 'Долг' : deposit ? 'Депозит' : 'Баланс'}
            value={formatMoney(Math.abs(balance), { kopecks: 'auto' })}
            color={debt ? '#F43F5E' : deposit ? '#06B6D4' : colors.secondaryLabel}
            hint={archived ? undefined : debt ? 'Погасить или дать в долг' : 'Пополнить или списать'}
            onPress={archived ? undefined : () => openAdjust('balance')}
          />
          <StatTile label="Бонусы" value={`★ ${bonus}`} color="#FF9500" hint={archived ? undefined : 'Начислить или списать'} onPress={archived ? undefined : () => openAdjust('bonus')} />
        </View>

        {visits.data && visits.data.tier === 'newbie' ? <VisitsCard progress={visits.data} busy={visitBusy} onChange={(delta) => void changeVisits(delta)} /> : null}

        {data.role === 'staff' || data.role === 'owner' ? (
          <Card footer="Роль, права, формула зарплаты и вход в HUB — в карточке сотрудника.">
            <InfoRow
              icon={data.role === 'owner' ? 'crown.fill' : 'person.badge.key.fill'}
              iconColor={data.role === 'owner' ? '#FF9500' : '#5856D6'}
              label={data.role === 'owner' ? 'Владелец клуба' : 'В команде клуба'}
              chevron={isOwner}
              onPress={isOwner ? () => router.push({ pathname: '/manage/staff/[staffId]', params: { staffId: data.id } }) : undefined}
            />
          </Card>
        ) : null}

        <Card title="Контакты" footer={`В клубе с ${new Date(data.createdAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}`}>
          <InfoRow label="Телефон" value={data.phone || 'не указан'} muted={!data.phone} onPress={phone ? () => open(`tel:+${phone}`) : undefined} />
          <InfoRow
            label="Telegram"
            value={data.tgUsername ? `@${data.tgUsername.replace(/^@/, '')}` : data.tgId ? 'привязан' : 'не привязан'}
            muted={!data.tgId && !data.tgUsername}
            onPress={data.tgUsername && telegramUrl ? () => open(telegramUrl) : undefined}
          />
          <InfoRow label="День рождения" value={birthdayText(data.birthday) ?? 'не указан'} muted={!data.birthday} />
          {tags.length > 0 ? <InfoRow label="Теги" value={tags.join(', ')} /> : null}
          {gomafiaId ? <InfoRow label="GoMafia" value={`#${gomafiaId}`} onPress={() => open(`https://gomafia.pro/stats/${gomafiaId}`)} /> : null}
        </Card>

        <Card title="Последние операции">
          {history.isLoading ? (
            <View style={styles.loading}>
              <ActivityIndicator />
            </View>
          ) : moves.length === 0 ? (
            <InfoRow label="Движений пока не было" muted />
          ) : (
            moves.slice(0, RECENT).map((tx) => (
              <ClientMoveRow key={tx.id} tx={tx} onPress={tx.checkId ? () => router.push({ pathname: '/pos/[checkId]', params: { checkId: tx.checkId! } }) : undefined} />
            ))
          )}
          {moves.length > RECENT ? <InfoRow label="Вся история" chevron onPress={() => router.push({ pathname: '/manage/clients/history', params: { clientId } })} /> : null}
        </Card>
      </ScrollView>
    </View>
  );
}

/** Новичок → Резидент: полоса прогресса и ручная правка посещений. */
function VisitsCard({ progress, busy, onChange }: { progress: { visits: number; threshold: number; remaining: number }; busy: boolean; onChange: (delta: 1 | -1) => void }) {
  const share = progress.threshold > 0 ? Math.min(1, progress.visits / progress.threshold) : 0;
  return (
    <Card
      title="До резидента"
      footer={
        progress.remaining > 0
          ? `Ещё ${progress.remaining} ${plural(progress.remaining, ['посещение', 'посещения', 'посещений'])} — и статус станет «Резидент».`
          : 'Порог достигнут — статус повысится при следующем посещении.'
      }
    >
      <View style={styles.visits}>
        <View style={styles.flex}>
          <Text style={[type.headline, styles.label]}>{`${progress.visits} из ${progress.threshold} посещений`}</Text>
          <View style={styles.bar}>
            <View style={[styles.fill, { width: `${Math.round(share * 100)}%` }]} />
          </View>
        </View>
        <Step icon="minus" label="Убрать посещение" disabled={busy || progress.visits <= 0} onPress={() => onChange(-1)} />
        <Step icon="plus" label="Добавить посещение" disabled={busy} onPress={() => onChange(1)} />
      </View>
    </Card>
  );
}

function Step({ icon, label, disabled, onPress }: { icon: 'plus' | 'minus'; label: string; disabled: boolean; onPress: () => void }) {
  return (
    <Pressable disabled={disabled} onPress={onPress} hitSlop={6} style={({ pressed }) => [styles.step, (pressed || disabled) && styles.dim]} accessibilityRole="button" accessibilityLabel={label}>
      <SymbolView name={icon} size={15} weight="bold" tintColor={colors.accent} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.groupedBackground },
  center: { alignItems: 'center', justifyContent: 'center', padding: space.xl },
  centerText: { textAlign: 'center' },
  content: { gap: space.xl, paddingTop: space.sm, paddingBottom: space.xxxl },
  tiles: { flexDirection: 'row', gap: space.md },
  flex: { flex: 1, minWidth: 0, gap: space.sm },
  label: { color: colors.label },
  secondary: { color: colors.secondaryLabel },
  loading: { padding: space.lg },
  visits: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg },
  bar: { height: 6, borderRadius: 3, backgroundColor: colors.fill, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3, backgroundColor: colors.accent },
  step: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.fill },
  dim: { opacity: 0.4 },
});
