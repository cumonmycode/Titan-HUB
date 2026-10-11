import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, View, type PressableProps } from 'react-native';
import type { SFSymbol } from 'sf-symbols-typescript';

import { GlassView } from '@/components/glass';
import { Text } from '@/components/text';
import { dayNumber, durationText, eventMinutes, eventTitle, MINICAP_MAX_PLAYERS, monthShort, STATUS_LOOK, timeRange, type EventRow } from '@/lib/events-api';
import { formatMoney, toNumber } from '@/lib/format';
import { FONT_SCALE_MAX, useTextLayout } from '@/lib/text-scale';
import { colors, radius, space, type } from '@/lib/theme';

/** Что стоит слева: время начала (лента предстоящих) или число и месяц (прошедшие). */
export type EventCardLead = 'time' | 'date';

type EventCardProps = {
  event: EventRow;
  base: number;
  /** Зона клуба или адрес выезда. */
  place: string | null;
  lead?: EventCardLead;
} & PressableProps;

/**
 * Карточка мероприятия в ленте — две строки и время слева. Первая: точка статуса, значок
 * выезда или миникапа, название. Вторая: где, сколько длится и на какую сумму. Заказчик,
 * комментарий и действия — на экране мероприятия. Props Pressable пробрасываются дальше:
 * так работают `<Link asChild>` и зум-переход в экран мероприятия.
 */
export function EventCard({ event, base, place, lead = 'time', ...pressable }: EventCardProps) {
  const status = STATUS_LOOK[event.status];
  // «Увеличенный» вид и крупный текст: название и подробности — в две строки, а не обрезаются.
  const lines = useTextLayout().layout === 'regular' ? 1 : 2;
  const title = eventTitle(event);
  const icon = kindIcon(event);
  const details = detailsLine(event, base, place, lead);
  // Для VoiceOver — то, что видно слева; у прошедших время уже есть во второй строке.
  const when = lead === 'time' ? timeRange(event) : `${dayNumber(event.date)} ${monthShort(event.date)}`;

  return (
    <Pressable {...pressable} accessibilityRole="button" accessibilityLabel={[title, status.label, when, details].filter(Boolean).join(', ')}>
      <GlassView isInteractive style={[styles.card, event.status === 'cancelled' && styles.dimmed]}>
        <Lead event={event} lead={lead} />
        <View style={styles.body}>
          <View style={styles.titleRow}>
            <View style={[styles.dot, { backgroundColor: status.color }]} />
            {icon && <SymbolView name={icon} size={14} weight="semibold" tintColor={colors.secondaryLabel} />}
            <Text style={[type.headline, styles.label, styles.flex]} numberOfLines={lines}>
              {title}
            </Text>
          </View>
          {details ? (
            <Text style={[type.subhead, styles.secondary]} numberOfLines={lines}>
              {details}
            </Text>
          ) : null}
        </View>
      </GlassView>
    </Pressable>
  );
}

/** Время начала крупно, под ним конец (или длительность, если конца нет); у прошедших — число и месяц. */
function Lead({ event, lead }: { event: EventRow; lead: EventCardLead }) {
  const minutes = eventMinutes(event);
  const top = lead === 'time' ? event.startTime : dayNumber(event.date);
  const bottom = lead === 'date' ? monthShort(event.date) : event.endTime ? `–${event.endTime}` : minutes ? durationText(minutes) : null;
  return (
    <View style={styles.lead}>
      <Text style={[type.title3, type.amount, styles.label]} maxFontSizeMultiplier={FONT_SCALE_MAX.compact}>
        {top}
      </Text>
      {bottom ? (
        <Text style={[type.footnote, styles.secondary, lead === 'date' && styles.month]} maxFontSizeMultiplier={FONT_SCALE_MAX.compact}>
          {bottom}
        </Text>
      ) : null}
    </View>
  );
}

/** Значок вида: у мероприятия в клубе его нет — это вид по умолчанию. */
function kindIcon(event: EventRow): SFSymbol | null {
  if (event.format === 'minicap') return 'trophy';
  if (event.type === 'exit') return 'car';
  return null;
}

/**
 * Вторая строка: место · длительность · сумма. Длительность — только когда слева конец, а
 * не она сама; у прошедших слева дата, поэтому здесь время целиком.
 */
function detailsLine(event: EventRow, base: number, place: string | null, lead: EventCardLead): string {
  const minutes = eventMinutes(event);
  const when = lead === 'date' ? timeRange(event) : event.endTime && minutes ? durationText(minutes) : null;
  const parts = [event.format === 'minicap' ? null : place, when, amountText(event, base)];
  return parts.filter(Boolean).join(' · ');
}

function amountText(event: EventRow, base: number): string | null {
  if (event.format === 'minicap') {
    const fee = toNumber(event.participationFee);
    const players = event.playersCount !== undefined ? `${event.playersCount}/${MINICAP_MAX_PLAYERS} игроков` : null;
    return [players, fee > 0 ? `взнос ${formatMoney(fee)}` : null].filter(Boolean).join(' · ') || null;
  }
  if (event.billingMode === 'rental') return 'по ставке зоны';
  return base > 0 ? formatMoney(base) : null;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: {
    borderRadius: radius.card,
    borderCurve: 'continuous',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
    minHeight: 68,
  },
  dimmed: { opacity: 0.55 },
  lead: { minWidth: 58, alignItems: 'flex-start' },
  month: { textTransform: 'uppercase', fontWeight: '600' },
  body: { flex: 1, gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  label: { color: colors.label },
  secondary: { color: colors.secondaryLabel },
});
