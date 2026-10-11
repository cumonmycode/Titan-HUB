import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, View } from 'react-native';

import { AmbientBackdrop } from '@/components/ambient-backdrop';
import { CustomerCard } from '@/components/events/customer-card';
import { EventDetails, MinicapDetails } from '@/components/events/event-details';
import { EventHero } from '@/components/events/event-hero';
import { EventPrimaryAction } from '@/components/events/primary-action';
import { MinicapLineup } from '@/components/minicap-lineup';
import { AppRefreshControl } from '@/components/refresh-control';
import { Text } from '@/components/text';
import { ToolbarMenu, ToolbarMenuAction } from '@/components/toolbar';
import {
  eventBase,
  eventErrorMessage,
  eventTitle,
  purgeEvent,
  startEvent,
  updateEvent,
  useEvent,
  useEventParticipants,
  useEventRates,
  useStaffList,
  type EventStatus,
} from '@/lib/events-api';
import { haptic } from '@/lib/haptics';
import { usePageGutter } from '@/lib/layout';
import { useSpaces } from '@/lib/pos-api';
import { useSession } from '@/lib/session';
import { colors, space, type } from '@/lib/theme';

const errorText = (error: unknown) => eventErrorMessage(error instanceof Error ? error.message : String(error));

/**
 * Мероприятие. Шапка — вид, название, день и время, статус; под ней одно главное действие —
 * следующий шаг по статусу. Ниже — детали (каждая по одному разу), состав миникапа и
 * заказчик со связью в один тап. Всё остальное (правка, уточнение, отмена, удаление) — в
 * меню «…». Открывается зумом из карточки ленты.
 */
export default function EventScreen() {
  const gutter = usePageGutter();
  const { eventId } = useLocalSearchParams<{ eventId: string }>();
  const router = useRouter();
  const event = useEvent(eventId);
  const rates = useEventRates();
  const spaces = useSpaces();
  const staff = useStaffList();
  const isOwner = useSession((s) => s.user?.role === 'owner');
  const [busy, setBusy] = useState<string | null>(null);
  const [pulling, setPulling] = useState(false);
  const data = event.data;
  const isMinicap = data?.format === 'minicap';
  const lineup = useEventParticipants(isMinicap ? eventId : undefined, data?.status === 'active');

  const run = async (key: string, action: () => Promise<unknown>, failTitle: string) => {
    haptic.medium();
    setBusy(key);
    try {
      await action();
      haptic.success();
    } catch (error) {
      haptic.error();
      Alert.alert(failTitle, errorText(error));
    } finally {
      setBusy(null);
    }
  };

  if (!data) {
    return (
      <AmbientBackdrop style={styles.screen}>
        <View style={styles.state}>{event.isError ? <Text style={[type.body, styles.secondary]}>{errorText(event.error)}</Text> : <ActivityIndicator />}</View>
      </AmbientBackdrop>
    );
  }

  const open = data.status !== 'cancelled' && data.status !== 'completed';
  const players = (lineup.data ?? []).filter((p) => p.role === 'player').length;
  const spaceName = data.spaceId ? ((spaces.data ?? []).find((s) => s.id === data.spaceId)?.name ?? null) : null;
  // Крутилка — там, откуда действие запущено: у главной кнопки своя, у пунктов меню — в статусе шапки.
  const primaryBusy = busy === 'start' || (busy === 'status-planned' && data.status === 'needs_clarification');
  const responsible = data.responsibleStaffId ? ((staff.data ?? []).find((s) => s.id === data.responsibleStaffId)?.nickname ?? null) : null;

  const refresh = async () => {
    setPulling(true);
    await Promise.allSettled([event.refetch(), isMinicap ? lineup.refetch() : Promise.resolve()]);
    setPulling(false);
  };

  const setStatus = (next: EventStatus) => void run(`status-${next}`, () => updateEvent(data.id, { status: next }), 'Статус не изменён');

  const start = () => void run('start', () => startEvent(data.id), isMinicap ? 'Миникап не начался' : 'Мероприятие не началось');

  const openCheck = () => {
    haptic.light();
    // У миникапа счёт у каждого участника — ведём в кассу, у мероприятия — прямо в его чек.
    if (!isMinicap && data.checkId) router.push({ pathname: '/pos/[checkId]', params: { checkId: data.checkId } });
    else router.navigate('/pos');
  };

  const edit = () => {
    haptic.light();
    router.push({ pathname: '/events/edit', params: { eventId: data.id } });
  };

  const cancel = () =>
    Alert.alert(
      isMinicap ? 'Отменить миникап?' : 'Отменить мероприятие?',
      isMinicap ? 'Открытые счета участников в кассе тоже отменятся.' : data.checkId ? 'Открытый чек мероприятия тоже будет отменён.' : undefined,
      [
        { text: 'Назад', style: 'cancel' },
        { text: 'Отменить', style: 'destructive', onPress: () => setStatus('cancelled') },
      ],
    );

  const purge = () =>
    Alert.alert('Удалить навсегда?', 'Мероприятие исчезнет из списка и аналитики. Чеки останутся в истории.', [
      { text: 'Назад', style: 'cancel' },
      {
        text: 'Удалить',
        style: 'destructive',
        onPress: () =>
          void run(
            'purge',
            async () => {
              await purgeEvent(data.id);
              router.back();
            },
            'Мероприятие не удалено',
          ),
      },
    ]);

  return (
    <AmbientBackdrop style={styles.screen}>
      <Stack.Title>{eventTitle(data)}</Stack.Title>
      {/* У завершённого действий нет — и меню нет. «Всё уточнено» здесь не повторяется: это главная кнопка. */}
      {data.status !== 'completed' && (
        <Stack.Toolbar placement="right">
          <ToolbarMenu icon="ellipsis" accessibilityLabel="Действия с мероприятием">
            {open && (
              <ToolbarMenuAction icon="pencil" disabled={!!busy} onPress={edit}>
                Редактировать
              </ToolbarMenuAction>
            )}
            {data.status === 'planned' && (
              <ToolbarMenuAction icon="questionmark.circle" disabled={!!busy} onPress={() => setStatus('needs_clarification')}>
                Требует уточнения
              </ToolbarMenuAction>
            )}
            {data.status === 'cancelled' && (
              <ToolbarMenuAction icon="clock" disabled={!!busy} onPress={() => setStatus('planned')}>
                Вернуть в запланированные
              </ToolbarMenuAction>
            )}
            {open && (
              <ToolbarMenuAction icon="xmark.circle" destructive disabled={!!busy} onPress={cancel}>
                {isMinicap ? 'Отменить миникап' : 'Отменить мероприятие'}
              </ToolbarMenuAction>
            )}
            {isOwner && data.status === 'cancelled' && (
              <ToolbarMenuAction icon="trash" destructive disabled={!!busy} onPress={purge}>
                Удалить навсегда
              </ToolbarMenuAction>
            )}
          </ToolbarMenu>
        </Stack.Toolbar>
      )}

      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[styles.content, gutter]}
        showsVerticalScrollIndicator={false}
        refreshControl={<AppRefreshControl tintColor={colors.accent} refreshing={pulling} onRefresh={refresh} />}>
        <EventHero event={data} busy={busy !== null && !primaryBusy} />

        <EventPrimaryAction
          event={data}
          players={players}
          lineupLoading={lineup.isLoading}
          busy={busy}
          onStart={start}
          onClarified={() => setStatus('planned')}
          onOpenCheck={openCheck}
        />

        {isMinicap ? (
          <>
            <MinicapDetails event={data} players={players} />
            <MinicapLineup event={data} lineup={lineup} />
          </>
        ) : (
          <EventDetails event={data} base={eventBase(data, rates.data)} spaceName={spaceName} responsible={responsible} />
        )}

        {data.customerName || data.customerPhone ? <CustomerCard name={data.customerName} phone={data.customerPhone} /> : null}
      </ScrollView>
    </AmbientBackdrop>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.groupedBackground },
  state: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xxl },
  content: { paddingHorizontal: space.lg, paddingBottom: 120, gap: space.md },
  secondary: { color: colors.secondaryLabel },
});
