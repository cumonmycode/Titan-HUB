import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { ShareChart, type SharePart } from '@/components/charts/donut-chart';
import { Text } from '@/components/text';
import { api } from '@/lib/api';
import { plural } from '@/lib/format';
import { useClubKey } from '@/lib/queries';
import { colors, space, type } from '@/lib/theme';

/** Вид визита — как считает сервер (lib/clientAttendance.ts). */
type AttendanceKey = 'city' | 'sport' | 'board' | 'other' | 'none';

type Attendance = {
  total: number;
  firstAt: string | null;
  lastAt: string | null;
  categories: { key: AttendanceKey; label: string; count: number; lastAt: string | null }[];
  others: { label: string; count: number }[];
  months: ({ month: string } & Record<AttendanceKey, number>)[];
};

/** Свой цвет у каждого вида вечера — одинаковый в кольце, легенде и полосках по месяцам. */
const COLORS: Record<AttendanceKey, string> = {
  city: '#FF9500',
  sport: '#5856D6',
  board: '#34C759',
  other: '#FF2D55',
  none: '#8E8E93',
};
const ORDER: AttendanceKey[] = ['city', 'sport', 'board', 'other', 'none'];
const BAR_HEIGHT = 64;

const dayMonth = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: 'Europe/Moscow' });
const monthShort = new Intl.DateTimeFormat('ru-RU', { month: 'short', timeZone: 'UTC' });
const visits = (n: number) => `${n} ${plural(n, ['раз', 'раза', 'раз'])}`;
const monthLabel = (month: string) => monthShort.format(new Date(`${month}-01T00:00:00Z`)).replace('.', '');

function useAttendance(clientId: string) {
  const club = useClubKey();
  return useQuery({
    queryKey: [club, 'clients', clientId, 'attendance'],
    queryFn: () => api.get<Attendance>(`/clients/${clientId}/attendance`),
  });
}

/**
 * «Вечера и мероприятия» в карточке клиента: кольцо — на какие вечера он ходит
 * (Городская, Спортивная, Настолки, Другие ивенты, Без вечера) и сколько раз, под ним —
 * последние полгода по месяцам. Тап по «Другим ивентам» раскрывает, что это были за
 * события (Хэллоуин, Новый год, день рождения…).
 */
export function ClientAttendanceCard({ clientId }: { clientId: string }) {
  const attendance = useAttendance(clientId);
  const [selected, setSelected] = useState<string | null>(null);
  const data = attendance.data;

  if (!data) {
    return (
      <Section title="Вечера и мероприятия">
        <View style={styles.loading}>{attendance.isError ? <Text style={[type.footnote, styles.secondary]}>Не загрузилось</Text> : <ActivityIndicator />}</View>
      </Section>
    );
  }

  if (data.total === 0) {
    return (
      <Section title="Вечера и мероприятия">
        <Text style={[type.subhead, styles.secondary, styles.empty]}>Закрытых чеков пока нет — диаграмма появится после первого визита.</Text>
      </Section>
    );
  }

  const parts: SharePart[] = data.categories
    .filter((c) => c.count > 0)
    .map((c) => ({ key: c.key, label: c.label, value: c.count, color: COLORS[c.key], caption: c.lastAt ? `последний раз ${dayMonth.format(new Date(c.lastAt))}` : undefined }));
  const footer = data.firstAt
    ? `Всего ${visits(data.total)} с ${dayMonth.format(new Date(data.firstAt))}. Визит — вечер с закрытым чеком; «Без вечера» — покупка без игры.`
    : undefined;

  return (
    <Section title="Вечера и мероприятия" footer={footer}>
      <View style={styles.body}>
        <ShareChart parts={parts} selected={selected} onSelect={setSelected} format={(n) => String(n)} totalLabel="визитов" />
        {selected === 'other' && data.others.length > 0 ? (
          <View style={styles.others}>
            {data.others.map((o) => (
              <View key={o.label} style={styles.otherRow}>
                <Text style={[type.footnote, styles.label, styles.flex]} numberOfLines={1}>
                  {o.label}
                </Text>
                <Text style={[type.footnote, styles.secondary]}>{visits(o.count)}</Text>
              </View>
            ))}
          </View>
        ) : null}
        <MonthBars months={data.months} selected={selected as AttendanceKey | null} />
      </View>
    </Section>
  );
}

/** Полгода по месяцам: столбик — визиты месяца, сложенные по видам вечера. */
function MonthBars({ months, selected }: { months: Attendance['months']; selected: AttendanceKey | null }) {
  const totals = months.map((m) => ORDER.reduce((s, k) => s + m[k], 0));
  const max = Math.max(1, ...totals);
  return (
    <View style={styles.months} accessibilityRole="image" accessibilityLabel={months.map((m, i) => `${monthLabel(m.month)}: ${totals[i]}`).join(', ')}>
      {months.map((m, index) => (
        <View key={m.month} style={styles.month}>
          <Text style={[type.caption2, styles.secondary]}>{totals[index] ? String(totals[index]) : ' '}</Text>
          <View style={styles.bar}>
            {ORDER.filter((k) => m[k] > 0).map((k) => (
              <View key={k} style={{ height: (m[k] / max) * BAR_HEIGHT, backgroundColor: COLORS[k], opacity: selected && selected !== k ? 0.25 : 1 }} />
            ))}
          </View>
          <Text style={[type.caption2, styles.secondary]}>{monthLabel(m.month)}</Text>
        </View>
      ))}
    </View>
  );
}

function Section({ title, footer, children }: { title: string; footer?: string; children: ReactNode }) {
  return (
    <View style={styles.group}>
      <Text style={[type.footnote, styles.groupTitle]}>{title}</Text>
      <View style={styles.card}>{children}</View>
      {footer ? <Text style={[type.footnote, styles.footer]}>{footer}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: 6 },
  groupTitle: { color: colors.secondaryLabel, textTransform: 'uppercase', paddingHorizontal: space.lg },
  card: { backgroundColor: colors.card, borderRadius: 14, borderCurve: 'continuous', overflow: 'hidden' },
  footer: { color: colors.secondaryLabel, paddingHorizontal: space.lg },
  body: { padding: space.lg, gap: space.lg },
  loading: { padding: space.xl, alignItems: 'center' },
  empty: { padding: space.lg },
  label: { color: colors.label },
  secondary: { color: colors.secondaryLabel },
  flex: { flex: 1, minWidth: 0 },
  others: { gap: 4, padding: space.md, borderRadius: 12, borderCurve: 'continuous', backgroundColor: colors.fill },
  otherRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  months: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    paddingTop: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
  },
  month: { flex: 1, alignItems: 'center', gap: 4 },
  bar: { width: 18, height: BAR_HEIGHT, borderRadius: 6, borderCurve: 'continuous', overflow: 'hidden', justifyContent: 'flex-end', backgroundColor: colors.fill },
});
