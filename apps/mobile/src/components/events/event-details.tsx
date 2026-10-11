import { Linking, StyleSheet } from 'react-native';

import { InfoRow, RowAction, RowActions } from '@/components/events/info-row';
import { GlassCard } from '@/components/new-check-parts';
import { api } from '@/lib/api';
import { BILLING_LABEL, type EventRow } from '@/lib/events-api';
import { formatMoney, toNumber } from '@/lib/format';
import { routeInYandex } from '@/lib/phone-book';
import { space } from '@/lib/theme';

/**
 * Детали мероприятия в клубе или выезда — каждая по одному разу: где (зона или адрес с
 * маршрутом и такси), кто отвечает, как считается оплата, сколько гостей, комментарий.
 * Время — в шапке экрана.
 */
export function EventDetails({ event, base, spaceName, responsible }: { event: EventRow; base: number; spaceName: string | null; responsible: string | null }) {
  const address = event.type === 'exit' ? event.location : null;
  return (
    <GlassCard style={styles.card}>
      {spaceName ? <InfoRow icon="square.split.bottomrightquarter" label="Зона" value={spaceName} /> : null}
      {address ? (
        <InfoRow icon="mappin.and.ellipse" label="Адрес" value={address}>
          <RowActions>
            {/* Маршрут строится от текущей точки: координаты берём сами, если есть доступ. */}
            <RowAction icon="location.fill" label="Маршрут" onPress={() => void routeInYandex(address)} />
            <RowAction icon="car.fill" label="Такси" onPress={() => void openTaxi(address)} />
          </RowActions>
        </InfoRow>
      ) : null}
      {responsible ? <InfoRow icon="person.badge.shield.checkmark" label="Ответственный" value={responsible} /> : null}
      <InfoRow icon="rublesign.circle" label="Оплата" value={paymentText(event, base)} />
      {event.attendeesCount > 0 || (event.maxGuests ?? 0) > 0 ? (
        <InfoRow icon="person.2" label="Гостей" value={event.maxGuests ? `${event.attendeesCount} из ${event.maxGuests}` : String(event.attendeesCount)} />
      ) : null}
      {event.comment ? <InfoRow icon="text.bubble" label="Комментарий" value={event.comment} multiline /> : null}
    </GlassCard>
  );
}

/** Миникап: взнос и сбор с состава, расходы турнира, комментарий. Состав — отдельной карточкой ниже. */
export function MinicapDetails({ event, players }: { event: EventRow; players: number }) {
  const fee = toNumber(event.participationFee);
  const costs = [
    { label: 'Призовой фонд', icon: 'gift' as const, amount: toNumber(event.prizeFund) },
    { label: 'Обед', icon: 'fork.knife' as const, amount: toNumber(event.lunchCost) },
    { label: 'Иные расходы', icon: 'ellipsis.circle' as const, amount: toNumber(event.otherCost) },
  ].filter((c) => c.amount > 0);
  return (
    <GlassCard style={styles.card}>
      <InfoRow
        icon="rublesign.circle"
        label="Взнос"
        value={fee > 0 ? `${formatMoney(fee)}${players > 0 ? ` · сбор ${formatMoney(fee * players)}` : ''}` : 'Без взноса'}
      />
      {costs.map((c) => (
        <InfoRow key={c.label} icon={c.icon} label={c.label} value={formatMoney(c.amount)} />
      ))}
      {event.comment ? <InfoRow icon="text.bubble" label="Комментарий" value={event.comment} multiline /> : null}
    </GlassCard>
  );
}

/** «Фикс · 25 000 ₽», «Пакет по часам · 3 ч · 6 000 ₽», «По ставке зоны — аренда по факту». */
function paymentText(event: EventRow, base: number): string {
  if (event.billingMode === 'rental') return `${BILLING_LABEL.rental} — аренда по факту в чеке`;
  const hours = event.billingMode === 'hourly' && event.plannedHours ? ` · ${event.plannedHours} ч` : '';
  return `${BILLING_LABEL[event.billingMode] ?? 'Сумма'}${hours} · ${formatMoney(base)}`;
}

/** Такси Яндекса до адреса: по координатам точнее, без них — поиском по адресу. */
async function openTaxi(address: string): Promise<void> {
  const coords = await api
    .get<{ lat?: number; lon?: number }>(`/geo/geocode?text=${encodeURIComponent(address)}`)
    .catch(() => ({}) as { lat?: number; lon?: number });
  const url =
    coords.lat !== undefined && coords.lon !== undefined
      ? `https://3.redirect.appmetrica.yandex.com/route?end-lat=${coords.lat}&end-lon=${coords.lon}&ref=titanhub&appmetrica_tracking_id=1178268795219780156`
      : `https://yandex.ru/maps/?rtext=~${encodeURIComponent(address)}&rtt=taxi`;
  void Linking.openURL(url);
}

const styles = StyleSheet.create({
  card: { padding: space.lg, gap: space.md },
});
