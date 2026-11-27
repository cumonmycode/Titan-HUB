import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { SourceBadge, bookingLook } from '@/components/events/booking-card';
import { Card, ContactButtons, InfoRow } from '@/components/profile-parts';
import { AppRefreshControl } from '@/components/refresh-control';
import { Text } from '@/components/text';
import { api } from '@/lib/api';
import { LOG_ACTION, saveBookingNote, useBookingDetail, type BookingDetail } from '@/lib/bookings-api';
import { promptText } from '@/lib/dialog';
import { formatMskDateTime, normalizePhone, parseServerDate, resolveBooking } from '@/lib/events-api';
import { plural } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { usePageGutter } from '@/lib/layout';
import { queryClient } from '@/lib/query';
import { useClubKey } from '@/lib/queries';
import { colors, space, type } from '@/lib/theme';

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

const STATUS: Record<string, { label: string; color: string }> = {
  new: { label: 'Новая', color: '#FF9500' },
  confirmed: { label: 'Подтверждена', color: '#34C759' },
  cancelled: { label: 'Отклонена', color: '#FF3B30' },
  done: { label: 'Обработана', color: '#8E8E93' },
};
const EVENING: Record<string, string> = { city_mafia: 'Городская мафия', sport_mafia: 'Спортивная мафия', board_games: 'Настольные игры', any: 'Любой вечер' };
const FORMAT: Record<string, string> = { birthday: 'День рождения', corporate: 'Корпоратив', kids: 'Детская мафия', party: 'Тематическая вечеринка', other: 'Мероприятие' };
const TOPIC: Record<string, string> = { partnership: 'Сотрудничество', question: 'Вопрос', other: 'Сообщение' };

const when = (value: string | null | undefined) => {
  const date = value ? parseServerDate(value) : null;
  return date ? formatMskDateTime(date) : '—';
};
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Что гость указал в форме: вечер, формат, сертификат, тема, «впервые у нас». */
function formLines(meta: Record<string, unknown> | null | undefined): { label: string; value: string }[] {
  if (!meta) return [];
  const lines: { label: string; value: string }[] = [];
  const evening = str(meta['evening']);
  if (evening) lines.push({ label: 'Вечер', value: EVENING[evening] ?? evening });
  const format = str(meta['format']);
  if (format) lines.push({ label: 'Формат', value: FORMAT[format] ?? format });
  const topic = str(meta['topic']);
  if (topic) lines.push({ label: 'Тема', value: TOPIC[topic] ?? topic });
  const cert = str(meta['certificate']);
  if (cert) lines.push({ label: 'Сертификат', value: `№ ${cert}` });
  if (meta['newbie'] === true) lines.push({ label: 'Новичок', value: 'впервые у нас' });
  return lines;
}

/**
 * Карточка заявки: откуда она (сайт, Tai в Telegram, вручную — каким каналом и кем),
 * что просит гость, клиент клуба с тем же телефоном или Telegram, диалог гостя с Tai,
 * заметка персонала и журнал. Здесь же — подтвердить, отклонить, позвонить, написать.
 */
export default function BookingScreen() {
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>();
  const router = useRouter();
  const club = useClubKey();
  const gutter = usePageGutter();
  const detail = useBookingDetail(bookingId);
  const [busy, setBusy] = useState(false);
  const [pulling, setPulling] = useState(false);
  const data = detail.data;

  if (!data) {
    return (
      <View style={[styles.screen, styles.center]}>
        {detail.isError ? <Text style={[type.body, styles.secondary, styles.centerText]}>{`Заявка не загрузилась. ${errorText(detail.error)}`}</Text> : <ActivityIndicator />}
      </View>
    );
  }

  const b = data.booking;
  const look = bookingLook(b);
  const status = STATUS[b.status] ?? STATUS.new!;
  const phone = b.phone ? normalizePhone(b.phone) : null;
  const tgHandle = str(b.meta?.['telegram'])?.replace(/^@|^https?:\/\/t\.me\//, '') ?? null;
  const hours = b.tariff_hours ?? (b.duration_hours ? Number(b.duration_hours) : null);
  const place = b.location === 'exit' ? (b.address ?? 'Выезд') : (b.zone_name ?? 'Клуб');
  const lines = formLines(b.meta);

  const refresh = async () => {
    setPulling(true);
    await detail.refetch().catch(() => {});
    setPulling(false);
  };

  const decide = async (next: 'confirmed' | 'cancelled') => {
    haptic.medium();
    setBusy(true);
    try {
      const eventId = await resolveBooking(b.id, next);
      haptic.success();
      await detail.refetch();
      if (next === 'confirmed' && eventId) router.push({ pathname: '/events/edit', params: { eventId } });
    } catch (error) {
      haptic.error();
      Alert.alert(next === 'confirmed' ? 'Заявка не подтверждена' : 'Заявка не отклонена', errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const reject = () =>
    Alert.alert(look.rejectQuestion, [b.name, b.phone].filter(Boolean).join(' · '), [
      { text: 'Назад', style: 'cancel' },
      { text: look.reject, style: 'destructive', onPress: () => void decide('cancelled') },
    ]);

  const editNote = () =>
    promptText(
      'Заметка к заявке',
      'Видна только персоналу в HUB',
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Сохранить',
          onPress: (value) =>
            void saveBookingNote(club, b.id, value ?? '')
              .then(() => {
                haptic.success();
                return detail.refetch();
              })
              .catch((error: unknown) => Alert.alert('Заметка не сохранена', errorText(error))),
        },
      ],
      'plain-text',
      b.staff_note ?? '',
    );

  const createClient = () =>
    promptText(
      'Новый клиент из заявки',
      'Ник клиента в клубе',
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Создать',
          onPress: (value) => {
            const nickname = (value ?? '').trim();
            if (nickname.length < 2) {
              Alert.alert('Ник — минимум 2 символа');
              return;
            }
            void api
              .post<{ client: { id: string } }>('/clients', { nickname, fullName: b.name, phone: b.phone || undefined, clientTier: 'newbie', bookingId: b.id })
              .then(({ client }) => {
                haptic.success();
                void queryClient.invalidateQueries({ queryKey: [club, 'clients'] });
                void detail.refetch();
                router.push({ pathname: '/manage/clients/[clientId]', params: { clientId: client.id } });
              })
              .catch((error: unknown) => Alert.alert('Клиент не создан', errorText(error)));
          },
        },
      ],
      'plain-text',
      b.name,
    );

  const openDialog = (tgId: string) => router.push({ pathname: '/tai-dialog', params: { tgId } });

  return (
    <View style={styles.screen}>
      <Stack.Title>{look.kind}</Stack.Title>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[styles.content, gutter]}
        showsVerticalScrollIndicator={false}
        refreshControl={<AppRefreshControl tintColor={colors.accent} refreshing={pulling} onRefresh={() => void refresh()} />}>
        <View style={styles.hero}>
          <View style={styles.heroTop}>
            <SourceBadge booking={b} />
            <View style={[styles.status, { backgroundColor: `${status.color}1F` }]}>
              <Text style={[type.caption1, styles.statusText, { color: status.color }]}>{status.label}</Text>
            </View>
          </View>
          <Text style={[type.title2, styles.label]}>{b.title || b.name}</Text>
          <Text style={[type.subhead, styles.secondary]}>
            {b.kind === 'message'
              ? `Получено ${when(b.created_at)}`
              : [when(b.starts_at), hours ? `${hours} ч` : null, b.guests ? `${b.guests} ${plural(b.guests, ['гость', 'гостя', 'гостей'])}` : null].filter(Boolean).join(' · ')}
          </Text>
        </View>

        <ContactButtons
          items={[
            { icon: 'phone.fill', label: 'Позвонить', onPress: phone ? () => void Linking.openURL(`tel:+${phone}`) : undefined },
            { icon: 'message.fill', label: 'WhatsApp', onPress: phone ? () => void Linking.openURL(`https://wa.me/${phone}`) : undefined },
            data.guestChat
              ? { icon: 'sparkles', label: 'Диалог с Tai', onPress: () => openDialog(data.guestChat!.tgId) }
              : { icon: 'paperplane.fill', label: 'Telegram', onPress: tgHandle ? () => void Linking.openURL(`https://t.me/${tgHandle}`) : undefined },
          ]}
        />

        <SourceCard data={data} />

        <Card title="Что просит гость">
          <InfoRow label="Гость" value={b.name} />
          <InfoRow label="Телефон" value={b.phone || 'не указан'} muted={!b.phone} onPress={phone ? () => void Linking.openURL(`tel:+${phone}`) : undefined} />
          {tgHandle ? <InfoRow label="Telegram" value={`@${tgHandle}`} onPress={() => void Linking.openURL(`https://t.me/${tgHandle}`)} /> : null}
          {b.kind !== 'message' ? <InfoRow label="Где" value={place} /> : null}
          {lines.map((line) => (
            <InfoRow key={line.label} label={line.label} value={line.value} />
          ))}
          {b.comment ? <InfoRow label={b.comment} muted /> : null}
        </Card>

        <ClientCard
          data={data}
          onOpen={(id) => router.push({ pathname: '/manage/clients/[clientId]', params: { clientId: id } })}
          onCreate={createClient}
          onDialog={openDialog}
        />

        {b.event_id ? (
          <Card title="Мероприятие">
            <InfoRow
              icon="calendar"
              iconColor="#5856D6"
              label={b.event_title ?? 'Мероприятие'}
              value={b.event_date ? `${b.event_date.split('-').reverse().slice(0, 2).join('.')} ${b.event_start?.slice(0, 5) ?? ''}` : undefined}
              chevron
              onPress={() => router.push({ pathname: '/events/[eventId]', params: { eventId: b.event_id! } })}
            />
          </Card>
        ) : null}

        <Card title="Заметка" footer="Видна только персоналу">
          <InfoRow label={b.staff_note || 'Добавить заметку'} muted={!b.staff_note} icon="note.text" iconColor="#FFCC00" chevron onPress={editNote} />
        </Card>

        <Card title="История">
          {data.log.map((entry) => (
            <InfoRow
              key={`${entry.action}-${entry.id}`}
              label={[LOG_ACTION[entry.action] ?? entry.action, entry.actor_name].filter(Boolean).join(' · ')}
              value={when(entry.created_at)}
              muted={entry.action === 'note'}
            />
          ))}
        </Card>

        {b.status === 'new' ? (
          <View style={styles.buttons}>
            <Pressable disabled={busy} onPress={reject} style={({ pressed }) => [styles.button, styles.reject, pressed && styles.pressed]} accessibilityRole="button">
              <Text style={[type.headline, styles.rejectText]}>{look.reject}</Text>
            </Pressable>
            <Pressable
              disabled={busy}
              onPress={() => void decide('confirmed')}
              style={({ pressed }) => [styles.button, styles.confirm, pressed && styles.pressed]}
              accessibilityRole="button">
              {busy ? <ActivityIndicator color="white" /> : <SymbolView name="checkmark" size={14} weight="bold" tintColor="white" />}
              <Text style={[type.headline, styles.confirmText]}>{look.confirm}</Text>
            </Pressable>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

/** Откуда пришла заявка — главный ответ на «кто это и как он нас нашёл». */
function SourceCard({ data }: { data: BookingDetail }) {
  const b = data.booking;
  const page = str(b.meta?.['page']);
  return (
    <Card title="Откуда заявка" footer={b.guest_follows ? 'Гость подписан на статус — решение придёт ему в Telegram.' : undefined}>
      <InfoRow label="Источник" value={data.source.label} />
      {data.source.detail ? <InfoRow label={data.source.key === 'manual' ? 'Канал' : 'Подробнее'} value={data.source.detail} /> : null}
      {page && data.source.key === 'site' ? <InfoRow label="Страница сайта" value={page} /> : null}
      <InfoRow label="Получена" value={when(b.created_at)} />
      {b.decided_by_name ? <InfoRow label={b.status === 'cancelled' ? 'Отклонил' : 'Решил'} value={`${b.decided_by_name} · ${when(b.decided_at)}`} /> : null}
    </Card>
  );
}

function ClientCard({ data, onOpen, onCreate, onDialog }: { data: BookingDetail; onOpen: (id: string) => void; onCreate: () => void; onDialog: (tgId: string) => void }) {
  const repeat = data.previousRequests > 0 ? `С этого номера уже было ${data.previousRequests} ${plural(data.previousRequests, ['заявка', 'заявки', 'заявок'])}.` : undefined;
  const chat = data.guestChat;
  return (
    <Card title="Клиент" footer={repeat}>
      {data.client ? (
        <InfoRow icon="person.crop.circle.fill" iconColor="#007AFF" label={data.client.nickname} value={data.client.full_name ?? undefined} chevron onPress={() => onOpen(data.client!.id)} />
      ) : (
        <InfoRow icon="person.crop.circle.badge.plus" iconColor="#34C759" label="В базе клиента нет — создать" chevron onPress={onCreate} />
      )}
      {chat ? (
        <InfoRow
          icon="sparkles"
          iconColor="#8B5CF6"
          label={chat.needsAttention ? 'Ждёт ответа в Telegram' : chat.aiPaused ? 'Диалог ведёт сотрудник' : 'Общается с Tai'}
          value={`${chat.messages} ${plural(chat.messages, ['сообщение', 'сообщения', 'сообщений'])}`}
          chevron
          onPress={() => onDialog(chat.tgId)}
        />
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.groupedBackground },
  center: { alignItems: 'center', justifyContent: 'center', padding: space.xl },
  centerText: { textAlign: 'center' },
  content: { gap: space.xl, paddingTop: space.sm, paddingBottom: space.xxxl },
  label: { color: colors.label },
  secondary: { color: colors.secondaryLabel },
  hero: { gap: space.xs, paddingHorizontal: space.xs },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.xs },
  status: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  statusText: { fontWeight: '600' },
  buttons: { flexDirection: 'row', gap: space.md },
  button: { flex: 1, minHeight: 48, borderRadius: 14, borderCurve: 'continuous', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  reject: { backgroundColor: colors.fill },
  rejectText: { color: colors.red },
  confirm: { backgroundColor: colors.accent },
  confirmText: { color: 'white' },
  pressed: { opacity: 0.7 },
});
