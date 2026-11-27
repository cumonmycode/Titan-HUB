// Полоса долей игровых вечеров и столбики по месяцам — общие для карточки на главной
// и шторки «Игровые вечера». Без графических библиотек: обычные View с цветами вида вечера.
import { StyleSheet, Text, View } from 'react-native';

import { EVENING_COLORS, GAME_KEYS, monthGames, monthLabel, type EveningShare, type GameKey } from '@/lib/evenings';
import { plural } from '@/lib/format';
import { colors, space, type } from '@/lib/theme';
import type { Evenings } from '@/lib/types';

const BAR_HEIGHT = 72;
const MIN_SEGMENT = 0.04;

export const gamesWord = (n: number) => plural(n, 'вечер', 'вечера', 'вечеров');

/** Горизонтальная полоса: доля каждого вида вечера. selected — остальные приглушены. */
export function ShareBar({ shares, height = 10, selected }: { shares: EveningShare[]; height?: number; selected?: GameKey | null }) {
  return (
    <View
      style={[styles.shareBar, { height, borderRadius: height / 2 }]}
      accessibilityRole="image"
      accessibilityLabel={shares.map((s) => `${s.label}: ${s.count}`).join(', ')}
    >
      {shares.map((s) => (
        <View
          key={s.key}
          style={{
            flexGrow: Math.max(MIN_SEGMENT, s.share),
            backgroundColor: EVENING_COLORS[s.key],
            opacity: selected && selected !== s.key ? 0.25 : 1,
          }}
        />
      ))}
    </View>
  );
}

/** Полгода по месяцам: столбик — игровые вечера месяца, сложенные по видам. */
export function MonthBars({ months, selected }: { months: Evenings['months']; selected?: GameKey | null }) {
  const totals = months.map(monthGames);
  const max = Math.max(1, ...totals);
  return (
    <View
      style={styles.months}
      accessibilityRole="image"
      accessibilityLabel={months.map((m, i) => `${monthLabel(m.month)}: ${totals[i]} ${gamesWord(totals[i] ?? 0)}`).join(', ')}
    >
      {months.map((m, index) => (
        <View key={m.month} style={styles.month}>
          <Text style={styles.monthCount}>{totals[index] ? String(totals[index]) : ' '}</Text>
          <View style={styles.bar}>
            {totals[index] ? GAME_KEYS.filter((k) => m[k] > 0).map((k) => (
              <View
                key={k}
                style={{
                  height: (m[k] / max) * BAR_HEIGHT,
                  backgroundColor: EVENING_COLORS[k],
                  opacity: selected && selected !== k ? 0.25 : 1,
                }}
              />
            )) : <View style={styles.barEmpty} />}
          </View>
          <Text style={styles.monthLabel}>{monthLabel(m.month)}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  shareBar: { flexDirection: 'row', gap: 3, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.08)' },
  months: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm },
  month: { flex: 1, alignItems: 'center', gap: space.xs },
  monthCount: { ...StyleSheet.flatten(type.caption), color: colors.textBody, fontWeight: '700', fontVariant: ['tabular-nums'] },
  bar: {
    width: '100%', maxWidth: 34, height: BAR_HEIGHT, justifyContent: 'flex-end', gap: 2,
    borderRadius: 8, overflow: 'hidden', borderCurve: 'continuous',
  },
  barEmpty: { height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.12)' },
  monthLabel: { ...StyleSheet.flatten(type.caption), textTransform: 'capitalize' },
});
