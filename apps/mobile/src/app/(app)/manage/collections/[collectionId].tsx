import { Button, ContentUnavailableView, Form, HStack, Host, LabeledContent, Picker, ProgressView, RNHostView, Section, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import {
  Animation,
  animation,
  buttonStyle,
  contentTransition,
  controlSize,
  font,
  foregroundStyle,
  lineLimit,
  monospacedDigit,
  pickerStyle,
  refreshable,
  tag,
} from '@expo/ui/swift-ui/modifiers';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';

import { LegendRow } from '@/components/analytics/native';
import { primary, SearchRow, secondary } from '@/components/native-form';
import { Avatar } from '@/components/new-check-parts';
import { useDebounced } from '@/components/player-picker';
import { ToolbarMenu, ToolbarMenuAction } from '@/components/toolbar';
import { tierLook, useClientTiers, type ClientTierRow } from '@/lib/clients-api';
import {
  archiveCollection,
  CONTRIBUTION_METHODS,
  currentPeriodKey,
  removeContribution,
  rosterState,
  setPeriodAmount,
  useCollection,
  useCollectionPeriods,
  type ContributionMethod,
  type RosterRow,
} from '@/lib/collections-api';
import { promptText } from '@/lib/dialog';
import { formatMoney } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { parseAmount } from '@/lib/shift-api';
import { colors } from '@/lib/theme';

const money = (n: number) => formatMoney(n, { kopecks: 'auto' });
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const untilFormat = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: 'Europe/Moscow' });
const monthFormat = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric', timeZone: 'UTC' });
/** «2026-09» → «Сентябрь 2026». */
const monthLabel = (key: string) => {
  const text = monthFormat.format(new Date(`${key}-15T12:00:00Z`)).replace(' г.', '');
  return text.charAt(0).toUpperCase() + text.slice(1);
};

/**
 * Сбор: период (месяцы — только уже открытые), сколько собрано и кем, взнос периода;
 * ниже участники — кто должен, кто заплатил, кто исключён. «Оплатил» открывает шторку
 * взноса, нажатие на участника — персональную сумму и исключение.
 */
export default function CollectionScreen() {
  const params = useLocalSearchParams<{ collectionId: string; name?: string }>();
  const collectionId = params.collectionId;
  const router = useRouter();
  const tiers = useClientTiers();
  const periods = useCollectionPeriods(collectionId);
  const [periodKey, setPeriodKey] = useState<string | null>(null);
  const detail = useCollection(collectionId, periodKey);
  const [busyRow, setBusyRow] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const search = useDebounced(query, 200).trim().toLowerCase();
  const data = detail.data;

  // Только существующие периоды и текущий месяц — иначе сервер заведёт пустой месяц с долгами.
  const current = currentPeriodKey();
  const keys = [...new Set([current, ...(periods.data ?? []).map((p) => p.key)])].filter((k) => k !== 'single' && k <= current).sort().reverse();

  if (!data) {
    return (
      <>
        <Stack.Title>{params.name ?? 'Сбор'}</Stack.Title>
        <Host style={{ flex: 1 }} useViewportSizeMeasurement>
          {detail.isError ? <ContentUnavailableView title="Сбор не загрузился" systemImage="wifi.exclamationmark" description={errorText(detail.error)} /> : <ProgressView />}
        </Host>
      </>
    );
  }

  const { collection, period, totals, roster } = data;
  const recurring = collection.kind === 'recurring';
  const found = search ? roster.filter((r) => (r.nickname ?? '').toLowerCase().includes(search)) : roster;
  const groups: { key: string; title: string; rows: RosterRow[] }[] = [
    { key: 'due', title: 'Ждём взнос', rows: found.filter((r) => ['due', 'topUp'].includes(rosterState(r))) },
    { key: 'paid', title: 'Оплатили', rows: found.filter((r) => ['paid', 'prepaid'].includes(rosterState(r))) },
    { key: 'excluded', title: 'Исключены', rows: found.filter((r) => rosterState(r) === 'excluded') },
  ].filter((g) => g.rows.length > 0);
  const byMethod = Object.entries(totals.byMethod) as [ContributionMethod, { total: number; count: number }][];

  const editAmount = () =>
    promptText(
      'Взнос за период',
      `${period.label}. Меняется только этот период; у участников с персональной суммой — своя.`,
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Сохранить',
          onPress: (input?: string) => {
            const amount = parseAmount(input ?? '');
            if (amount === null) return Alert.alert('Введите сумму');
            setPeriodAmount(collection.id, period.id, amount)
              .then(() => haptic.success())
              .catch((error: unknown) => Alert.alert('Сумма не сохранена', errorText(error)));
          },
        },
      ],
      'plain-text',
      String(period.amount),
      'decimal-pad',
    );

  const archive = () =>
    Alert.alert('Архивировать сбор?', 'Сбор скроется из списка. История взносов сохранится.', [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Архивировать',
        style: 'destructive',
        onPress: () =>
          archiveCollection(collection.id)
            .then(() => {
              haptic.success();
              router.back();
            })
            .catch((error: unknown) => Alert.alert('Сбор не архивирован', errorText(error))),
      },
    ]);

  const unmark = (row: RosterRow) => {
    const contribution = row.contribution;
    if (!contribution) return;
    const method = CONTRIBUTION_METHODS[contribution.method];
    Alert.alert(
      `Снять взнос ${row.nickname}?`,
      contribution.method === 'deposit' || contribution.method === 'debt'
        ? `${money(contribution.amount)} вернутся на баланс клиента (${method.label.toLowerCase()}).`
        : `Отметка «${method.label} · ${money(contribution.amount)}» будет удалена.`,
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Снять',
          style: 'destructive',
          onPress: async () => {
            setBusyRow(row.playerId);
            try {
              await removeContribution(collection.id, row);
              haptic.success();
            } catch (error) {
              haptic.error();
              Alert.alert('Отметка не снята', errorText(error));
            } finally {
              setBusyRow(null);
            }
          },
        },
      ],
    );
  };

  const pay = (row: RosterRow) => {
    haptic.light();
    router.push({ pathname: '/manage/collections/pay', params: { collectionId: collection.id, periodKey: periodKey ?? '', playerId: row.playerId } });
  };

  const openMember = (row: RosterRow) => {
    haptic.selection();
    router.push({ pathname: '/manage/collections/member', params: { collectionId: collection.id, periodKey: periodKey ?? '', playerId: row.playerId } });
  };

  return (
    <>
      <Stack.Title>{collection.name}</Stack.Title>
      <Stack.Toolbar placement="right">
        <ToolbarMenu icon="ellipsis" accessibilityLabel="Действия со сбором">
          <ToolbarMenuAction icon="pencil" onPress={() => router.push({ pathname: '/manage/collections/edit', params: { collectionId: collection.id } })}>
            Изменить сбор
          </ToolbarMenuAction>
          <ToolbarMenuAction icon="rublesign.circle" onPress={editAmount}>
            Взнос за период
          </ToolbarMenuAction>
          <ToolbarMenuAction icon="archivebox" destructive onPress={archive}>
            Архивировать
          </ToolbarMenuAction>
        </ToolbarMenu>
      </Stack.Toolbar>

      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <Form modifiers={[refreshable(async () => void (await Promise.allSettled([detail.refetch(), periods.refetch()])))]}>
          <Section
            footer={<Text>{`${collection.isMandatory ? 'Обязательный взнос резидентов' : 'Добровольный сбор'}${collection.description ? ` · ${collection.description}` : ''}`}</Text>}>
            {recurring && (
              <Picker
                label="Период"
                selection={period.key}
                onSelectionChange={(value) => {
                  haptic.selection();
                  const key = String(value);
                  setPeriodKey(key === current ? null : key);
                }}
                modifiers={[pickerStyle('menu')]}>
                {keys.map((key) => (
                  <Text key={key} modifiers={[tag(key)]}>
                    {monthLabel(key)}
                  </Text>
                ))}
              </Picker>
            )}
            <VStack alignment="leading" spacing={2}>
              <Text modifiers={[font({ textStyle: 'footnote', weight: 'semibold' }), secondary]}>СОБРАНО</Text>
              <Text
                modifiers={[
                  font({ size: 34, weight: 'bold', design: 'rounded' }),
                  primary,
                  monospacedDigit(),
                  contentTransition('numericText'),
                  animation(Animation.default, totals.collected),
                ]}>
                {money(totals.collected)}
              </Text>
              <Text modifiers={[secondary]}>{`оплатили ${totals.paidCount} из ${totals.eligibleCount}${totals.excludedCount ? ` · исключено ${totals.excludedCount}` : ''}`}</Text>
            </VStack>
            <Button onPress={editAmount}>
              <LabeledContent label="Взнос за период">
                <Text modifiers={[foregroundStyle(colors.accent), monospacedDigit()]}>{money(period.amount)}</Text>
              </LabeledContent>
            </Button>
          </Section>

          {byMethod.length > 0 && (
            <Section title="Как платили">
              {byMethod.map(([method, sum]) => {
                const look = CONTRIBUTION_METHODS[method];
                return <LegendRow key={method} color={look.color} label={look.label} caption={`${sum.count} чел.`} value={money(sum.total)} />;
              })}
            </Section>
          )}

          {roster.length === 0 ? (
            <Section>
              <ContentUnavailableView title="Участников нет" systemImage="person.3" description="В клубе пока нет резидентов, студентов и новичков." />
            </Section>
          ) : (
            <>
              <Section>
                <SearchRow placeholder="Участник" onChange={setQuery} />
              </Section>
              {groups.length === 0 ? (
                <Section>
                  <ContentUnavailableView title="Никого не нашли" systemImage="magnifyingglass" />
                </Section>
              ) : (
                groups.map((group) => (
                  <Section key={group.key} title={`${group.title} · ${group.rows.length}`}>
                    {group.rows.map((row) => (
                      <MemberRow
                        key={row.playerId}
                        row={row}
                        tiers={tiers.data}
                        busy={busyRow === row.playerId}
                        onOpen={() => openMember(row)}
                        onPay={() => pay(row)}
                        onUnmark={() => unmark(row)}
                      />
                    ))}
                  </Section>
                ))
              )}
            </>
          )}
        </Form>
      </Host>
    </>
  );
}

function MemberRow({
  row,
  tiers,
  busy,
  onOpen,
  onPay,
  onUnmark,
}: {
  row: RosterRow;
  tiers: ClientTierRow[] | undefined;
  busy: boolean;
  onOpen: () => void;
  onPay: () => void;
  onUnmark: () => void;
}) {
  const state = rosterState(row);
  const contribution = row.contribution;
  const tier = tierLook(row.clientTier, tiers);
  const caption = (() => {
    switch (state) {
      case 'excluded':
        return row.excludedForever ? 'исключён навсегда' : row.excludedUntil ? `исключён до ${untilFormat.format(new Date(row.excludedUntil))}` : 'исключён';
      case 'prepaid':
        return `оплачено авансом${row.prepaidMonths > 0 ? ` · ещё ${row.prepaidMonths} мес` : ''}`;
      case 'paid':
        return `${contribution ? `${money(contribution.amount)} · ${CONTRIBUTION_METHODS[contribution.method].label.toLowerCase()}` : 'оплачено'}${row.prepaid > 0.004 ? ` · аванс ${money(row.prepaid)}` : ''}`;
      case 'topUp':
        return row.topUp < row.expected ? `доплатить ${money(row.topUp)} из ${money(row.expected)}` : `к оплате ${money(row.topUp)}${row.topUp > row.expected ? ' с прошлыми месяцами' : ''}`;
      default:
        return `взнос ${money(row.expected)}`;
    }
  })();
  const captionColor = state === 'paid' || state === 'prepaid' ? colors.green : state === 'topUp' ? colors.orange : undefined;

  return (
    <HStack spacing={10}>
      <Button onPress={onOpen} modifiers={[buttonStyle('borderless')]}>
        <HStack spacing={10}>
          <RNHostView matchContents>
            <Avatar name={row.nickname} photoUrl={row.photoUrl} size={38} />
          </RNHostView>
          <VStack alignment="leading" spacing={1}>
            <HStack spacing={6}>
              <Text modifiers={[primary, lineLimit(1)]}>{row.nickname}</Text>
              <Text modifiers={[font({ textStyle: 'caption', weight: 'semibold' }), foregroundStyle(tier.color)]}>{row.amountOverride !== null ? `${tier.label} · своя сумма` : tier.label}</Text>
            </HStack>
            <Text modifiers={[font({ textStyle: 'footnote' }), captionColor ? foregroundStyle(captionColor) : secondary, lineLimit(1)]}>{caption}</Text>
          </VStack>
        </HStack>
      </Button>
      <Spacer />
      {busy ? (
        <ProgressView />
      ) : contribution && state === 'topUp' ? (
        // Недобор при отметке за период: доплата наличными/переводом/СБП складывается с ней.
        <HStack spacing={6}>
          <Button label="Снять" onPress={onUnmark} modifiers={[buttonStyle('bordered'), controlSize('small')]} />
          <Button label="Доплатить" onPress={onPay} modifiers={[buttonStyle('borderedProminent'), controlSize('small')]} />
        </HStack>
      ) : contribution ? (
        <Button label="Снять" onPress={onUnmark} modifiers={[buttonStyle('bordered'), controlSize('small')]} />
      ) : state === 'prepaid' ? (
        <Text modifiers={[font({ textStyle: 'caption' }), foregroundStyle(colors.green)]}>аванс</Text>
      ) : state === 'excluded' ? null : (
        <Button label="Оплатил" onPress={onPay} modifiers={[buttonStyle('borderedProminent'), controlSize('small')]} />
      )}
    </HStack>
  );
}
