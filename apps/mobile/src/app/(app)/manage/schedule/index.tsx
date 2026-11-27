import { ContentUnavailableView, Form, Host, ProgressView, Section, Text } from '@expo/ui/swift-ui';
import { refreshable } from '@expo/ui/swift-ui/modifiers';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';

import { ActionRow, LinkRow } from '@/components/native-form';
import { ToolbarMenu, ToolbarMenuAction } from '@/components/toolbar';
import { haptic } from '@/lib/haptics';
import { dateLabel, saveSchedule, slotWhen, useSchedule, WEEKDAY_NAMES, type ScheduleSlot } from '@/lib/schedule-api';
import { useSession } from '@/lib/session';
import { eveningLook } from '@/lib/site-looks';

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const todayMsk = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);

/** Что ещё делает вечер, кроме календаря: опрос в чат, скрыт на сайте. */
function slotExtras(s: ScheduleSlot): string {
  return [s.title, s.poll.on ? `опрос в ${s.poll.postTime ?? '10:00'}` : null, s.onSite ? null : 'не на сайте'].filter(Boolean).join(' · ');
}

/**
 * Расписание клуба — одно на всё. По нему сайт показывает календарь и принимает запись,
 * Tai знает ближайшие игры и зовёт людей, касса подставляет тип вечера при открытии
 * смены (из него — статистика), а опросы записи выкладываются в чаты.
 */
export default function ScheduleScreen() {
  const router = useRouter();
  const schedule = useSchedule();
  const isOwner = useSession((s) => s.user?.role === 'owner');
  const [busy, setBusy] = useState(false);
  const data = schedule.data;

  if (!data) {
    return (
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        {schedule.isError ? <ContentUnavailableView title="Нет связи" systemImage="wifi.exclamationmark" description={schedule.error.message} /> : <ProgressView />}
      </Host>
    );
  }

  const weekly = data.slots.filter((s) => s.repeat === 'weekly');
  const today = todayMsk();
  const once = data.slots.filter((s) => s.repeat === 'once' && (s.date ?? '') >= today);
  const past = data.slots.filter((s) => s.repeat === 'once' && (s.date ?? '') < today);
  const open = (params: Record<string, string>) => router.push({ pathname: '/manage/schedule/slot', params });

  const pin = async () => {
    haptic.medium();
    setBusy(true);
    try {
      await saveSchedule(data.slots);
      haptic.success();
    } catch (error) {
      haptic.error();
      Alert.alert('Не сохранилось', errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const row = (s: ScheduleSlot, title: string) => {
    const look = eveningLook(s.title);
    return (
      <LinkRow
        key={s.id}
        icon={look.icon}
        color={look.color}
        title={title}
        subtitle={slotExtras(s)}
        value={s.time}
        onPress={isOwner ? () => open({ id: s.id }) : undefined}
      />
    );
  };

  return (
    <>
      <Stack.Title>Расписание</Stack.Title>
      {isOwner ? (
        <Stack.Toolbar placement="right">
          <ToolbarMenu icon="plus" accessibilityLabel="Добавить">
            <ToolbarMenuAction icon="repeat" onPress={() => open({ repeat: 'weekly' })}>
              Вечер недели
            </ToolbarMenuAction>
            <ToolbarMenuAction icon="star" onPress={() => open({ repeat: 'once' })}>
              Разовое событие
            </ToolbarMenuAction>
          </ToolbarMenu>
        </Stack.Toolbar>
      ) : null}
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <Form modifiers={[refreshable(async () => void (await schedule.refetch()))]}>
          <Section
            footer={
              <Text>
                {data.derived
                  ? 'Пока собрано из расписания сайта и опросов. Сохраните — и сайт, Tai, касса и опросы будут брать вечера отсюда.'
                  : 'По расписанию сайт показывает календарь и принимает запись, Tai зовёт на игры, касса подставляет вечер при открытии смены, а опросы выкладываются в чаты.'}
              </Text>
            }>
            {data.derived && isOwner ? <ActionRow title="Закрепить расписание" icon="checkmark.seal.fill" disabled={busy} onPress={() => void pin()} /> : null}
          </Section>

          <Section title="Вечера недели">
            {weekly.length ? weekly.map((s) => row(s, WEEKDAY_NAMES[s.day ?? 0] ?? '')) : <Text>Вечеров нет — добавьте кнопкой «+».</Text>}
          </Section>

          <Section title="Разовые события" footer={<Text>Хэллоуин, Новый год, турнир — в свою дату. На сайте и у Tai появятся рядом с обычными вечерами.</Text>}>
            {once.length ? once.map((s) => row(s, s.date ? dateLabel(s.date) : '')) : <Text>Ближайших разовых событий нет.</Text>}
          </Section>

          {data.upcoming.length > 0 ? (
            <Section title="Ближайшие две недели" footer={<Text>Так вечера видят сайт, Tai и касса.</Text>}>
              {data.upcoming.map((n) => (
                <LinkRow
                  key={`${n.date}-${n.slotId}`}
                  icon={n.once ? 'star.fill' : eveningLook(n.title).icon}
                  color={n.once ? '#FF9500' : eveningLook(n.title).color}
                  title={n.offset === 0 ? 'Сегодня' : n.offset === 1 ? 'Завтра' : dateLabel(n.date)}
                  subtitle={n.title}
                  value={n.time}
                  chevron={false}
                />
              ))}
            </Section>
          ) : null}

          {past.length > 0 ? <Section title="Прошедшие события">{past.map((s) => row(s, slotWhen(s)))}</Section> : null}
        </Form>
      </Host>
    </>
  );
}
