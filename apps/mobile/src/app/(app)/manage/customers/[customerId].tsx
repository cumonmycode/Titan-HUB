import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Linking, ScrollView, StyleSheet, View } from 'react-native';

import { Card, ContactButtons, InfoRow, MoveRow, ProfileHeader, StatTile } from '@/components/profile-parts';
import { AppRefreshControl } from '@/components/refresh-control';
import { Text } from '@/components/text';
import { ToolbarButton } from '@/components/toolbar';
import { useCustomer } from '@/lib/clients-api';
import { dayLabel, normalizePhone, STATUS_LOOK } from '@/lib/events-api';
import { formatMoney } from '@/lib/format';
import { usePageGutter } from '@/lib/layout';
import { colors, space, type } from '@/lib/theme';

/**
 * Карточка заказчика: связь в один тап, сколько мероприятий и на какую сумму, и сами
 * мероприятия (по телефону) — каждое открывается. Имя и телефон правятся по «Изменить».
 */
export default function CustomerScreen() {
  const { customerId } = useLocalSearchParams<{ customerId: string }>();
  const router = useRouter();
  const gutter = usePageGutter();
  const query = useCustomer(customerId);
  const [pulling, setPulling] = useState(false);
  const data = query.data;

  if (!data) {
    return (
      <View style={[styles.screen, styles.center]}>
        {query.isError ? <Text style={[type.body, styles.secondary]}>{query.error instanceof Error ? query.error.message : 'Заказчик не загрузился'}</Text> : <ActivityIndicator />}
      </View>
    );
  }

  const { customer, events } = data;
  const name = customer.name || 'Без имени';
  const phone = customer.phone ? normalizePhone(customer.phone) : null;
  const held = events.filter((e) => e.status !== 'cancelled');
  const total = held.reduce((sum, e) => sum + (e.total ?? 0), 0);
  const open = (url: string) => void Linking.openURL(url);

  return (
    <View style={styles.screen}>
      <Stack.Title>{name}</Stack.Title>
      <Stack.Toolbar placement="right">
        <ToolbarButton onPress={() => router.push({ pathname: '/manage/customers/edit', params: { customerId: customer.id, name: customer.name ?? '', phone: customer.phone ?? '' } })}>Изменить</ToolbarButton>
      </Stack.Toolbar>
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
        }
      >
        <ProfileHeader name={name} title={name} subtitle={customer.phone || 'нет телефона'} chip={{ text: 'Заказчик', color: '#0A84FF' }} />

        <ContactButtons
          items={[
            { icon: 'phone.fill', label: 'Позвонить', onPress: phone ? () => open(`tel:+${phone}`) : undefined },
            { icon: 'message.fill', label: 'WhatsApp', onPress: phone ? () => open(`https://wa.me/${phone}`) : undefined },
            { icon: 'paperplane.fill', label: 'Telegram', onPress: phone ? () => open(`tg://resolve?phone=${phone}`) : undefined },
          ]}
        />

        <View style={styles.tiles}>
          <StatTile label="Мероприятий" value={String(held.length)} color="#0A84FF" hint={events.length > held.length ? `и ${events.length - held.length} отменено` : undefined} />
          <StatTile label="На сумму" value={formatMoney(total, { kopecks: 'auto' })} color="#34C759" hint="по чекам мероприятий" />
        </View>

        <Card title="Мероприятия" footer={events.length ? 'Мероприятия, где указан этот телефон заказчика.' : undefined}>
          {events.length === 0 ? (
            <InfoRow label={phone ? 'Мероприятий с этим телефоном пока нет' : 'Добавьте телефон — по нему найдутся мероприятия'} muted />
          ) : (
            events.map((event) => {
              const look = STATUS_LOOK[event.status];
              return (
                <MoveRow
                  key={event.id}
                  icon={look.symbol}
                  color={look.color}
                  title={event.title || (event.type === 'exit' ? 'Выезд' : 'Мероприятие')}
                  subtitle={`${dayLabel(event.date)} · ${event.startTime.slice(0, 5)} · ${look.label}`}
                  amount={event.total ? formatMoney(event.total, { kopecks: 'auto' }) : ''}
                  amountColor={event.status === 'cancelled' ? colors.tertiaryLabel : undefined}
                  onPress={() => router.push({ pathname: '/events/[eventId]', params: { eventId: event.id } })}
                />
              );
            })
          )}
        </Card>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.groupedBackground },
  center: { alignItems: 'center', justifyContent: 'center', padding: space.xl },
  content: { gap: space.xl, paddingTop: space.sm, paddingBottom: space.xxxl },
  tiles: { flexDirection: 'row', gap: space.md },
  secondary: { color: colors.secondaryLabel },
});
