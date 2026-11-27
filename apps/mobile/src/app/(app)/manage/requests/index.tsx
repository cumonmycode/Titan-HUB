import { Button, ContentUnavailableView, Form, HStack, Host, Image, Picker, ProgressView, RNHostView, Section, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import { font, foregroundStyle, lineLimit, pickerStyle, refreshable, tag } from '@expo/ui/swift-ui/modifiers';
import { Stack, useRouter } from 'expo-router';
import { useState, type ReactElement } from 'react';

import { primary, RowIcon, secondary, tertiary } from '@/components/native-form';
import { Avatar } from '@/components/new-check-parts';
import { ToolbarButton } from '@/components/toolbar';
import { channelLabel, SOURCE_LOOK, sourceKeyOf } from '@/lib/bookings-api';
import { whenText } from '@/lib/clients-api';
import { formatMskDateTime, parseServerDate, type BookingRequest } from '@/lib/events-api';
import { plural } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { deviceText, useLeadRegistrations, useLeadRequests, useLeadsSummary, useNewcomers, type LeadRegistration, type Newcomer } from '@/lib/leads-api';

type Tab = 'requests' | 'registrations' | 'telegram';

const ATTENTION = '#FF9500';
const TAI = '#8B5CF6';
const EVENING: Record<string, string> = { city_mafia: 'Городская', sport_mafia: 'Спортивная', board_games: 'Настолки', any: 'Любой вечер' };

const FOOTERS: Record<Tab, string> = {
  requests: 'Записи на игру и обращения. Заявки на мероприятия — в «Событиях».',
  registrations: 'Сами зарегистрировались в My Titan. До подтверждения им не начисляются бонусы и закрыта оплата в приложении.',
  telegram: 'Писали Tai в личку, но в базе их нет. Откройте переписку — там можно ответить и завести клиента.',
};

/**
 * «Заявки» — новые люди, которые ещё не стали клиентами клуба:
 *  • записи на игру и обращения — с сайта, через Tai в Telegram или заведённые вручную;
 *  • регистрации из My Titan, ждущие подтверждения (до него их нет в «Клиентах»);
 *  • новые из Telegram — писали Tai, но в базе их нет.
 * Каждая строка открывает карточку: откуда, когда, что просил, переписка с Tai.
 * Заявки на мероприятия (корпоративы, дни рождения) — в «Событиях», там их подтверждают.
 */
export default function RequestsScreen() {
  const router = useRouter();
  const summary = useLeadsSummary();
  const requests = useLeadRequests();
  const registrations = useLeadRegistrations();
  const newcomers = useNewcomers();
  const [picked, setPicked] = useState<Tab | null>(null);

  const counts = { requests: requests.data?.length ?? 0, registrations: registrations.data?.length ?? 0, telegram: newcomers.data?.length ?? 0 };
  // Пока не выбрано вручную — открываем первый непустой список.
  const tab: Tab = picked ?? (counts.requests ? 'requests' : counts.registrations ? 'registrations' : counts.telegram ? 'telegram' : 'requests');

  const refresh = async () => {
    await Promise.allSettled([summary.refetch(), requests.refetch(), registrations.refetch(), newcomers.refetch()]);
  };

  const label = (title: string, n: number) => (n > 0 ? `${title} · ${n}` : title);

  return (
    <>
      <Stack.Title>Заявки</Stack.Title>
      <Stack.Toolbar placement="right">
        <ToolbarButton icon="plus" accessibilityLabel="Запись вручную" onPress={() => router.push({ pathname: '/manage/requests/new', params: { kind: 'game' } })} />
      </Stack.Toolbar>
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <Form modifiers={[refreshable(refresh)]}>
          <Section footer={<Text>{FOOTERS[tab]}</Text>}>
            <Picker
              selection={tab}
              onSelectionChange={(value) => {
                haptic.selection();
                setPicked(value as Tab);
              }}
              modifiers={[pickerStyle('segmented')]}>
              <Text modifiers={[tag('requests')]}>{label('Записи', counts.requests)}</Text>
              <Text modifiers={[tag('registrations')]}>{label('Регистрации', counts.registrations)}</Text>
              <Text modifiers={[tag('telegram')]}>{label('Telegram', counts.telegram)}</Text>
            </Picker>
          </Section>

          {tab === 'requests' ? (
            <List
              loading={requests.isLoading}
              error={requests.error}
              empty="Новых записей нет"
              emptyText="Записи на игру и вопросы с сайта, из Telegram и заведённые вручную появятся здесь."
              items={requests.data}
              render={(b) => <RequestRow key={b.id} booking={b} onPress={() => router.push({ pathname: '/manage/requests/booking', params: { bookingId: b.id } })} />}
            />
          ) : tab === 'registrations' ? (
            <List
              loading={registrations.isLoading}
              error={registrations.error}
              empty="Регистраций нет"
              emptyText="Кто зарегистрируется в My Titan, появится здесь — до подтверждения его нет в «Клиентах»."
              items={registrations.data}
              render={(r) => <RegistrationRow key={r.id} registration={r} onPress={() => router.push({ pathname: '/manage/requests/registration', params: { id: r.id } })} />}
            />
          ) : (
            <List
              loading={newcomers.isLoading}
              error={newcomers.error}
              empty="Новых из Telegram нет"
              emptyText="Кто напишет Tai в личку и кого нет в базе клуба, появится здесь."
              items={newcomers.data}
              render={(n) => <NewcomerRow key={n.tgId} newcomer={n} onPress={() => router.push({ pathname: '/tai-dialog', params: { tgId: n.tgId } })} />}
            />
          )}
        </Form>
      </Host>
    </>
  );
}

function List<T>({
  loading,
  error,
  empty,
  emptyText,
  items,
  render,
}: {
  loading: boolean;
  error: Error | null;
  empty: string;
  emptyText: string;
  items: T[] | undefined;
  render: (item: T) => ReactElement;
}) {
  if (loading) {
    return (
      <Section>
        <ProgressView />
      </Section>
    );
  }
  if (!items?.length) {
    return (
      <Section>
        <ContentUnavailableView title={error ? 'Не загрузилось' : empty} systemImage={error ? 'wifi.exclamationmark' : 'tray'} description={error ? error.message : emptyText} />
      </Section>
    );
  }
  return <Section>{items.map(render)}</Section>;
}

function Chevron() {
  return <Image systemName="chevron.right" size={13} modifiers={[tertiary, font({ weight: 'semibold' })]} />;
}

function requestWhen(b: BookingRequest): string {
  const date = parseServerDate(b.starts_at);
  const evening = typeof b.meta?.['evening'] === 'string' ? EVENING[b.meta['evening'] as string] : null;
  if (b.kind === 'message') return date ? `Вопрос · ${formatMskDateTime(date)}` : 'Вопрос';
  return [evening, date ? formatMskDateTime(date) : null, b.guests ? `${b.guests} ${plural(b.guests, ['гость', 'гостя', 'гостей'])}` : null].filter(Boolean).join(' · ');
}

function RequestRow({ booking, onPress }: { booking: BookingRequest; onPress: () => void }) {
  const look = SOURCE_LOOK[sourceKeyOf(booking.source)];
  const channel = booking.source === 'manual' ? channelLabel(booking) : null;
  return (
    <Button
      onPress={() => {
        haptic.selection();
        onPress();
      }}>
      <HStack spacing={12}>
        <RowIcon name={look.icon} color={look.color} />
        <VStack alignment="leading" spacing={2}>
          <Text modifiers={[primary, font({ weight: 'semibold' }), lineLimit(1)]}>{booking.name}</Text>
          <Text modifiers={[font({ textStyle: 'subheadline' }), secondary, lineLimit(1)]}>{requestWhen(booking)}</Text>
          <Text modifiers={[font({ textStyle: 'caption', weight: 'semibold' }), foregroundStyle(look.color), lineLimit(1)]}>{channel ? `${look.label} · ${channel}` : look.label}</Text>
        </VStack>
        <Spacer />
        <Chevron />
      </HStack>
    </Button>
  );
}

function RegistrationRow({ registration, onPress }: { registration: LeadRegistration; onPress: () => void }) {
  const device = deviceText(registration);
  const meta = ['My Titan', device, registration.createdAt ? whenText(registration.createdAt) : null].filter(Boolean).join(' · ');
  return (
    <Button
      onPress={() => {
        haptic.selection();
        onPress();
      }}>
      <HStack spacing={12}>
        <RNHostView matchContents>
          <Avatar name={registration.nickname} photoUrl={registration.photoUrl} size={44} />
        </RNHostView>
        <VStack alignment="leading" spacing={2}>
          <Text modifiers={[primary, font({ weight: 'semibold' }), lineLimit(1)]}>{registration.nickname}</Text>
          <Text modifiers={[font({ textStyle: 'subheadline' }), secondary, lineLimit(1)]}>{registration.fullName ?? registration.phone ?? 'Имя не указано'}</Text>
          <Text modifiers={[font({ textStyle: 'caption' }), secondary, lineLimit(1)]}>{meta}</Text>
          {registration.chat ? (
            <Text modifiers={[font({ textStyle: 'caption', weight: 'semibold' }), foregroundStyle(registration.chat.needsAttention ? ATTENTION : TAI), lineLimit(1)]}>
              {registration.chat.needsAttention ? 'Ждёт ответа в Telegram' : `Переписка с Tai · ${registration.chat.messages}`}
            </Text>
          ) : null}
        </VStack>
        <Spacer />
        <Chevron />
      </HStack>
    </Button>
  );
}

function NewcomerRow({ newcomer, onPress }: { newcomer: Newcomer; onPress: () => void }) {
  return (
    <Button
      onPress={() => {
        haptic.selection();
        onPress();
      }}>
      <HStack spacing={12}>
        <RNHostView matchContents>
          <Avatar name={newcomer.name} photoUrl={null} size={44} />
        </RNHostView>
        <VStack alignment="leading" spacing={2}>
          <HStack spacing={6}>
            <Text modifiers={[primary, font({ weight: 'semibold' }), lineLimit(1)]}>{newcomer.name}</Text>
            {newcomer.username ? <Text modifiers={[font({ textStyle: 'caption' }), secondary, lineLimit(1)]}>{`@${newcomer.username}`}</Text> : null}
          </HStack>
          <Text modifiers={[font({ textStyle: 'subheadline' }), secondary, lineLimit(2)]}>{newcomer.lastMessage ?? 'Открыл бота'}</Text>
          <Text modifiers={[font({ textStyle: 'caption', weight: 'semibold' }), foregroundStyle(newcomer.needsAttention ? ATTENTION : TAI), lineLimit(1)]}>
            {newcomer.needsAttention ? 'Ждёт ответа' : `Tai · ${newcomer.messages} ${plural(newcomer.messages, ['сообщение', 'сообщения', 'сообщений'])}`}
          </Text>
        </VStack>
        <Spacer />
        <VStack alignment="trailing" spacing={4}>
          {newcomer.lastAt ? <Text modifiers={[font({ textStyle: 'caption' }), secondary, lineLimit(1)]}>{whenText(newcomer.lastAt)}</Text> : null}
          <Chevron />
        </VStack>
      </HStack>
    </Button>
  );
}
