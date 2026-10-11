import { Button, Form, Host, LabeledContent, Picker, Section, Text } from '@expo/ui/swift-ui';
import { font, foregroundStyle, monospacedDigit, pickerStyle, refreshable, tag } from '@expo/ui/swift-ui/modifiers';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';

import { PeriodMenu, PeriodSection, RankRow, StateSection } from '@/components/analytics/native';
import { methodLook, money } from '@/components/analytics/parts';
import { ActionRow, primary, secondary } from '@/components/native-form';
import { daysBetween, formatDay, useAnalyticsChecks, useAnalyticsPeriod, type AnalyticsCheck, type NetBreakdown } from '@/lib/analytics-api';
import { plural } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { useSession } from '@/lib/session';
import { colors } from '@/lib/theme';

const time = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' });
const dayTime = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' });

type Sort = 'time' | 'amount';
const PAGE = 100;

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
/** Час открытия чека по МСК — как в графике «По часам». */
const mskHour = (iso: string) => (new Date(iso).getUTCHours() + 3) % 24;

/**
 * Чеки периода: итог «от валовой выручки к чистой прибыли» (себестоимость и расходы — только
 * владельцу), фильтр по способу оплаты, сортировка и список закрытых чеков порциями;
 * тап открывает состав чека. Из графиков и Tai экран открывается сразу на нужном дне,
 * часе или способе оплаты (параметры from, to, hour, method) — общий период не меняется.
 */
export default function AnalyticsChecksScreen() {
  const router = useRouter();
  const isOwner = useSession((s) => s.user?.role === 'owner');
  const params = useLocalSearchParams<{ from?: string; to?: string; hour?: string; method?: string }>();
  const store = useAnalyticsPeriod();
  const fixed = DATE_KEY.test(params.from ?? '') && DATE_KEY.test(params.to ?? '');
  const period = fixed ? { ...store, from: params.from!, to: params.to!, days: daysBetween(params.from!, params.to!) } : store;
  const hour = params.hour !== undefined && /^\d{1,2}$/.test(params.hour) ? Number(params.hour) : null;
  const checks = useAnalyticsChecks(period.from, period.to);
  const [method, setMethod] = useState<string>(params.method || 'all');
  const [sort, setSort] = useState<Sort>('time');
  const [limit, setLimit] = useState(PAGE);

  const all = (checks.data?.checks ?? []).filter((c) => hour === null || mskHour(c.createdAt) === hour);
  const methods = [...new Set(all.flatMap((c) => c.payments.map((p) => p.method)))];
  const filtered = (method === 'all' ? all : method === 'event' ? all.filter((c) => c.linkedEventId) : all.filter((c) => c.payments.some((p) => p.method === method)))
    .slice()
    .sort((a, b) => (sort === 'amount' ? b.totalAmount - a.totalAmount : Date.parse(b.closedAt ?? b.createdAt) - Date.parse(a.closedAt ?? a.createdAt)));
  const shown = filtered.slice(0, limit);
  const filteredTotal = filtered.reduce((s, c) => s + c.totalAmount, 0);

  return (
    <>
      <Stack.Title>Чеки</Stack.Title>
      {!fixed && <PeriodMenu period={period} />}
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <Form modifiers={[refreshable(async () => void (await checks.refetch()))]}>
          {fixed ? (
            <Section>
              <Text modifiers={[font({ textStyle: 'headline' }), primary]}>
                {[
                  period.from === period.to ? formatDay(period.from, true) : `${formatDay(period.from)} — ${formatDay(period.to)}`,
                  hour !== null ? `с ${String(hour).padStart(2, '0')}:00 до ${String((hour + 1) % 24).padStart(2, '0')}:00` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            </Section>
          ) : (
            <PeriodSection period={period} />
          )}
          {!checks.data ? (
            <StateSection error={checks.error} />
          ) : (
            <>
              <Summary summary={checks.data.summary} isOwner={isOwner} />

              <Section>
                <Picker
                  label="Оплата"
                  selection={method}
                  onSelectionChange={(value) => {
                    haptic.selection();
                    setMethod(String(value));
                    setLimit(PAGE);
                  }}
                  modifiers={[pickerStyle('menu')]}>
                  <Text modifiers={[tag('all')]}>Все чеки</Text>
                  {methods.map((m) => (
                    <Text key={m} modifiers={[tag(m)]}>
                      {methodLook(m).title}
                    </Text>
                  ))}
                  <Text modifiers={[tag('event')]}>Мероприятия</Text>
                </Picker>
                <Picker selection={sort} onSelectionChange={(value) => setSort(value as Sort)} modifiers={[pickerStyle('segmented')]}>
                  <Text modifiers={[tag('time')]}>Сначала новые</Text>
                  <Text modifiers={[tag('amount')]}>Сначала крупные</Text>
                </Picker>
              </Section>

              <Section
                title={`${filtered.length} ${plural(filtered.length, ['чек', 'чека', 'чеков'])} · ${money(filteredTotal)}`}
                footer={all.length >= 1000 ? <Text>Показаны первые 1000 чеков периода — сузьте период, чтобы увидеть остальные.</Text> : undefined}>
                {shown.length === 0 ? (
                  <Text modifiers={[secondary]}>{all.length === 0 ? 'За период закрытых чеков нет' : 'Таких чеков нет'}</Text>
                ) : (
                  shown.map((check) => <CheckRow key={check.id} check={check} multiDay={period.days > 1} onPress={() => router.push({ pathname: '/analytics/check/[checkId]', params: { checkId: check.id } })} />)
                )}
                {filtered.length > shown.length && <ActionRow title={`Показать ещё ${Math.min(PAGE, filtered.length - shown.length)}`} icon="arrow.down.circle" onPress={() => setLimit((n) => n + PAGE)} />}
              </Section>
            </>
          )}
        </Form>
      </Host>
    </>
  );
}

function Summary({ summary, isOwner }: { summary: NetBreakdown; isOwner: boolean }) {
  const minus = (label: string, value: number) => (
    <LabeledContent key={label} label={label}>
      <Text modifiers={[secondary, monospacedDigit()]}>{`${value > 0 ? '−' : ''}${money(value)}`}</Text>
    </LabeledContent>
  );
  const net = summary.net ?? 0;
  return (
    <Section title="Итог за период" footer={<Text>{`${summary.checks} ${plural(summary.checks, ['чек', 'чека', 'чеков'])} · средний клубный ${money(Math.round(summary.avgCheck))}`}</Text>}>
      <LabeledContent label="Выручка валовая">
        <Text modifiers={[primary, monospacedDigit()]}>{money(summary.gross)}</Text>
      </LabeledContent>
      {minus('Возвраты', summary.refunds)}
      {isOwner ? (
        <>
          {minus('Эквайринг', summary.commission ?? 0)}
          {minus('Себестоимость', summary.cogs ?? 0)}
          {minus('Расходы', summary.opex ?? 0)}
          {minus('Зарплата', summary.salary ?? 0)}
          <LabeledContent label="Чистая прибыль">
            <Text modifiers={[font({ weight: 'bold' }), foregroundStyle(net >= 0 ? colors.green : colors.red), monospacedDigit()]}>{money(net)}</Text>
          </LabeledContent>
        </>
      ) : (
        <LabeledContent label="Выручка после возвратов">
          <Text modifiers={[font({ weight: 'bold' }), primary, monospacedDigit()]}>{money(summary.revenueNet)}</Text>
        </LabeledContent>
      )}
    </Section>
  );
}

function CheckRow({ check, multiDay, onPress }: { check: AnalyticsCheck; multiDay: boolean; onPress: () => void }) {
  const when = check.closedAt ?? check.createdAt;
  const paid = check.payments.map((p) => methodLook(p.method).title).join(' + ');
  return (
    <Button
      onPress={() => {
        haptic.selection();
        onPress();
      }}>
      <RankRow
        name={check.guestName ?? 'Гость'}
        caption={[(multiDay ? dayTime : time).format(new Date(when)), `${check.itemCount} поз.`, paid, check.linkedEventId ? 'мероприятие' : null, check.staffNickname].filter(Boolean).join(' · ')}
        value={money(check.totalAmount)}
      />
    </Button>
  );
}
