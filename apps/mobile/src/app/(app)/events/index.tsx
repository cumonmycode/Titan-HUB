import { Host, Picker, Text as SwiftText } from '@expo/ui/swift-ui';
import { pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import { Link, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut, LayoutAnimationConfig, LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AmbientBackdrop } from '@/components/ambient-backdrop';
import { EventCard, type EventCardLead } from '@/components/event-card';
import { BookingCard } from '@/components/events/booking-card';
import { AddButton, GroupHeader, MonthFolder } from '@/components/events/list-parts';
import { AppRefreshControl } from '@/components/refresh-control';
import { Text } from '@/components/text';
import { Unavailable } from '@/components/unavailable';
import { syncEventsToCalendar } from '@/lib/calendar-sync';
import { calendarSyncDue, markCalendarSynced, useDevicePrefs } from '@/lib/device-prefs';
import {
  dayHeader,
  eventBase,
  isUpcoming,
  monthLabel,
  resolveBooking,
  todayMsk,
  useBookingRequests,
  useEventRates,
  useEvents,
  type BookingRequest,
  type EventRow,
} from '@/lib/events-api';
import { haptic } from '@/lib/haptics';
import { usePageGutter } from '@/lib/layout';
import { useSpaces } from '@/lib/pos-api';
import { colors, space, type } from '@/lib/theme';

type Tab = 'upcoming' | 'past';

const rowLayout = LinearTransition.springify().damping(22).stiffness(200);

/**
 * События — лента по дням. Предстоящие: сверху заявки с сайта, дальше дни («Сегодня»,
 * «Завтра», «Пт, 10 октября»); идущее мероприятие остаётся здесь, даже если началось вчера.
 * Прошедшие: текущий месяц списком, прошлые — папками. Создать — одна кнопка «+»: тип
 * («В клубе / Выезд / Миникап») выбирается в самой форме. Тап по карточке открывает
 * мероприятие зумом.
 */
export default function EventsScreen() {
  const gutter = usePageGutter();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const events = useEvents();
  const bookings = useBookingRequests();
  const rates = useEventRates();
  const spaces = useSpaces();
  const calendarSync = useDevicePrefs((state) => state.calendarSync);
  const [tab, setTab] = useState<Tab>('upcoming');
  const [pulling, setPulling] = useState(false);
  const [openMonths, setOpenMonths] = useState<string[]>([]);
  const [bookingBusy, setBookingBusy] = useState<string | null>(null);

  // Календарь телефона подтягивается сам: список мероприятий обновляется после любой
  // правки, так что здесь же приводим календарь в соответствие (не чаще раза в 5 минут).
  const rows = events.data;
  useEffect(() => {
    if (!calendarSync || !rows || !calendarSyncDue()) return;
    markCalendarSynced();
    void syncEventsToCalendar(rows).catch(() => {});
  }, [calendarSync, rows]);

  const all = useMemo(() => events.data ?? [], [events.data]);
  const requests = bookings.data ?? [];
  const spaceName = useMemo(() => new Map((spaces.data ?? []).map((s) => [s.id, s.name])), [spaces.data]);

  // Идущее и не закрытое — в предстоящих при любой дате: вчерашнее ночное мероприятие
  // встаёт в начало ленты под своим днём.
  const upcoming = useMemo(() => all.filter(isUpcoming).sort((a, b) => startKey(a).localeCompare(startKey(b))), [all]);
  const past = useMemo(() => all.filter((e) => !isUpcoming(e)).sort((a, b) => startKey(b).localeCompare(startKey(a))), [all]);

  const upcomingDays = useMemo(() => groupBy(upcoming, (e) => e.date), [upcoming]);
  const currentMonth = todayMsk().slice(0, 7);
  const pastThisMonth = past.filter((e) => e.date.slice(0, 7) >= currentMonth);
  const pastMonths = useMemo(
    () =>
      groupBy(
        past.filter((e) => e.date.slice(0, 7) < currentMonth),
        (e) => e.date.slice(0, 7),
      ),
    [past, currentMonth],
  );

  const refresh = async () => {
    setPulling(true);
    await Promise.allSettled([events.refetch(), bookings.refetch()]);
    setPulling(false);
  };

  const onBooking = async (booking: BookingRequest, status: 'confirmed' | 'cancelled') => {
    haptic.medium();
    setBookingBusy(booking.id);
    try {
      const eventId = await resolveBooking(booking.id, status);
      haptic.success();
      // Как в вебе: подтверждённая заявка сразу открывает мероприятие для уточнения деталей.
      if (status === 'confirmed' && eventId) router.push({ pathname: '/events/edit', params: { eventId } });
    } catch (error) {
      haptic.error();
      Alert.alert(status === 'confirmed' ? 'Заявка не подтверждена' : 'Заявка не отклонена', error instanceof Error ? error.message : String(error));
    } finally {
      setBookingBusy(null);
    }
  };

  const rejectBooking = (booking: BookingRequest) =>
    Alert.alert('Отклонить заявку?', `${booking.name} · ${booking.phone}`, [
      { text: 'Назад', style: 'cancel' },
      { text: 'Отклонить', style: 'destructive', onPress: () => void onBooking(booking, 'cancelled') },
    ]);

  const renderEvent = (event: EventRow, lead: EventCardLead) => (
    <Animated.View key={event.id} entering={FadeIn} exiting={FadeOut} layout={rowLayout}>
      <Link href={{ pathname: '/events/[eventId]', params: { eventId: event.id } }} asChild>
        <Link.Trigger withAppleZoom>
          <EventCard
            event={event}
            lead={lead}
            base={eventBase(event, rates.data)}
            place={event.type === 'exit' ? event.location : event.spaceId ? (spaceName.get(event.spaceId) ?? null) : null}
          />
        </Link.Trigger>
      </Link>
    </Animated.View>
  );

  const toggleMonth = (key: string) => setOpenMonths((open) => (open.includes(key) ? open.filter((k) => k !== key) : [...open, key]));

  const upcomingList = (
    <View style={styles.list}>
      {requests.length > 0 && (
        <View style={styles.group}>
          <GroupHeader title="Заявки с сайта" count={requests.length} />
          {requests.map((booking) => (
            <Animated.View key={booking.id} entering={FadeIn} exiting={FadeOut} layout={rowLayout}>
              <BookingCard
                booking={booking}
                busy={bookingBusy === booking.id}
                onConfirm={() => void onBooking(booking, 'confirmed')}
                onReject={() => rejectBooking(booking)}
              />
            </Animated.View>
          ))}
        </View>
      )}
      {upcoming.length === 0 && requests.length === 0 ? (
        <View style={styles.empty}>
          <Unavailable title="Мероприятий нет" systemImage="calendar" description="Мероприятие, выезд или миникап — кнопка «+» вверху." />
        </View>
      ) : (
        upcomingDays.map(([date, dayEvents]) => (
          <View key={date} style={styles.group}>
            <GroupHeader title={dayHeader(date)} />
            {dayEvents.map((event) => renderEvent(event, 'time'))}
          </View>
        ))
      )}
    </View>
  );

  const pastList = (
    <View style={styles.list}>
      {past.length === 0 && (
        <View style={styles.empty}>
          <Unavailable title="Пока пусто" systemImage="clock.arrow.circlepath" description="Здесь появятся завершённые и отменённые мероприятия." />
        </View>
      )}
      {pastThisMonth.length > 0 && (
        <View style={styles.group}>
          <GroupHeader title={monthLabel(currentMonth)} />
          {pastThisMonth.map((event) => renderEvent(event, 'date'))}
        </View>
      )}
      {pastMonths.map(([month, monthEvents]) => {
        const open = openMonths.includes(month);
        return (
          <View key={month} style={styles.group}>
            <MonthFolder title={monthLabel(month)} count={monthEvents.length} open={open} onToggle={() => toggleMonth(month)} />
            {open && monthEvents.map((event) => renderEvent(event, 'date'))}
          </View>
        );
      })}
    </View>
  );

  return (
    <AmbientBackdrop style={styles.screen}>
      <ScrollView
        contentInsetAdjustmentBehavior="never"
        contentContainerStyle={[styles.content, gutter, { paddingTop: insets.top }]}
        refreshControl={<AppRefreshControl tintColor={colors.accent} progressViewOffset={insets.top} refreshing={pulling} onRefresh={refresh} />}>
        <View style={styles.header}>
          <Text style={[type.largeTitle, styles.label, styles.flex]} accessibilityRole="header">
            События
          </Text>
          <AddButton label="Новое мероприятие" onPress={() => router.push('/events/edit')} />
        </View>

        <Host matchContents={{ vertical: true }} style={styles.segment}>
          <Picker
            selection={tab}
            onSelectionChange={(value) => {
              haptic.selection();
              setTab(value as Tab);
            }}
            modifiers={[pickerStyle('segmented')]}>
            <SwiftText modifiers={[tag('upcoming')]}>{`Предстоящие · ${upcoming.length}`}</SwiftText>
            <SwiftText modifiers={[tag('past')]}>Прошедшие</SwiftText>
          </Picker>
        </Host>

        {events.isLoading ? (
          <ActivityIndicator style={styles.loading} />
        ) : events.isError && all.length === 0 ? (
          <View style={styles.empty}>
            <Unavailable title="Нет связи" systemImage="wifi.exclamationmark" description={events.error.message} />
          </View>
        ) : (
          <LayoutAnimationConfig skipEntering>{tab === 'upcoming' ? upcomingList : pastList}</LayoutAnimationConfig>
        )}
      </ScrollView>
    </AmbientBackdrop>
  );
}

const startKey = (event: EventRow) => `${event.date} ${event.startTime}`;

function groupBy<T>(list: T[], key: (item: T) => string): [string, T[]][] {
  const map = new Map<string, T[]>();
  for (const item of list) {
    const k = key(item);
    map.set(k, [...(map.get(k) ?? []), item]);
  }
  return [...map.entries()];
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.groupedBackground },
  flex: { flex: 1 },
  content: { paddingHorizontal: space.lg, paddingBottom: 140, gap: space.lg },
  header: { flexDirection: 'row', alignItems: 'flex-end', gap: space.md, paddingTop: space.xs },
  label: { color: colors.label },
  segment: { alignSelf: 'stretch' },
  loading: { paddingTop: 80 },
  empty: { height: 360 },
  list: { gap: space.xl },
  group: { gap: space.sm },
});
