import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { BarChart } from '@/components/charts/bar-chart';
import { Text } from '@/components/text';
import { tierLook, type ClientTierRow } from '@/lib/clients-api';
import { formatMoney } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { useAccrualPreview, WEEKDAYS, type LoyaltyOverview } from '@/lib/loyalty-api';
import { colors, radius, space, type } from '@/lib/theme';

/**
 * Общие части экранов «Лояльность»: пульс программы, калькулятор начисления и дни недели.
 * Рисуются RN-вью внутри SwiftUI-формы (RNHostView), как карточка профиля в «Управлении».
 */

const ACCRUED = '#FF9500';
const SPENT = '#AF52DE';
const fmt = (n: number) => Math.round(n).toLocaleString('ru');

/** Дни недели чипами: ничего не выбрано — любой день. */
export function WeekdayChips({ value, onChange }: { value: number[]; onChange: (next: number[]) => void }) {
  return (
    <View style={styles.weekWrap}>
      <Text style={[type.footnote, styles.secondary]}>{value.length ? 'Дни недели' : 'Любой день недели'}</Text>
      <View style={styles.weekRow}>
        {WEEKDAYS.map((label, i) => {
          const day = i + 1;
          const on = value.includes(day);
          return (
            <Pressable
              key={label}
              onPress={() => {
                haptic.selection();
                onChange(on ? value.filter((x) => x !== day) : [...value, day].sort((a, b) => a - b));
              }}
              style={[styles.chip, on && styles.chipOn]}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}>
              <Text style={[type.subhead, on ? styles.chipTextOn : styles.chipText]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** Выбор из коротких вариантов чипами (период, сумма чека, статус). */
export function ChoiceChips<T extends string | number>({ options, value, onChange }: { options: { key: T; label: string }[]; value: T; onChange: (next: T) => void }) {
  return (
    <View style={styles.choiceRow}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <Pressable
            key={String(o.key)}
            onPress={() => {
              haptic.selection();
              onChange(o.key);
            }}
            style={[styles.choice, on && styles.chipOn]}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}>
            <Text style={[type.footnote, on ? styles.chipTextOn : styles.chipText]} numberOfLines={1}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const PERIODS = [
  { key: 7, label: '7 дней' },
  { key: 30, label: '30 дней' },
  { key: 90, label: '90 дней' },
];

/**
 * Пульс программы: сколько бонусов на счетах у гостей, выдано и потрачено за период,
 * что сгорит в ближайший месяц, сколько дали скидки; график «выдано по дням».
 */
export function LoyaltyPulse({ data, days, onDays }: { data: LoyaltyOverview | undefined; days: number; onDays: (days: number) => void }) {
  const [selected, setSelected] = useState<string | null>(null);
  const daily = data?.daily ?? [];
  const day = selected ? daily.find((d) => d.day === selected) : null;
  const points = daily.map((d) => ({ key: d.day, label: `${Number(d.day.slice(8, 10))}`, value: d.accrued }));
  const b = data?.bonus;

  return (
    <View style={styles.pulse}>
      <View>
        <Text style={[type.footnote, styles.secondary]}>{day ? `${Number(day.day.slice(8, 10))}.${day.day.slice(5, 7)}` : 'Бонусов на счетах гостей'}</Text>
        <Text style={[type.largeTitle, type.amount]} numberOfLines={1} adjustsFontSizeToFit>
          {day ? `+${fmt(day.accrued)}` : b ? fmt(b.balance) : '—'}
        </Text>
        <Text style={[type.footnote, styles.secondary]} numberOfLines={1}>
          {day ? `выдано · потрачено ${fmt(day.spent)}` : b ? `у ${fmt(b.holders)} гостей · 1 бонус = 1 ₽` : 'Загружаем…'}
        </Text>
      </View>

      {points.length > 0 && <BarChart points={points} color={ACCRUED} selected={selected} onSelect={setSelected} height={72} />}

      <View style={styles.tiles}>
        <Tile label="Выдано" value={b ? `+${fmt(b.accrued)}` : '—'} color={ACCRUED} />
        <Tile label="Потрачено" value={b ? fmt(b.spent) : '—'} color={SPENT} />
        <Tile label="Скидки" value={data ? formatMoney(data.discounts.total) : '—'} color="#FF2D55" />
      </View>
      {b && (b.expiringSoon > 0 || b.expired > 0) ? (
        <Text style={[type.footnote, styles.secondary]}>
          {[b.expiringSoon > 0 ? `Сгорит в ближайшие 30 дней: ${fmt(b.expiringSoon)}` : null, b.expired > 0 ? `сгорело за период: ${fmt(b.expired)}` : null].filter(Boolean).join(' · ')}
        </Text>
      ) : null}
      <ChoiceChips options={PERIODS} value={days} onChange={onDays} />
    </View>
  );
}

function Tile({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={styles.tile} accessible accessibilityLabel={`${label}: ${value}`}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={[type.caption1, styles.secondary]} numberOfLines={1}>
        {label}
      </Text>
      <Text style={[type.headline, type.amount]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
    </View>
  );
}

const AMOUNTS = [
  { key: 500, label: '500 ₽' },
  { key: 1000, label: '1 000 ₽' },
  { key: 3000, label: '3 000 ₽' },
  { key: 10000, label: '10 000 ₽' },
];

/**
 * Калькулятор «что получит гость»: сумма чека и статус → бонусы прямо сейчас, по тем же
 * настройкам и правилам, что у кассы. Помогает проверить правило, не проводя чек.
 */
export function BonusCalculator({ tiers }: { tiers: ClientTierRow[] | undefined }) {
  const [amount, setAmount] = useState(1000);
  const [tier, setTier] = useState<string | null>(null);
  const [firstVisit, setFirstVisit] = useState(false);
  const activeTier = tier ?? tiers?.[0]?.key ?? 'guest';
  const preview = useAccrualPreview({ amount, tier: activeTier, categoryId: null, firstVisit });
  const total = (preview.data?.amount ?? 0) + (preview.data?.welcome ?? 0);

  return (
    <View style={styles.calc}>
      <Text style={[type.footnote, styles.secondary]}>Что получит гость сейчас</Text>
      <View style={styles.calcResult}>
        <Text style={[type.title1, type.amount, { color: ACCRUED }]}>{preview.data ? `+${fmt(total)}` : '…'}</Text>
        <Text style={[type.subhead, styles.secondary]}>бонусов</Text>
      </View>
      <Text style={[type.footnote, styles.secondary]} numberOfLines={2}>
        {preview.data
          ? [preview.data.reason || 'Бонусы не начисляются', preview.data.welcome ? `+${fmt(preview.data.welcome)} приветственных` : null].filter(Boolean).join(' · ')
          : ' '}
      </Text>
      <ChoiceChips options={AMOUNTS} value={amount} onChange={setAmount} />
      {tiers && tiers.length > 0 ? (
        <ChoiceChips options={tiers.slice(0, 4).map((t) => ({ key: t.key, label: tierLook(t.key, tiers).label }))} value={activeTier} onChange={setTier} />
      ) : null}
      <ChoiceChips
        options={[
          { key: 'repeat', label: 'Постоянный гость' },
          { key: 'first', label: 'Первый визит' },
        ]}
        value={firstVisit ? 'first' : 'repeat'}
        onChange={(v) => setFirstVisit(v === 'first')}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  secondary: { color: colors.secondaryLabel },
  weekWrap: { gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.sm },
  weekRow: { flexDirection: 'row', gap: 6 },
  chip: { flex: 1, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.fill },
  chipOn: { backgroundColor: colors.accent },
  chipText: { color: colors.label },
  chipTextOn: { color: 'white', fontWeight: '600' },
  choiceRow: { flexDirection: 'row', gap: 6 },
  choice: { flex: 1, minHeight: 32, paddingHorizontal: 6, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.fill },
  pulse: { gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md },
  tiles: { flexDirection: 'row', gap: space.sm },
  tile: { flex: 1, gap: 2, padding: space.md, borderRadius: radius.control, backgroundColor: colors.fill },
  dot: { width: 8, height: 8, borderRadius: 4, marginBottom: 2 },
  calc: { gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.md },
  calcResult: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm },
});
