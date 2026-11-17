import { SymbolView } from 'expo-symbols';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { GlassCard, sheetStyles } from '@/components/new-check-parts';
import { Text } from '@/components/text';
import { SPACE_LOOK } from '@/lib/catalog-api';
import { checkTitle } from '@/lib/checks';
import { timeRange, todayMsk, useEvents, type EventRow } from '@/lib/events-api';
import { formatMoney } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { useSpaces, type Space } from '@/lib/pos-api';
import { useChecks } from '@/lib/queries';
import { colors, space, type } from '@/lib/theme';

/**
 * Выбор зоны для аренды — в новом чеке и в открытом («пересадить»). Каждая зона говорит,
 * можно ли в неё сесть: занята открытым чеком (выбрать нельзя), свободна, но сегодня на неё
 * бронь (видно, с какого часа и чья), или свободна совсем. Брони берутся из мероприятий.
 */

export type ZoneState = {
  space: Space;
  /** Открытый чек в этой зоне (кроме текущего). */
  occupiedBy: string | null;
  /** Ближайшая сегодняшняя бронь зоны: `now` — уже должна идти. */
  booking: { event: EventRow; now: boolean } | null;
};

const mskClock = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** Бронь зоны на сегодня, которая ещё не прошла: планы и «требует уточнения». */
function todayBooking(events: EventRow[], spaceId: string): ZoneState['booking'] {
  const today = todayMsk();
  const now = mskClock.format(new Date());
  const ahead = events
    .filter((e) => e.spaceId === spaceId && e.date === today && (e.status === 'planned' || e.status === 'needs_clarification'))
    // Без конца — считаем идущей до конца дня; с концом через полночь — тоже не прошла.
    .filter((e) => !e.endTime || e.endTime > now || e.endTime < e.startTime)
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
  const first = ahead[0];
  return first ? { event: first, now: first.startTime <= now } : null;
}

export function useZoneStates(currentCheckId?: string): { zones: ZoneState[]; loading: boolean } {
  const spaces = useSpaces();
  const checks = useChecks();
  // Мероприятия видит не каждая роль — без них просто нет строки о брони.
  const events = useEvents();
  const occupant = new Map(
    (checks.data ?? []).filter((c) => c.spaceId && c.id !== currentCheckId).map((c) => [c.spaceId as string, checkTitle(c)]),
  );
  const zones = (spaces.data ?? []).map((s) => ({
    space: s,
    occupiedBy: occupant.get(s.id) ?? null,
    booking: todayBooking(events.data ?? [], s.id),
  }));
  return { zones, loading: spaces.isLoading };
}

function statusLine(zone: ZoneState): { text: string; tone: 'muted' | 'warn' | 'ok' } {
  if (zone.occupiedBy) return { text: `Занята · ${zone.occupiedBy}`, tone: 'muted' };
  const b = zone.booking;
  const who = b?.event.customerName || b?.event.title;
  if (b?.now) return { text: `Бронь сейчас · ${timeRange(b.event)}${who ? ` · ${who}` : ''}`, tone: 'warn' };
  if (b) return { text: `Свободна до ${b.event.startTime} · дальше бронь${who ? ` · ${who}` : ''}`, tone: 'warn' };
  return { text: 'Свободна', tone: 'ok' };
}

export function ZoneList({
  zones,
  loading,
  currentSpaceId,
  busySpaceId,
  onPick,
}: {
  zones: ZoneState[];
  loading: boolean;
  /** Зона, где чек уже сидит, — с галочкой. */
  currentSpaceId?: string | null;
  /** Зона, по которой идёт запрос, — с крутилкой; остальные заблокированы. */
  busySpaceId?: string | null;
  onPick: (spaceId: string) => void;
}) {
  if (loading) return <ActivityIndicator style={styles.loading} />;
  if (zones.length === 0) {
    return <Text style={[type.subhead, sheetStyles.secondary, styles.empty]}>Активных зон нет — их добавляют в «Тарифах и аренде».</Text>;
  }
  return (
    <GlassCard>
      <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
        {zones.map((zone, index) => {
          const look = SPACE_LOOK[zone.space.type] ?? SPACE_LOOK.zone;
          const current = zone.space.id === currentSpaceId;
          const locked = !!zone.occupiedBy;
          const opening = busySpaceId === zone.space.id;
          const status = current ? { text: 'Чек сейчас здесь', tone: 'muted' as const } : statusLine(zone);
          return (
            <View key={zone.space.id}>
              {index > 0 && <View style={[sheetStyles.separator, styles.separator]} />}
              <Pressable
                disabled={locked || current || !!busySpaceId}
                onPress={() => {
                  haptic.medium();
                  onPick(zone.space.id);
                }}
                style={({ pressed }) => [styles.row, pressed && sheetStyles.pressedRow]}
                accessibilityRole="button"
                accessibilityState={{ disabled: locked || current, selected: current }}
                accessibilityLabel={[zone.space.name, status.text, `${formatMoney(zone.space.hourlyRate)} в час`].join(', ')}>
                <View style={[styles.icon, { backgroundColor: locked ? colors.fill : `${look.color}26` }]}>
                  {opening ? (
                    <ActivityIndicator color={look.color} />
                  ) : (
                    <SymbolView name={locked ? 'lock.fill' : look.symbol} size={16} weight="semibold" tintColor={locked ? colors.secondaryLabel : look.color} />
                  )}
                </View>
                <View style={styles.flex}>
                  <Text style={[type.body, locked ? sheetStyles.secondary : sheetStyles.label]} numberOfLines={1}>
                    {zone.space.name}
                  </Text>
                  <Text style={[type.footnote, status.tone === 'warn' ? styles.warn : status.tone === 'ok' ? styles.ok : sheetStyles.secondary]} numberOfLines={2}>
                    {status.text}
                  </Text>
                </View>
                {current ? (
                  <SymbolView name="checkmark.circle.fill" size={22} tintColor={colors.accent} />
                ) : (
                  <Text style={[type.subhead, styles.rate]}>{`${formatMoney(zone.space.hourlyRate)}/ч`}</Text>
                )}
              </Pressable>
            </View>
          );
        })}
      </ScrollView>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, gap: 1 },
  loading: { paddingVertical: space.xxl },
  empty: { paddingVertical: space.lg, textAlign: 'center' },
  list: { maxHeight: 66 * 5.5, flexShrink: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.md, paddingVertical: space.sm, minHeight: 64 },
  icon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  separator: { marginLeft: 60 },
  rate: { color: colors.secondaryLabel, fontVariant: ['tabular-nums'] },
  warn: { color: colors.orange },
  ok: { color: colors.green },
});
