import { Button, Form, Host, LabeledContent, RNHostView, Section, Text } from '@expo/ui/swift-ui';
import { font, foregroundStyle, monospacedDigit, refreshable } from '@expo/ui/swift-ui/modifiers';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import type { SFSymbol } from 'sf-symbols-typescript';

import { Heatmap } from '@/components/analytics/heatmap';
import { PeriodMenu, PeriodSection, RankRow, share, signed, StateSection } from '@/components/analytics/native';
import { methodLook, money } from '@/components/analytics/parts';
import { BarChart, type BarPoint } from '@/components/charts/bar-chart';
import { ShareChart, type SharePart } from '@/components/charts/donut-chart';
import { secondary } from '@/components/native-form';
import { Text as RNText } from '@/components/text';
import { ToolbarButton } from '@/components/toolbar';
import {
  addDays,
  formatDay,
  PERIOD_PRESETS,
  pct,
  useAnalyticsChecks,
  useAnalyticsPeriod,
  useAnalyticsPeriodStore,
  useInsights,
  useOverview,
  useProductsAnalytics,
  useRevenueSeries,
  type AnalyticsCheck,
  type Insights,
  type NetBreakdown,
  type Overview,
  type ResolvedPeriod,
} from '@/lib/analytics-api';
import { plural, toNumber } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { MAX_CONTENT_WIDTH } from '@/lib/layout';
import { queryClient } from '@/lib/query';
import { useClubKey } from '@/lib/queries';
import { useBusinessDayStartHour } from '@/lib/salary-api';
import { useSession } from '@/lib/session';
import { openRoute } from '@/lib/tai-navigate';
import { FONT_SCALE_MAX } from '@/lib/text-scale';
import { colors, space, type, useAccentHex } from '@/lib/theme';
import { TAI_TOOLBAR_ICON } from '@/lib/tai-aura';

const WEEKDAYS = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'];
const WEEKDAYS_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const MONTHS_LONG = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];

const STRUCTURE: { key: 'bar' | 'games' | 'rental' | 'events'; label: string; color: string }[] = [
  { key: 'bar', label: 'Бар и меню', color: '#FF9500' },
  { key: 'games', label: 'Игры (тарифы)', color: '#8B5CF6' },
  { key: 'rental', label: 'Аренда зон', color: '#30B0C7' },
  { key: 'events', label: 'Мероприятия', color: '#FF2D55' },
];

type Chart = 'days' | 'hours' | 'weekdays' | 'heat' | 'structure' | 'payments' | 'year';

const time = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' });
const hh = (hour: number) => `${String(hour).padStart(2, '0')}:00`;

/**
 * Аналитика — короткий экран: период, итог с показателями (прибыль раскрывается
 * нажатием), плитки отчётов, за один день — все чеки и способы оплаты, и один блок
 * графиков с переключателем. Графики нажимаются: столбец или доля показывают точные
 * цифры и ведут в чеки именно за этот день, час или способ оплаты.
 */
export default function AnalyticsScreen() {
  const router = useRouter();
  const club = useClubKey();
  const isOwner = useSession((s) => s.user?.role === 'owner');
  const period = useAnalyticsPeriod();
  const setPreset = useAnalyticsPeriodStore((s) => s.setPreset);
  // Ссылка вида /analytics?period=days30 открывает отчёты сразу за нужный период.
  const { period: linkedPeriod } = useLocalSearchParams<{ period?: string }>();
  useEffect(() => {
    const preset = PERIOD_PRESETS.find((p) => p.key === (linkedPeriod === 'week' ? 'days7' : linkedPeriod));
    if (preset) setPreset(preset.key);
  }, [linkedPeriod, setPreset]);

  const oneDay = period.days === 1;
  const overview = useOverview(period.from, period.to);
  const series = useRevenueSeries(period.from, period.to, !oneDay);
  const insights = useInsights(period.from, period.to);
  const products = useProductsAnalytics(period.from, period.to);
  const dayChecks = useAnalyticsChecks(period.from, period.to, oneDay);
  const [showProfit, setShowProfit] = useState(false);

  const refresh = async () => {
    await queryClient.refetchQueries({ queryKey: [club, 'analytics'], type: 'active' });
  };

  const data = overview.data;

  return (
    <>
      <Stack.Title large>Аналитика</Stack.Title>
      <PeriodMenu period={period}>
        <ToolbarButton
          icon={TAI_TOOLBAR_ICON}
          iconRenderingMode="original"
          accessibilityLabel="Спросить Tai"
          onPress={() => router.push({ pathname: '/tai', params: { screen: 'analytics', from: period.from, to: period.to } })}
        />
      </PeriodMenu>

      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <Form modifiers={[refreshable(refresh)]}>
          <PeriodSection period={period} />

          {!data ? (
            <StateSection error={overview.error} />
          ) : (
            <>
              <Section>
                <RNHostView matchContents>
                  <Summary data={data} owner={isOwner} guests={insights.data?.guests} expanded={showProfit} onToggle={() => setShowProfit((v) => !v)} />
                </RNHostView>
                {isOwner && showProfit && <ProfitRows current={data.current} />}
              </Section>

              <RNHostView matchContents>
                <ReportGrid data={data} insights={insights.data} topProduct={products.data?.products[0]?.name ?? null} owner={isOwner} />
              </RNHostView>

              {oneDay && <DaySections period={period} payments={data.paymentBreakdown} checks={dayChecks.data?.checks} />}

              {insights.data && <ChartsSection period={period} insights={insights.data} series={series.data?.revenue} payments={data.paymentBreakdown} />}
            </>
          )}
        </Form>
      </Host>
    </>
  );
}

/* ─────────────────────────── Итог ─────────────────────────── */

type SummaryTile = { label: string; value: string; delta?: number; caption?: string; negative?: boolean };

/**
 * Главная цифра — выручка, под ней показатели с изменением. Владельцу первая плитка —
 * прибыль: нажатие на неё раскрывает, из чего прибыль сложилась.
 */
function Summary({
  data,
  owner,
  guests,
  expanded,
  onToggle,
}: {
  data: Overview;
  owner: boolean;
  guests?: Insights['guests'];
  expanded: boolean;
  onToggle: () => void;
}) {
  const cur = data.current;
  const delta = data.deltas.revenue;
  const net = owner && cur.net !== undefined ? cur.net : null;
  const profitTile: SummaryTile | null =
    net === null ? null : { label: net >= 0 ? 'Прибыль' : 'Убыток', value: money(net), delta: data.deltas.profit, negative: net < 0 };
  const tiles: SummaryTile[] = [
    { label: 'Чеки', value: String(cur.checks), delta: data.deltas.checks },
    { label: 'Средний чек', value: money(Math.round(cur.avgCheck)), delta: pct(Math.round(cur.avgCheck), Math.round(data.previous.avgCheck)) },
    { label: 'Гости', value: guests ? String(guests.unique) : '—', caption: guests ? `новых ${guests.new}` : undefined },
  ];
  // Без прибыли плиток три — в один ряд, а не «две и одна».
  const tileStyle = profitTile ? styles.tileHalf : styles.tileThird;
  return (
    <View style={styles.summary}>
      <View>
        <RNText style={[type.footnote, styles.caps]}>ВЫРУЧКА</RNText>
        <RNText
          style={[styles.hero, type.amount, cur.revenueNet < 0 && styles.negative]}
          numberOfLines={1}
          adjustsFontSizeToFit
          maxFontSizeMultiplier={FONT_SCALE_MAX.display}
        >
          {money(cur.revenueNet)}
        </RNText>
        <RNText style={[type.subhead, styles.secondary]} numberOfLines={1}>
          {delta ? <RNText style={{ color: delta > 0 ? colors.green : colors.red, fontWeight: '600' }}>{`${signed(delta)} `}</RNText> : null}
          {delta ? 'к прошлому такому же периоду' : `${cur.checks} ${plural(cur.checks, ['чек', 'чека', 'чеков'])} за период`}
        </RNText>
      </View>
      <View style={styles.tiles}>
        {profitTile ? (
          <Pressable
            onPress={() => (haptic.selection(), onToggle())}
            style={({ pressed }) => [tileStyle, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityState={{ expanded }}
            accessibilityHint="Показать, из чего сложилась прибыль"
          >
            <SummaryTileBody tile={profitTile} chevron={expanded ? 'chevron.up' : 'chevron.down'} />
          </Pressable>
        ) : null}
        {tiles.map((tile) => (
          <View key={tile.label} style={tileStyle}>
            <SummaryTileBody tile={tile} />
          </View>
        ))}
      </View>
    </View>
  );
}

function SummaryTileBody({ tile, chevron }: { tile: SummaryTile; chevron?: SFSymbol }) {
  return (
    <>
      <View style={styles.tileHead}>
        <RNText style={[type.caption1, styles.secondary]} numberOfLines={1}>
          {tile.label}
        </RNText>
        {chevron ? <SymbolView name={chevron} size={10} weight="semibold" tintColor={colors.tertiaryLabel} /> : null}
      </View>
      <RNText
        style={[type.title3, type.amount, tile.negative ? styles.negative : styles.label]}
        numberOfLines={1}
        adjustsFontSizeToFit
        maxFontSizeMultiplier={FONT_SCALE_MAX.compact}
      >
        {tile.value}
      </RNText>
      {tile.delta ? (
        <RNText style={[type.caption1, { color: tile.delta > 0 ? colors.green : colors.red, fontWeight: '600' }]}>{signed(tile.delta)}</RNText>
      ) : tile.caption ? (
        <RNText style={[type.caption1, styles.secondary]}>{tile.caption}</RNText>
      ) : null}
    </>
  );
}

/** Прибыль строками, как выписка, — раскрывается нажатием на итог. */
function ProfitRows({ current }: { current: NetBreakdown & { margin?: number | null } }) {
  const net = current.net ?? 0;
  const base = current.revenueNet > 0 ? current.revenueNet : 0;
  const row = (label: string, value: number) => (
    <LabeledContent key={label} label={label}>
      <Text modifiers={[secondary, monospacedDigit()]}>{`${value > 0 ? '−' : ''}${money(value)}`}</Text>
    </LabeledContent>
  );
  return (
    <>
      {row(`Себестоимость${base ? ` · ${share(current.cogs ?? 0, base)}%` : ''}`, current.cogs ?? 0)}
      {row(`Расходы и зарплата${base ? ` · ${share(current.expenses ?? 0, base)}%` : ''}`, current.expenses ?? 0)}
      {row('Эквайринг СБП', current.commission ?? 0)}
      <LabeledContent
        label={
          current.margin !== null && current.margin !== undefined
            ? `${net >= 0 ? 'Прибыль' : 'Убыток'} · маржа ${current.margin}%`
            : net >= 0
              ? 'Прибыль'
              : 'Убыток'
        }
      >
        <Text modifiers={[font({ weight: 'bold' }), foregroundStyle(net >= 0 ? colors.green : colors.red), monospacedDigit()]}>{money(net)}</Text>
      </LabeledContent>
    </>
  );
}

/* ─────────────────────────── Отчёты ─────────────────────────── */

type ReportTile = {
  path: '/analytics/checks' | '/analytics/products' | '/analytics/players' | '/analytics/events' | '/analytics/tariffs' | '/analytics/staff';
  title: string;
  value: string;
  icon: SFSymbol;
  color: string;
};

/** Отчёты плитками — сразу под итогом, с главной цифрой каждого. */
function ReportGrid({ data, insights, topProduct, owner }: { data: Overview; insights?: Insights; topProduct: string | null; owner: boolean }) {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const columns = Math.min(width, MAX_CONTENT_WIDTH) >= 360 ? 3 : 2;
  const cur = data.current;
  const tiles: ReportTile[] = [
    { path: '/analytics/checks', title: 'Чеки', value: `${cur.checks} ${plural(cur.checks, ['чек', 'чека', 'чеков'])}`, icon: 'receipt', color: '#007AFF' },
    { path: '/analytics/products', title: 'Бар', value: topProduct ? `топ: ${topProduct}` : 'ABC-анализ', icon: 'cup.and.saucer.fill', color: '#FF9500' },
    {
      path: '/analytics/players',
      title: 'Игроки',
      value: insights ? `${insights.guests.unique} ${plural(insights.guests.unique, ['гость', 'гостя', 'гостей'])}` : 'сегменты',
      icon: 'person.2.fill',
      color: '#34C759',
    },
    {
      path: '/analytics/events',
      title: 'Мероприятия',
      value: cur.eventChecks > 0 ? money(cur.eventRevenue) : 'нет за период',
      icon: 'calendar',
      color: '#AF52DE',
    },
    {
      path: '/analytics/tariffs',
      title: 'Тарифы',
      value: insights && insights.structure.games > 0 ? money(insights.structure.games) : 'игры и вечера',
      icon: 'suit.spade.fill',
      color: '#FF2D55',
    },
    ...(owner
      ? [{ path: '/analytics/staff' as const, title: 'Персонал', value: 'списания', icon: 'person.badge.key.fill' as SFSymbol, color: '#8E8E93' }]
      : []),
  ];
  return (
    <View style={styles.grid}>
      {tiles.map((tile) => (
        <Pressable
          key={tile.path}
          onPress={() => {
            haptic.selection();
            router.push(tile.path);
          }}
          style={({ pressed }) => [styles.report, { width: `${100 / columns - 2.2}%` }, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={`${tile.title}: ${tile.value}`}
        >
          <View style={[styles.reportIcon, { backgroundColor: tile.color }]}>
            <SymbolView name={tile.icon} size={15} weight="semibold" tintColor="white" />
          </View>
          <RNText style={[type.subhead, styles.label, styles.bold]} numberOfLines={1} maxFontSizeMultiplier={FONT_SCALE_MAX.compact}>
            {tile.title}
          </RNText>
          <RNText style={[type.caption1, styles.secondary]} numberOfLines={1} maxFontSizeMultiplier={FONT_SCALE_MAX.compact}>
            {tile.value}
          </RNText>
        </Pressable>
      ))}
    </View>
  );
}

/* ─────────────────────────── Один день ─────────────────────────── */

function paymentParts(breakdown: { method: string; total: string }[]): SharePart[] {
  return breakdown
    .map((b) => ({ method: b.method, value: toNumber(b.total), look: methodLook(b.method) }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value)
    .map((r) => ({ key: r.method, label: r.look.title, value: r.value, color: r.look.color }));
}

/** За день: способы оплаты и все чеки дня — каждый открывается. */
function DaySections({ period, payments, checks }: { period: ResolvedPeriod; payments: { method: string; total: string }[]; checks?: AnalyticsCheck[] }) {
  const router = useRouter();
  const [method, setMethod] = useState<string | null>(null);
  const parts = paymentParts(payments);
  const list = (checks ?? [])
    .filter((c) => !method || c.payments.some((p) => p.method === method))
    .slice()
    .sort((a, b) => Date.parse(b.closedAt ?? b.createdAt) - Date.parse(a.closedAt ?? a.createdAt));
  const total = list.reduce((s, c) => s + c.totalAmount, 0);
  return (
    <>
      {parts.length > 0 && (
        <Section title="Способы оплаты" footer={<Text>Коснитесь способа — список чеков ниже оставит только его.</Text>}>
          <RNHostView matchContents>
            <View style={styles.cellPad}>
              <ShareChart parts={parts} selected={method} onSelect={setMethod} format={(v) => money(Math.round(v))} totalLabel="Оплачено" />
            </View>
          </RNHostView>
        </Section>
      )}
      <Section
        title={
          checks
            ? `${list.length} ${plural(list.length, ['чек', 'чека', 'чеков'])} · ${money(total)}${method ? ` · ${methodLook(method).title}` : ''}`
            : 'Чеки за день'
        }
      >
        {!checks ? (
          <Text modifiers={[secondary]}>Загружаем чеки…</Text>
        ) : list.length === 0 ? (
          <Text modifiers={[secondary]}>{`${period.preset === 'today' ? 'Сегодня' : 'В этот день'} закрытых чеков нет`}</Text>
        ) : (
          list.map((check) => (
            <Button
              key={check.id}
              onPress={() => {
                haptic.selection();
                router.push({ pathname: '/analytics/check/[checkId]', params: { checkId: check.id } });
              }}
            >
              <RankRow
                name={check.guestName ?? 'Гость'}
                photo={{ name: check.guestName ?? 'Гость', url: check.playerPhoto }}
                caption={[
                  time.format(new Date(check.closedAt ?? check.createdAt)),
                  check.payments.map((p) => methodLook(p.method).title).join(' + '),
                  check.linkedEventId ? 'мероприятие' : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                value={money(check.totalAmount)}
              />
            </Button>
          ))
        )}
      </Section>
    </>
  );
}

/* ─────────────────────────── Графики ─────────────────────────── */

function ChartsSection({
  period,
  insights,
  series,
  payments,
}: {
  period: ResolvedPeriod;
  insights: Insights;
  series?: { date: string; revenue: number; count: number }[];
  payments: { method: string; total: string }[];
}) {
  const router = useRouter();
  const accent = useAccentHex();
  const startHour = useBusinessDayStartHour();
  const { width } = useWindowDimensions();
  const setCustom = useAnalyticsPeriodStore((s) => s.setCustom);
  const oneDay = period.days === 1;
  const charts: { key: Chart; label: string }[] = [
    ...(!oneDay ? [{ key: 'days' as Chart, label: 'По дням' }] : []),
    { key: 'hours', label: 'По часам' },
    ...(!oneDay
      ? [
          { key: 'weekdays' as Chart, label: 'Дни недели' },
          { key: 'heat' as Chart, label: 'Теплокарта' },
        ]
      : []),
    { key: 'structure', label: 'Структура' },
    ...(!oneDay ? [{ key: 'payments' as Chart, label: 'Оплата' }] : []),
    { key: 'year', label: '12 месяцев' },
  ];
  const [chart, setChart] = useState<Chart>(oneDay ? 'hours' : 'days');
  const current = charts.some((c) => c.key === chart) ? chart : charts[0]!.key;
  // Выбор столбца живёт, пока не сменились график или период.
  const scope = `${current}:${period.from}:${period.to}`;
  const [picked, setPicked] = useState<{ scope: string; key: string | null }>({ scope, key: null });
  const selected = picked.scope === scope ? picked.key : null;
  const setSelected = (key: string | null) => setPicked({ scope, key });

  // ── точки и подписи выбранного графика ──
  let points: BarPoint[] = [];
  let detail: string | null = null;
  let link: { label: string; onPress: () => void } | null = null;
  let hint = 'Коснитесь столбца — покажу цифры';
  let highlight: string | null = null;
  let average: number | undefined;

  if (current === 'days' && series) {
    const byDate = new Map(series.map((d) => [d.date, d]));
    const days = Array.from({ length: Math.min(period.days, 400) }, (_, i) => addDays(period.from, i));
    points = days.map((date) => ({ key: date, label: formatDay(date).replace(/\s.+$/, ''), value: Math.max(0, Math.round(byDate.get(date)?.revenue ?? 0)) }));
    const best = points.reduce((max, p) => (p.value > max.value ? p : max), points[0] ?? { key: '', label: '', value: 0 });
    highlight = best.key;
    const active = points.filter((p) => p.value > 0);
    average = active.length ? Math.round(active.reduce((s, p) => s + p.value, 0) / points.length) : undefined;
    hint = best.value > 0 ? `Лучший день — ${formatDay(best.key)}: ${money(best.value)}. В среднем ${money(average ?? 0)} в день.` : 'Выручки за период нет';
    const day = selected ? byDate.get(selected) : undefined;
    if (selected) {
      const count = day?.count ?? 0;
      detail = `${formatDay(selected, true)} · ${money(Math.round(day?.revenue ?? 0))} · ${count} ${plural(count, ['чек', 'чека', 'чеков'])}${count ? ` · средний ${money(Math.round((day?.revenue ?? 0) / count))}` : ''}`;
      link = { label: `Чеки за ${formatDay(selected)}`, onPress: () => openRoute(router, { screen: 'analytics-checks', from: selected, to: selected }) };
    }
  }

  if (current === 'hours') {
    const order = Array.from({ length: 24 }, (_, i) => (startHour + i) % 24);
    const withData = order.filter((h) => insights.hours.some((x) => x.hour === h && x.checks > 0));
    if (withData.length) {
      const hours = order.slice(order.indexOf(withData[0]!), order.indexOf(withData[withData.length - 1]!) + 1);
      points = hours.map((h) => ({
        key: String(h),
        label: String(h).padStart(2, '0'),
        value: Math.round(insights.hours.find((x) => x.hour === h)?.revenue ?? 0),
      }));
      const peak = points.reduce((max, p) => (p.value > max.value ? p : max), points[0]!);
      highlight = peak.key;
      hint = `Пик — ${hh(Number(peak.key))}–${hh((Number(peak.key) + 1) % 24)}: ${money(peak.value)}. Время — открытие чека.`;
    }
    if (selected) {
      const hour = Number(selected);
      const h = insights.hours.find((x) => x.hour === hour);
      detail = `${hh(hour)}–${hh((hour + 1) % 24)} · ${money(Math.round(h?.revenue ?? 0))} · ${h?.checks ?? 0} ${plural(h?.checks ?? 0, ['чек', 'чека', 'чеков'])}`;
      link = { label: `Чеки с ${hh(hour)}`, onPress: () => openRoute(router, { screen: 'analytics-checks', from: period.from, to: period.to, hour }) };
    }
  }

  if (current === 'weekdays') {
    points = insights.weekdays.map((d) => ({ key: String(d.dow), label: WEEKDAYS_SHORT[d.dow - 1]!, value: Math.round(d.avgRevenue) }));
    const best = insights.weekdays.reduce((max, d) => (d.avgRevenue > max.avgRevenue ? d : max), insights.weekdays[0]!);
    highlight = String(best?.dow);
    hint = best ? `Лучший день — ${WEEKDAYS[best.dow - 1]}: в среднем ${money(Math.round(best.avgRevenue))} за день.` : '';
    if (selected) {
      const d = insights.weekdays.find((x) => String(x.dow) === selected);
      if (d) detail = `${WEEKDAYS[d.dow - 1]} · в среднем ${money(Math.round(d.avgRevenue))} · таких дней ${d.days}, чеков ${d.checks}`;
    }
  }

  if (current === 'year') {
    const label = (key: string) => MONTHS[Number(key.slice(5, 7)) - 1]!;
    points = insights.months.map((m) => ({ key: m.month, label: label(m.month), value: Math.round(m.revenue) }));
    const best = insights.months.reduce((max, m) => (m.revenue > max.revenue ? m : max), insights.months[0]!);
    highlight = best?.month ?? null;
    hint =
      best && best.revenue > 0
        ? `Лучший месяц — ${MONTHS_LONG[Number(best.month.slice(5, 7)) - 1]} ${best.month.slice(0, 4)}: ${money(Math.round(best.revenue))}.`
        : '';
    if (selected) {
      const m = insights.months.find((x) => x.month === selected);
      if (m) {
        detail = `${MONTHS_LONG[Number(m.month.slice(5, 7)) - 1]} ${m.month.slice(0, 4)} · ${money(Math.round(m.revenue))} · ${m.checks} ${plural(m.checks, ['чек', 'чека', 'чеков'])}`;
        const from = `${m.month.slice(0, 7)}-01`;
        const end = addDays(`${addDays(from, 32).slice(0, 7)}-01`, -1);
        link = {
          label: `Открыть ${MONTHS_LONG[Number(m.month.slice(5, 7)) - 1]}`,
          onPress: () => (haptic.selection(), setCustom(from, end < period.today ? end : period.today)),
        };
      }
    }
  }

  const structureParts: SharePart[] = STRUCTURE.map((s) => ({ key: s.key, label: s.label, value: insights.structure[s.key], color: s.color })).filter(
    (p) => p.value > 0,
  );

  let body: ReactNode;
  if (current === 'structure') {
    body = structureParts.length ? (
      <ShareChart
        parts={structureParts}
        selected={selected}
        onSelect={setSelected}
        format={(v) => money(Math.round(v))}
        totalLabel="До скидок"
        onOpen={(key) =>
          key === 'bar'
            ? router.push('/analytics/products')
            : key === 'games'
              ? router.push('/analytics/tariffs')
              : key === 'events'
                ? router.push('/analytics/events')
                : undefined
        }
        openLabel={(part) => (part.key === 'rental' ? `Аренда зон` : `Отчёт: ${part.label}`)}
      />
    ) : (
      <RNText style={[type.subhead, styles.secondary]}>Выручки за период нет</RNText>
    );
  } else if (current === 'payments') {
    const parts = paymentParts(payments);
    body = parts.length ? (
      <ShareChart
        parts={parts}
        selected={selected}
        onSelect={setSelected}
        format={(v) => money(Math.round(v))}
        totalLabel="Оплачено"
        onOpen={(key) => openRoute(router, { screen: 'analytics-checks', from: period.from, to: period.to, method: key })}
        openLabel={(part) => `Чеки: ${part.label}`}
      />
    ) : (
      <RNText style={[type.subhead, styles.secondary]}>Оплат за период нет</RNText>
    );
  } else if (current === 'heat') {
    body = <Heatmap cells={insights.heat} startHour={startHour} width={Math.min(width, MAX_CONTENT_WIDTH) - 64} color={accent} />;
  } else {
    body = (
      <>
        <View style={styles.selection}>
          {detail ? (
            <>
              <RNText style={[type.subhead, styles.label, styles.bold]} numberOfLines={2}>
                {detail}
              </RNText>
              {link ? (
                <Pressable onPress={link.onPress} hitSlop={6} style={({ pressed }) => [styles.link, pressed && styles.pressed]} accessibilityRole="link">
                  <RNText style={[type.subhead, styles.accent]}>{link.label}</RNText>
                  <SymbolView name="chevron.right" size={11} weight="semibold" tintColor={colors.accent} />
                </Pressable>
              ) : null}
            </>
          ) : (
            <RNText style={[type.footnote, styles.secondary]} numberOfLines={2}>
              {hint}
            </RNText>
          )}
        </View>
        {points.length ? (
          <BarChart points={points} color={accent} selected={selected} onSelect={setSelected} height={170} highlightKey={highlight} average={average} />
        ) : (
          <RNText style={[type.subhead, styles.secondary]}>Данных за период нет</RNText>
        )}
      </>
    );
  }

  return (
    <Section title="Графики">
      <RNHostView matchContents>
        <View style={styles.charts}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pills}>
            {charts.map((c) => {
              const active = c.key === current;
              return (
                <Pressable
                  key={c.key}
                  onPress={() => {
                    haptic.selection();
                    setChart(c.key);
                  }}
                  style={[styles.pill, active && { backgroundColor: accent }]}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                >
                  <RNText style={[type.subhead, active ? styles.pillActive : styles.label]} maxFontSizeMultiplier={FONT_SCALE_MAX.compact}>
                    {c.label}
                  </RNText>
                </Pressable>
              );
            })}
          </ScrollView>
          {body}
        </View>
      </RNHostView>
    </Section>
  );
}

const styles = StyleSheet.create({
  summary: { paddingHorizontal: space.lg, paddingVertical: space.lg, gap: space.lg },
  tileHead: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  caps: { color: colors.secondaryLabel, fontWeight: '600' },
  hero: { fontSize: 40, lineHeight: 46, color: colors.label },
  negative: { color: colors.red },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', rowGap: space.md },
  tileHalf: { width: '50%', paddingRight: space.sm, gap: 1 },
  tileThird: { width: '33.33%', paddingRight: space.sm, gap: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: space.sm + 2 },
  report: { backgroundColor: colors.card, borderRadius: 20, borderCurve: 'continuous', padding: space.md, gap: 3, minHeight: 92 },
  reportIcon: { width: 28, height: 28, borderRadius: 8, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  cellPad: { paddingHorizontal: space.lg, paddingVertical: space.md },
  charts: { paddingHorizontal: space.lg, paddingVertical: space.md, gap: space.md },
  pills: { gap: space.sm, paddingRight: space.lg },
  pill: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 16, backgroundColor: colors.fill },
  pillActive: { color: 'white', fontWeight: '600' },
  selection: { minHeight: 42, justifyContent: 'center', gap: 2 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' },
  label: { color: colors.label },
  secondary: { color: colors.secondaryLabel },
  accent: { color: colors.accent },
  bold: { fontWeight: '600' },
  pressed: { opacity: 0.6 },
});
