// «Игровые вечера» — статистика клиента: сколько вечеров он сыграл в клубе, какие виды
// любит (Городская, Спортивная, Настолки, Другие ивенты), последние полгода по месяцам.
// Открывается карточкой на главной. Нажатие на вид вечера подсвечивает его в полосе и
// столбиках; у «Других ивентов» раскрывается, что это были за события.
import { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { gamesWord, MonthBars, ShareBar } from '@/components/evenings';
import { GlassButton } from '@/components/glass';
import { SheetHeader, useCloseSheet } from '@/components/sheet';
import { Tap } from '@/components/tap';
import { Divider, EmptyState, IconTile, Surface } from '@/components/ui';
import { errorText } from '@/lib/api';
import { EVENING_COLORS, summarize, type EveningShare, type GameKey } from '@/lib/evenings';
import { calendarDate, plural } from '@/lib/format';
import { useEvenings } from '@/lib/queries';
import { colors, GUTTER, MAX_WIDTH, radius, space, type } from '@/lib/theme';
import type { Evenings } from '@/lib/types';

const ROW_INSET = space.lg + 12 + space.md;
const times = (n: number) => `${n} ${plural(n, 'раз', 'раза', 'раз')}`;

export default function EveningsScreen() {
  const insets = useSafeAreaInsets();
  const close = useCloseSheet();
  const query = useEvenings();
  const data = query.data;

  return (
    <View style={styles.root}>
      <SheetHeader title="Игровые вечера" onClose={close} />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space.xxl }]}>
        <View style={styles.column}>
          {data ? <Stats data={data} /> : query.isError ? (
            <EmptyState icon="offline" title="Не удалось загрузить" text={errorText(query.error)}>
              <GlassButton title="Повторить" variant="secondary" onPress={() => void query.refetch()} />
            </EmptyState>
          ) : <ActivityIndicator color={colors.lavender} style={styles.loading} />}
        </View>
      </ScrollView>
    </View>
  );
}

function Stats({ data }: { data: Evenings }) {
  const [selected, setSelected] = useState<GameKey | null>(null);
  const s = summarize(data);
  if (s.games === 0) {
    return (
      <EmptyState icon="evenings" title="Игр пока нет"
        text="Сыграйте первый вечер в клубе — здесь появится статистика: какие вечера вы любите и как часто приходите." />
    );
  }
  const toggle = (key: GameKey) => setSelected((cur) => (cur === key ? null : key));
  const firstGame = data.firstAt ? calendarDate(data.firstAt) : null;

  return (
    <>
      <View style={styles.hero} accessible accessibilityLabel={`${s.games} ${gamesWord(s.games)} в клубе`}>
        <Text style={styles.big} maxFontSizeMultiplier={1.2}>{s.games}</Text>
        <Text style={styles.heroNote}>{gamesWord(s.games)} в клубе{firstGame ? ` · с ${firstGame}` : ''}</Text>
      </View>

      <View style={styles.tiles}>
        <Tile title="Любимый" value={s.favorite?.label ?? '—'} color={s.favorite ? EVENING_COLORS[s.favorite.key] : colors.textMuted} />
        <Tile title="В этом месяце" value={`${s.thisMonth}`} color={colors.violetLight} />
        <Tile title="Последний" value={s.lastGameAt ? calendarDate(s.lastGameAt) : '—'} color={colors.cyan} />
      </View>

      <Text style={styles.section}>Какие вечера</Text>
      <Surface style={styles.group}>
        <View style={styles.barBox}>
          <ShareBar shares={s.shares} height={12} selected={selected} />
        </View>
        {s.shares.map((share) => (
          <View key={share.key}>
            <Divider inset={ROW_INSET} />
            <ShareRow share={share} selected={selected === share.key} onPress={() => toggle(share.key)} />
            {share.key === 'other' && selected === 'other' && data.others.length ? <Others others={data.others} /> : null}
          </View>
        ))}
      </Surface>

      <Text style={styles.section}>Последние полгода</Text>
      <Surface style={[styles.group, styles.monthsBox]}>
        <MonthBars months={data.months} selected={selected} />
      </Surface>
      <Text style={styles.footer}>Игровой вечер — вечер в клубе с игрой по тарифу или мероприятие. Считается после закрытия чека.</Text>
    </>
  );
}

function Tile({ title, value, color }: { title: string; value: string; color: string }) {
  return (
    <Surface style={styles.tile}>
      <Text style={styles.tileTitle} numberOfLines={1}>{title}</Text>
      <Text style={[styles.tileValue, { color }]} numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={1.2}>{value}</Text>
    </Surface>
  );
}

function ShareRow({ share, selected, onPress }: { share: EveningShare; selected: boolean; onPress: () => void }) {
  const color = EVENING_COLORS[share.key];
  const pct = Math.round(share.share * 100);
  return (
    <Tap onPress={onPress} scaleTo={0.99} accessibilityRole="button" accessibilityState={{ selected }}
      accessibilityLabel={`${share.label}: ${times(share.count)}, ${pct}%`}
      style={[styles.row, selected && styles.rowSelected]}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <View style={styles.flex}>
        <Text style={type.headline} numberOfLines={1}>{share.label}</Text>
        {share.lastAt ? <Text style={type.caption}>последний раз {calendarDate(share.lastAt)}</Text> : null}
      </View>
      <Text style={styles.pct}>{pct}%</Text>
      <Text style={[styles.count, { color }]}>{share.count}</Text>
    </Tap>
  );
}

function Others({ others }: { others: Evenings['others'] }) {
  return (
    <View style={styles.others}>
      {others.map((o) => (
        <View key={o.label} style={styles.otherRow}>
          <IconTile name="sparkles" color={colors.pink} size={26} />
          <Text style={[type.callout, styles.flex]} numberOfLines={1}>{o.label}</Text>
          <Text style={type.caption}>{times(o.count)}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  content: { paddingHorizontal: GUTTER },
  column: { width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center' },
  loading: { marginTop: space.xxxl },
  hero: { alignItems: 'center', paddingTop: space.sm, paddingBottom: space.xl },
  big: { color: colors.text, fontSize: 64, lineHeight: 72, fontWeight: '800', letterSpacing: -1.5, fontVariant: ['tabular-nums'] },
  heroNote: { ...StyleSheet.flatten(type.callout), color: colors.textSecondary, textAlign: 'center' },
  tiles: { flexDirection: 'row', gap: space.sm },
  tile: { flex: 1, paddingVertical: space.md, paddingHorizontal: space.md, borderRadius: radius.row, gap: 2 },
  tileTitle: { ...StyleSheet.flatten(type.caption) },
  tileValue: { fontSize: 17, lineHeight: 22, fontWeight: '800' },
  section: { ...StyleSheet.flatten(type.overline), marginTop: space.xxl, marginBottom: space.sm, marginLeft: space.lg },
  group: { borderRadius: radius.card, overflow: 'hidden' },
  barBox: { padding: space.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md },
  rowSelected: { backgroundColor: 'rgba(255,255,255,0.04)' },
  dot: { width: 12, height: 12, borderRadius: 6 },
  pct: { ...StyleSheet.flatten(type.caption), fontVariant: ['tabular-nums'] },
  count: { fontSize: 18, fontWeight: '800', minWidth: 28, textAlign: 'right', fontVariant: ['tabular-nums'] },
  others: { paddingHorizontal: space.lg, paddingBottom: space.md, gap: space.sm },
  otherRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingLeft: ROW_INSET - space.lg },
  monthsBox: { padding: space.lg },
  footer: { ...StyleSheet.flatten(type.caption), marginTop: space.sm, marginHorizontal: space.lg },
});
