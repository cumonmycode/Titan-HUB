import { SymbolView } from 'expo-symbols';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Text } from '@/components/text';
import { dayLabel, eventKind, eventTitle, STATUS_LOOK, timeRange, type EventRow } from '@/lib/events-api';
import { FONT_SCALE_MAX } from '@/lib/text-scale';
import { colors, space, type } from '@/lib/theme';

/**
 * Шапка мероприятия: вид, название, день и время, статус. Время мероприятия показано только
 * здесь. `busy` — статус меняется прямо сейчас (действие из меню «…»).
 */
export function EventHero({ event, busy }: { event: EventRow; busy: boolean }) {
  const kind = eventKind(event);
  const status = STATUS_LOOK[event.status];
  return (
    <View style={styles.hero}>
      {/* Без своего названия заголовок и так «Выезд» или «Миникап» — второй раз вид не пишем. */}
      {event.title ? (
        <View style={styles.kind}>
          <SymbolView name={kind.symbol} size={12} weight="semibold" tintColor={colors.secondaryLabel} />
          <Text style={[type.footnote, styles.kindText]} maxFontSizeMultiplier={FONT_SCALE_MAX.compact}>
            {kind.label}
          </Text>
        </View>
      ) : null}
      <Text style={[type.title1, styles.label, styles.centered]} accessibilityRole="header">
        {eventTitle(event)}
      </Text>
      <Text style={[type.title3, styles.label, styles.centered]}>{dayLabel(event.date)}</Text>
      <Text style={[type.headline, styles.secondary]}>{timeRange(event)}</Text>
      <View style={[styles.status, { backgroundColor: `${status.color}24` }]}>
        {busy ? (
          <ActivityIndicator size="small" color={status.color} />
        ) : (
          <SymbolView name={status.symbol} size={13} weight="semibold" tintColor={status.color} />
        )}
        <Text style={[type.subhead, styles.statusText, { color: status.color }]} maxFontSizeMultiplier={FONT_SCALE_MAX.compact}>
          {status.label}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: 4, paddingTop: space.sm, paddingBottom: space.xs },
  label: { color: colors.label },
  secondary: { color: colors.secondaryLabel },
  centered: { textAlign: 'center' },
  kind: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    marginBottom: 4,
    backgroundColor: colors.fill,
  },
  kindText: { color: colors.secondaryLabel, fontWeight: '600' },
  status: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, marginTop: space.sm },
  statusText: { fontWeight: '600' },
});
