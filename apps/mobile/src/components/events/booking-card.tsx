import { SymbolView } from 'expo-symbols';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { GlassCard } from '@/components/new-check-parts';
import { Text } from '@/components/text';
import { formatMskDateTime, parsePgTimestamp, type BookingRequest } from '@/lib/events-api';
import { useTextLayout } from '@/lib/text-scale';
import { colors, space, type } from '@/lib/theme';

/**
 * Заявка на бронь с сайта: что, когда, где и кто — и два решения. Подтверждённая заявка
 * становится мероприятием, его детали уточняют уже в форме.
 */
export function BookingCard({ booking, busy, onConfirm, onReject }: { booking: BookingRequest; busy: boolean; onConfirm: () => void; onReject: () => void }) {
  // Очень крупный текст: кнопки друг под другом, иначе подписи не помещаются.
  const { stacked } = useTextLayout();
  const startsAt = parsePgTimestamp(booking.starts_at);
  const hours = booking.tariff_hours ?? (booking.duration_hours ? Number(booking.duration_hours) : null);
  const where = booking.location === 'exit' ? (booking.address ?? 'Выезд') : (booking.zone_name ?? 'Клуб');
  const when = [formatMskDateTime(startsAt), hours ? `${hours} ч` : null, booking.guests ? `${booking.guests} гостей` : null].filter(Boolean).join(' · ');

  return (
    <GlassCard style={styles.card}>
      <View style={styles.top}>
        <SymbolView name={booking.location === 'exit' ? 'car' : 'building.2'} size={15} weight="semibold" tintColor={colors.secondaryLabel} />
        <Text style={[type.headline, styles.label, styles.flex]} numberOfLines={2}>
          {booking.title || booking.name}
        </Text>
      </View>
      <Text style={[type.subhead, styles.label]}>{when}</Text>
      <Text style={[type.footnote, styles.secondary]} numberOfLines={2}>
        {`${where} · ${booking.name} · ${booking.phone}`}
      </Text>
      {booking.comment ? (
        <Text style={[type.footnote, styles.tertiary]} numberOfLines={3}>
          {booking.comment}
        </Text>
      ) : null}
      <View style={[styles.buttons, stacked && styles.buttonsStacked]}>
        <Pressable
          disabled={busy}
          onPress={onReject}
          style={({ pressed }) => [styles.button, !stacked && styles.flex, styles.reject, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityState={{ disabled: busy }}>
          <Text style={[type.subhead, styles.rejectText]}>Отклонить</Text>
        </Pressable>
        <Pressable
          disabled={busy}
          onPress={onConfirm}
          style={({ pressed }) => [styles.button, !stacked && styles.flex, styles.confirm, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityState={{ disabled: busy, busy }}>
          {busy ? <ActivityIndicator color="white" /> : <SymbolView name="checkmark" size={13} weight="bold" tintColor="white" />}
          <Text style={[type.subhead, styles.confirmText]}>Подтвердить</Text>
        </Pressable>
      </View>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  label: { color: colors.label },
  secondary: { color: colors.secondaryLabel },
  tertiary: { color: colors.tertiaryLabel },
  card: { padding: space.lg, gap: 4 },
  top: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  buttons: { flexDirection: 'row', gap: space.sm, marginTop: space.sm },
  buttonsStacked: { flexDirection: 'column-reverse' },
  button: {
    minHeight: 40,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    borderRadius: 12,
    borderCurve: 'continuous',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  reject: { backgroundColor: colors.fill },
  rejectText: { color: colors.red, fontWeight: '600' },
  confirm: { backgroundColor: colors.accent },
  confirmText: { color: 'white', fontWeight: '600' },
  pressed: { opacity: 0.7 },
});
