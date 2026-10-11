import { Button, ContentUnavailableView, Form, HStack, Host, Image, LabeledContent, Picker, ProgressView, RNHostView, Section, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import {
  background,
  buttonStyle,
  contentTransition,
  controlSize,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  monospacedDigit,
  pickerStyle,
  refreshable,
  shapes,
  tag,
} from '@expo/ui/swift-ui/modifiers';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Linking, View } from 'react-native';

import { LinkRow, primary, secondary } from '@/components/native-form';
import { Avatar } from '@/components/new-check-parts';
import { ToolbarMenu, ToolbarMenuAction } from '@/components/toolbar';
import {
  adjustVisits,
  archiveClient,
  BALANCE_OPS,
  clientPhoto,
  gomafiaIdOf,
  purgeClient,
  restoreClient,
  tierLook,
  transactionLook,
  updateClient,
  useClient,
  useClientTiers,
  useClientTransactions,
  userTags,
  useVisitProgress,
  whenText,
  type BalanceOp,
} from '@/lib/clients-api';
import { normalizePhone } from '@/lib/events-api';
import { formatMoney, plural, toNumber } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { pickAndUploadPhoto } from '@/lib/photo';
import { useSession } from '@/lib/session';
import { colors } from '@/lib/theme';

type Tab = 'main' | 'history';

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const birthdayFormat = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: 'UTC' });

function birthdayText(value: string | null): string | null {
  if (!value) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? birthdayFormat.format(new Date(`${value}T12:00:00Z`)) : value;
}

/**
 * Карточка клиента: фото, статус, депозит или долг и бонусы; связь в один тап; операции
 * с балансом и бонусами — шторками; прогресс «Новичок → Резидент»; контакты; вкладка
 * «История» — движения денег и посещений.
 */
export default function ClientScreen() {
  const { clientId } = useLocalSearchParams<{ clientId: string }>();
  const router = useRouter();
  const client = useClient(clientId);
  const tiers = useClientTiers();
  const isOwner = useSession((s) => s.user?.role === 'owner');
  const [tab, setTab] = useState<Tab>('main');
  const data = client.data;
  const visits = useVisitProgress(clientId, data?.clientTier === 'newbie' && !data?.deletedAt);
  const history = useClientTransactions(clientId);
  const [visitBusy, setVisitBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);

  if (!data) {
    return (
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        {client.isError ? <ContentUnavailableView title="Клиент не загрузился" systemImage="wifi.exclamationmark" description={errorText(client.error)} /> : <ProgressView />}
      </Host>
    );
  }

  const tier = tierLook(data.clientTier, tiers.data);
  const balance = toNumber(data.balance);
  const bonus = Math.floor(toNumber(data.bonusPoints));
  const archived = !!data.deletedAt;
  const phone = data.phone ? normalizePhone(data.phone) : null;
  const gomafiaId = gomafiaIdOf(data);
  const tags = userTags(data);
  const balanceColor = balance > 0.004 ? '#06B6D4' : balance < -0.004 ? '#F43F5E' : '#8E8E93';

  const openBalance = (op: BalanceOp) => {
    haptic.light();
    router.push({ pathname: '/manage/clients/adjust', params: { clientId, mode: 'balance', op } });
  };
  const openBonus = (sign: 'plus' | 'minus') => {
    haptic.light();
    router.push({ pathname: '/manage/clients/adjust', params: { clientId, mode: 'bonus', op: sign } });
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

  const savePhoto = (photoUrl: string | null) =>
    updateClient(data.id, { photoUrl })
      .then(() => haptic.success())
      .catch((error: unknown) => Alert.alert('Фото не сохранилось', errorText(error)));
  const changePhoto = () => pickAndUploadPhoto('Фото клиента', (photoUrl) => void savePhoto(photoUrl), setPhotoBusy);
  const removePhoto = () =>
    Alert.alert('Убрать фото?', 'Останется фото из Telegram или GoMafia, если оно есть.', [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Убрать', style: 'destructive', onPress: () => void savePhoto(null) },
    ]);

  const open = (url: string) => {
    haptic.light();
    void Linking.openURL(url);
  };
  const telegramUrl = data.tgUsername ? `https://t.me/${data.tgUsername.replace(/^@/, '')}` : phone ? `tg://resolve?phone=${phone}` : null;

  return (
    <>
      <Stack.Title>{data.nickname}</Stack.Title>
      <Stack.Toolbar placement="right">
        <ToolbarMenu icon="ellipsis" accessibilityLabel="Действия с клиентом">
          {!archived && (
            <ToolbarMenuAction icon="pencil" onPress={() => router.push({ pathname: '/manage/clients/edit', params: { clientId: data.id } })}>
              Изменить
            </ToolbarMenuAction>
          )}
          {!archived && (
            <ToolbarMenuAction icon="camera" onPress={changePhoto}>
              {data.photoUrl ? 'Сменить фото' : 'Добавить фото'}
            </ToolbarMenuAction>
          )}
          {!archived && data.photoUrl && (
            <ToolbarMenuAction icon="trash" onPress={removePhoto}>
              Убрать фото
            </ToolbarMenuAction>
          )}
          {!archived && (
            <ToolbarMenuAction icon="paperplane" onPress={() => router.push({ pathname: '/manage/clients/telegram', params: { clientId: data.id } })}>
              Привязать Telegram
            </ToolbarMenuAction>
          )}
          {!archived && (
            <ToolbarMenuAction icon="archivebox" destructive onPress={archive}>
              В архив
            </ToolbarMenuAction>
          )}
          {archived && (
            <ToolbarMenuAction icon="arrow.uturn.backward" onPress={() => void restore()}>
              Восстановить из архива
            </ToolbarMenuAction>
          )}
          {archived && isOwner && (
            <ToolbarMenuAction icon="trash" destructive onPress={purge}>
              Удалить навсегда
            </ToolbarMenuAction>
          )}
        </ToolbarMenu>
      </Stack.Toolbar>

      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <Form modifiers={[refreshable(async () => void (await Promise.allSettled([client.refetch(), history.refetch(), visits.refetch()])))]}>
          <Section>
            <HStack spacing={14}>
              <Button onPress={archived ? undefined : changePhoto} modifiers={[buttonStyle('borderless')]}>
                <RNHostView matchContents>
                  <View>
                    <Avatar name={data.nickname} photoUrl={clientPhoto(data)} size={68} />
                    {photoBusy && <ActivityIndicator style={{ position: 'absolute', top: 24, left: 24 }} />}
                  </View>
                </RNHostView>
              </Button>
              <VStack alignment="leading" spacing={2}>
                <Text modifiers={[font({ textStyle: 'title2', weight: 'bold' }), primary, lineLimit(2)]}>{data.nickname}</Text>
                {data.fullName ? <Text modifiers={[secondary, lineLimit(1)]}>{data.fullName}</Text> : null}
                <Text modifiers={[font({ textStyle: 'subheadline', weight: 'semibold' }), foregroundStyle(archived ? '#8E8E93' : tier.color)]}>
                  {archived ? `${tier.label} · в архиве` : tier.label}
                </Text>
              </VStack>
            </HStack>
            <HStack spacing={12}>
              <Button onPress={archived ? undefined : () => openBalance(balance < -0.004 ? 'debt_repay' : 'deposit_add')} modifiers={[buttonStyle('borderless'), frame({ maxWidth: 10_000 })]}>
                <VStack alignment="leading" spacing={2} modifiers={[frame({ maxWidth: 10_000, alignment: 'leading' })]}>
                  <Text modifiers={[font({ textStyle: 'caption', weight: 'semibold' }), foregroundStyle(balanceColor)]}>{balance > 0.004 ? 'Депозит' : balance < -0.004 ? 'Долг' : 'Баланс'}</Text>
                  <Text modifiers={[font({ textStyle: 'title2', weight: 'semibold', design: 'rounded' }), primary, monospacedDigit(), contentTransition('numericText')]}>
                    {formatMoney(Math.abs(balance), { kopecks: 'auto' })}
                  </Text>
                </VStack>
              </Button>
              <Button onPress={archived ? undefined : () => openBonus('plus')} modifiers={[buttonStyle('borderless'), frame({ maxWidth: 10_000 })]}>
                <VStack alignment="leading" spacing={2} modifiers={[frame({ maxWidth: 10_000, alignment: 'leading' })]}>
                  <Text modifiers={[font({ textStyle: 'caption', weight: 'semibold' }), foregroundStyle('#FF9500')]}>Бонусы</Text>
                  <Text modifiers={[font({ textStyle: 'title2', weight: 'semibold', design: 'rounded' }), primary, monospacedDigit(), contentTransition('numericText')]}>{`★ ${bonus}`}</Text>
                </VStack>
              </Button>
            </HStack>
            <HStack spacing={8}>
              <Contact icon="phone.fill" label="позвонить" onPress={phone ? () => open(`tel:+${phone}`) : undefined} />
              <Contact icon="paperplane.fill" label="Telegram" onPress={telegramUrl ? () => open(telegramUrl) : undefined} />
              <Contact icon="message.fill" label="WhatsApp" onPress={phone ? () => open(`https://wa.me/${phone}`) : undefined} />
            </HStack>
          </Section>

          {data.appDeletedAt ? (
            <Section footer={<Text>Карточка клиента не изменилась. Войти в приложение снова можно через сутки после удаления.</Text>}>
              <LinkRow
                icon="person.crop.circle.badge.xmark"
                color="#FF3B30"
                title="Удалил аккаунт My Titan"
                value={new Date(data.appDeletedAt).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}
                chevron={false}
              />
            </Section>
          ) : null}

          <Section>
            <Picker
              selection={tab}
              onSelectionChange={(value) => {
                haptic.selection();
                setTab(value as Tab);
              }}
              modifiers={[pickerStyle('segmented')]}>
              <Text modifiers={[tag('main')]}>Основное</Text>
              <Text modifiers={[tag('history')]}>История</Text>
            </Picker>
          </Section>

          {tab === 'main' ? (
            <>
              {!archived && (
                <Section title="Депозит и долг">
                  {(['deposit_add', 'deposit_sub', 'debt_repay', 'debt_lend'] as const).map((op) => {
                    const look = BALANCE_OPS[op];
                    const disabled = (op === 'deposit_sub' && balance <= 0.004) || (op === 'debt_repay' && balance >= -0.004);
                    return <LinkRow key={op} icon={look.symbol} color={disabled ? '#8E8E93' : look.color} title={look.title} onPress={disabled ? undefined : () => openBalance(op)} />;
                  })}
                </Section>
              )}

              {!archived && (
                <Section title="Бонусы">
                  <LinkRow icon="star.circle.fill" color="#FF9500" title="Начислить бонусы" onPress={() => openBonus('plus')} />
                  <LinkRow icon="minus.circle.fill" color={bonus > 0 ? '#8E8E93' : '#C7C7CC'} title="Списать бонусы" onPress={bonus > 0 ? () => openBonus('minus') : undefined} />
                </Section>
              )}

              {visits.data && visits.data.tier === 'newbie' && (
                <Section
                  title="Новичок → Резидент"
                  footer={
                    <Text>
                      {visits.data.remaining > 0
                        ? `Ещё ${visits.data.remaining} ${plural(visits.data.remaining, ['посещение', 'посещения', 'посещений'])} до статуса «Резидент».`
                        : 'Порог достигнут — статус повысится при следующем посещении.'}
                    </Text>
                  }>
                  <HStack spacing={10}>
                    <Text modifiers={[primary, monospacedDigit(), contentTransition('numericText')]}>{`Посещений: ${visits.data.visits} из ${visits.data.threshold}`}</Text>
                    <Spacer />
                    <Button systemImage="minus" onPress={visitBusy || visits.data.visits <= 0 ? undefined : () => void changeVisits(-1)} modifiers={[buttonStyle('bordered'), controlSize('small')]} />
                    <Button systemImage="plus" onPress={visitBusy ? undefined : () => void changeVisits(1)} modifiers={[buttonStyle('bordered'), controlSize('small')]} />
                  </HStack>
                </Section>
              )}

              <Section title="Контакты" footer={<Text>{`В клубе с ${new Date(data.createdAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}`}</Text>}>
                <Info label="Телефон" value={data.phone || 'не указан'} muted={!data.phone} />
                <Info label="Telegram" value={data.tgUsername ? `@${data.tgUsername.replace(/^@/, '')}` : data.tgId ? `id ${data.tgId}` : 'не привязан'} muted={!data.tgId && !data.tgUsername} />
                <Info label="День рождения" value={birthdayText(data.birthday) ?? 'не указан'} muted={!data.birthday} />
                {tags.length > 0 && <Info label="Теги" value={tags.join(', ')} />}
                {gomafiaId && <LinkRow icon="link" color="#5856D6" title="GoMafia" value={`#${gomafiaId}`} onPress={() => open(`https://gomafia.pro/stats/${gomafiaId}`)} />}
              </Section>
            </>
          ) : (
            <Section title="История" footer={history.data?.length ? <Text>Показаны последние 50 движений. Нажмите на движение с чеком, чтобы открыть чек.</Text> : undefined}>
              {history.isLoading ? (
                <ProgressView />
              ) : history.isError ? (
                <Text modifiers={[secondary]}>{errorText(history.error)}</Text>
              ) : !history.data?.length ? (
                <ContentUnavailableView title="Движений пока не было" systemImage="clock.arrow.circlepath" />
              ) : (
                history.data.map((tx) => {
                  const look = transactionLook(tx);
                  const amount = toNumber(tx.amount);
                  const color = look.sign > 0 ? colors.green : look.sign < 0 ? colors.red : undefined;
                  const amountText =
                    tx.type === 'visit_adjust'
                      ? `${amount > 0 ? '+' : ''}${amount} ${plural(Math.abs(amount), ['посещение', 'посещения', 'посещений'])}`
                      : formatMoney(look.sign < 0 ? -amount : amount, { sign: look.sign > 0, kopecks: 'auto' });
                  return (
                    <LinkRow
                      key={tx.id}
                      icon={look.symbol}
                      color={look.sign > 0 ? '#34C759' : look.sign < 0 ? '#FF3B30' : '#8E8E93'}
                      title={look.title}
                      subtitle={whenText(tx.createdAt)}
                      value={amountText}
                      valueColor={color}
                      onPress={tx.checkId ? () => router.push({ pathname: '/pos/[checkId]', params: { checkId: tx.checkId! } }) : undefined}
                    />
                  );
                })
              )}
            </Section>
          )}
        </Form>
      </Host>
    </>
  );
}

/** Кнопка связи как в «Контактах» iOS: значок над подписью, недоступная — приглушена. */
function Contact({ icon, label, onPress }: { icon: 'phone.fill' | 'paperplane.fill' | 'message.fill'; label: string; onPress?: () => void }) {
  const tint = onPress ? colors.accent : colors.tertiaryLabel;
  return (
    <Button onPress={onPress} modifiers={[buttonStyle('borderless'), frame({ maxWidth: 10_000 })]}>
      <VStack spacing={4} modifiers={[frame({ maxWidth: 10_000, minHeight: 54 }), background(colors.fill, shapes.roundedRectangle({ cornerRadius: 12 }))]}>
        <Image systemName={icon} size={17} color={tint} />
        <Text modifiers={[font({ textStyle: 'caption2', weight: 'medium' }), foregroundStyle(tint), lineLimit(1)]}>{label}</Text>
      </VStack>
    </Button>
  );
}

function Info({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <LabeledContent label={label}>
      <Text modifiers={[muted ? foregroundStyle(colors.tertiaryLabel) : secondary, lineLimit(2)]}>{value}</Text>
    </LabeledContent>
  );
}
