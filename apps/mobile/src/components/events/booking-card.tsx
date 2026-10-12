import { SymbolView } from 'expo-symbols';
import { ActivityIndicator, Linking, Pressable, StyleSheet, View } from 'react-native';
import type { SFSymbol } from 'sf-symbols-typescript';

import { GlassCard } from '@/components/new-check-parts';
import { Text } from '@/components/text';
import { formatMskDateTime, normalizePhone, parsePgTimestamp, type BookingRequest } from '@/lib/events-api';
import { haptic } from '@/lib/haptics';
import { useTextLayout } from '@/lib/text-scale';
import { colors, space, type } from '@/lib/theme';

/**
 * Заявка онлайн-записи с сайта: что, когда, где и кто, связь в один тап и два решения.
 * Подтверждённая заявка-мероприятие становится мероприятием, его детали уточняют уже в
 * форме. Решение уходит гостю в Telegram, если он подписался на статус.
 */
// Что значат решения для каждого вида заявки с сайта.
const LOOK = {
  event: { confirm: 'Подтвердить', reject: 'Отклонить', symbol: null },
  game: { confirm: 'Ждём', reject: 'Отклонить', symbol: 'person.badge.plus' },
  message: { confirm: 'Обработано', reject: 'Скрыть', symbol: 'envelope' },
} as const;

/** Telegram гостя из формы сайта (@ник или t.me-ссылка) → https://t.me/<ник>. */
function telegramOf(b: BookingRequest): string | null {
  const raw = typeof b.meta?.['telegram'] === 'string' ? (b.meta['telegram'] as string).trim() : '';
  const m = raw.match(/^(?:@|https?:\/\/t\.me\/)?([A-Za-z0-9_]{5,32})$/);
  return m ? `https://t.me/${m[1]}` : null;
}

function ContactChip({ icon, label, url }: { icon: SFSymbol; label: string; url: string }) {
  return (
    <Pressable
      onPress={() => {
        haptic.light();
        void Linking.openURL(url);
      }}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.chip, pressed && styles.pressed]}>
      <SymbolView name={icon} size={13} weight="semibold" tintColor={colors.accent} />
      <Text style={[type.footnote, styles.chipText]}>{label}</Text>
    </Pressable>
  );
}

export function BookingCard({ booking, busy, onConfirm, onReject }: { booking: BookingRequest; busy: boolean; onConfirm: () => void; onReject: () => void }) {
  const look = LOOK[booking.kind ?? 'event'];
  // Очень крупный текст: кнопки друг под другом, иначе подписи не помещаются.
  const { stacked } = useTextLayout();
  const startsAt = parsePgTimestamp(booking.starts_at);
  const hours = booking.tariff_hours ?? (booking.duration_hours ? Number(booking.duration_hours) : null);
  const phoneNumber = booking.phone ? normalizePhone(booking.phone) : null;
  const tg = telegramOf(booking);
  const where = booking.location === 'exit' ? (booking.address ?? 'Выезд') : (booking.zone_name ?? 'Клуб');
  const when = booking.kind === 'message'
    ? `Получено ${formatMskDateTime(startsAt)}`
    : [formatMskDateTime(startsAt), hours ? `${hours} ч` : null, booking.guests ? `${booking.guests} гостей` : null].filter(Boolean).join(' · ');

  return (
    <GlassCard style={styles.card}>
      <View style={styles.top}>
        <SymbolView name={look.symbol ?? (booking.location === 'exit' ? 'car' : 'building.2')} size={15} weight="semibold" tintColor={colors.secondaryLabel} />
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
      {(phoneNumber || tg) && (
        <View style={styles.chips}>
          {phoneNumber ? <ContactChip icon="phone.fill" label="Позвонить" url={`tel:+${phoneNumber}`} /> : null}
          {phoneNumber ? <ContactChip icon="message.fill" label="WhatsApp" url={`https://wa.me/${phoneNumber}`} /> : null}
          {tg ? <ContactChip icon="paperplane.fill" label="Telegram" url={tg} /> : null}
        </View>
      )}
      {booking.guest_follows ? (
        <Text style={[type.footnote, styles.follows]}>Гость получит ответ в Telegram</Text>
      ) : null}
      <View style={[styles.buttons, stacked && styles.buttonsStacked]}>
        <Pressable
          disabled={busy}
          onPress={onReject}
          style={({ pressed }) => [styles.button, !stacked && styles.flex, styles.reject, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityState={{ disabled: busy }}>
          <Text style={[type.subhead, styles.rejectText]}>{look.reject}</Text>
        </Pressable>
        <Pressable
          disabled={busy}
          onPress={onConfirm}
          style={({ pressed }) => [styles.button, !stacked && styles.flex, styles.confirm, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityState={{ disabled: busy, busy }}>
          {busy ? <ActivityIndicator color="white" /> : <SymbolView name="checkmark" size={13} weight="bold" tintColor="white" />}
          <Text style={[type.subhead, styles.confirmText]}>{look.confirm}</Text>
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
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.xs },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: space.md, minHeight: 32, borderRadius: 16, backgroundColor: colors.fill },
  chipText: { color: colors.label, fontWeight: '600' },
  follows: { color: colors.green },
});
