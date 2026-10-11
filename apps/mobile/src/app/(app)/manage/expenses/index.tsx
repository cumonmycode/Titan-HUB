import { Button, ContentUnavailableView, Form, HStack, Host, Picker, ProgressView, Section, Spacer, SwipeActions, Text, VStack } from '@expo/ui/swift-ui';
import { font, lineLimit, monospacedDigit, pickerStyle, refreshable, tag } from '@expo/ui/swift-ui/modifiers';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';

import { LegendRow, RankRow, share, Tile } from '@/components/analytics/native';
import { footnote, primary, RowIcon, secondary } from '@/components/native-form';
import { ToolbarButton } from '@/components/toolbar';
import { addDays } from '@/lib/analytics-api';
import { formatMoney, toNumber } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { deleteExpense, EXPENSE_CATEGORIES, useExpensesSummary, type ExpenseRow } from '@/lib/expenses-api';
import { currentBusinessDay, useBusinessDayStartHour } from '@/lib/salary-api';
import { useSession } from '@/lib/session';

type Period = 'today' | 'week' | 'month' | 'days30';

const PERIODS: { key: Period; label: string }[] = [
  { key: 'today', label: 'Сегодня' },
  { key: 'week', label: 'Неделя' },
  { key: 'month', label: 'Месяц' },
  { key: 'days30', label: '30 дней' },
];

const money = (n: number) => formatMoney(n, { kopecks: 'auto' });
const shortDate = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/** Бизнес-дни клуба (как окна на сервере): ночью «Сегодня» — это ещё вчерашняя смена. */
function rangeOf(period: Period, today: string): { from: string; to: string } {
  const to = today;
  switch (period) {
    case 'today':
      return { from: to, to };
    case 'week':
      return { from: addDays(to, -6), to };
    case 'month':
      return { from: `${to.slice(0, 8)}01`, to };
    default:
      return { from: addDays(to, -29), to };
  }
}

/**
 * «Расходы» — отдельный раздел рядом с «Зарплатой» (раньше вкладка «Склада»): итоги за
 * период, доли категорий, затраты на персонал (только владельцу — там зарплаты каждого)
 * и список операционных расходов; добавить — «+» в шапке, удалить — смахиванием.
 */
export default function ExpensesScreen() {
  const router = useRouter();
  const isOwner = useSession((s) => s.user?.role === 'owner');
  const [period, setPeriod] = useState<Period>('days30');
  const range = rangeOf(period, currentBusinessDay(useBusinessDayStartHour()));
  const summary = useExpensesSummary(range.from, range.to);
  const data = summary.data;

  const remove = (expense: ExpenseRow) =>
    Alert.alert('Удалить расход?', `${expense.description || EXPENSE_CATEGORIES[expense.category].label} · ${money(toNumber(expense.amount))}`, [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Удалить',
        style: 'destructive',
        onPress: () =>
          deleteExpense(expense.id)
            .then(() => haptic.success())
            .catch((error: unknown) => Alert.alert('Расход не удалён', error instanceof Error ? error.message : String(error))),
      },
    ]);

  const bars = data
    ? [
        ...data.categories.map((c) => ({ key: c.category, look: EXPENSE_CATEGORIES[c.category], amount: c.amount })),
        ...(isOwner && data.salary.total > 0 ? [{ key: 'salary', look: EXPENSE_CATEGORIES.salary, amount: data.salary.total }] : []),
      ].sort((a, b) => b.amount - a.amount)
    : [];
  const barsTotal = bars.reduce((sum, b) => sum + b.amount, 0);
  const staffRows = (data?.byStaff ?? []).filter((s) => s.total > 0);

  return (
    <>
      <Stack.Title>Расходы</Stack.Title>
      <Stack.Toolbar placement="right">
        <ToolbarButton icon="plus" accessibilityLabel="Добавить расход" onPress={() => router.push('/manage/expenses/new')} />
      </Stack.Toolbar>
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <Form modifiers={[refreshable(async () => void (await summary.refetch()))]}>
          <Section>
            <Picker
              selection={period}
              onSelectionChange={(value) => {
                haptic.selection();
                setPeriod(value as Period);
              }}
              modifiers={[pickerStyle('segmented')]}
            >
              {PERIODS.map((p) => (
                <Text key={p.key} modifiers={[tag(p.key)]}>
                  {p.label}
                </Text>
              ))}
            </Picker>
          </Section>

          {!data ? (
            <Section>
              {summary.isError ? (
                <ContentUnavailableView title="Нет связи" systemImage="wifi.exclamationmark" description={summary.error.message} />
              ) : (
                <ProgressView />
              )}
            </Section>
          ) : (
            <>
              <Section
                footer={
                  isOwner ? (
                    <Text>P&L — операционные расходы и зарплата. На персонал — зарплата и списания на сотрудников.</Text>
                  ) : (
                    <Text>Без зарплат — их видит только владелец.</Text>
                  )
                }
              >
                <HStack spacing={12}>
                  <Tile
                    label={isOwner ? 'Расходы (P&L)' : 'Операционные'}
                    value={money(isOwner ? data.pnlTotal : data.opexTotal)}
                    caption={isOwner ? 'расходы + зарплата' : 'без зарплат'}
                  />
                  {isOwner ? <Tile label="На персонал" value={money(data.staffTotal)} caption="зарплата + списания" /> : null}
                </HStack>
              </Section>

              <Section title="По категориям">
                {bars.length === 0 ? (
                  <Text modifiers={[secondary]}>Расходов за период нет</Text>
                ) : (
                  bars.map((bar) => (
                    <LegendRow key={bar.key} color={bar.look.color} label={bar.look.label} value={money(bar.amount)} percent={share(bar.amount, barsTotal)} />
                  ))
                )}
              </Section>

              {isOwner && staffRows.length > 0 && (
                <Section
                  title="По сотрудникам"
                  footer={
                    data.staffComp.cost > 0 ? (
                      <Text>Себестоимость списаний на персонал уже учтена в себестоимости продаж и в «Расходы (P&L)» не входит.</Text>
                    ) : undefined
                  }
                >
                  {staffRows.map((row) => (
                    <RankRow
                      key={row.staffId}
                      photo={{ name: row.nickname, url: row.photoUrl }}
                      name={row.nickname}
                      caption={[
                        row.salary > 0
                          ? `зарплата ${money(row.salary)}${row.salaryCash > 0 && row.salaryTransfer > 0 ? ` (нал ${money(row.salaryCash)} / пер ${money(row.salaryTransfer)})` : ''}`
                          : null,
                        row.compCost > 0 ? `списания ${money(row.compCost)} (${row.compChecks})` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                      value={money(row.total)}
                    />
                  ))}
                </Section>
              )}

              <Section
                title={`Операционные расходы · ${data.expenses.length}`}
                footer={
                  isOwner && data.expenses.length > 0 ? (
                    <Text>Смахните влево, чтобы удалить. Расходы мероприятий правятся в самом мероприятии.</Text>
                  ) : undefined
                }
              >
                {data.expenses.length === 0 ? (
                  <Text modifiers={[secondary]}>Расходов нет</Text>
                ) : (
                  data.expenses.map((expense) => {
                    const row = <ExpenseLine key={expense.id} expense={expense} />;
                    if (!isOwner || expense.eventId) return row;
                    return (
                      <SwipeActions key={expense.id}>
                        {row}
                        <SwipeActions.Actions edge="trailing" allowsFullSwipe={false}>
                          <Button role="destructive" label="Удалить" systemImage="trash" onPress={() => remove(expense)} />
                        </SwipeActions.Actions>
                      </SwipeActions>
                    );
                  })
                )}
              </Section>
            </>
          )}
        </Form>
      </Host>
    </>
  );
}

function ExpenseLine({ expense }: { expense: ExpenseRow }) {
  const look = EXPENSE_CATEGORIES[expense.category];
  const qty = toNumber(expense.quantity);
  const price = toNumber(expense.unitPrice);
  return (
    <HStack spacing={12}>
      <RowIcon name={look.symbol} color={look.color} />
      <VStack alignment="leading" spacing={1}>
        <Text modifiers={[primary, lineLimit(1)]}>{expense.description || look.label}</Text>
        <Text modifiers={[footnote, secondary, lineLimit(1)]}>
          {[
            shortDate.format(new Date(`${expense.expenseDate}T12:00:00Z`)).replace('.', ''),
            look.label,
            qty > 0 && price > 0 ? `${qty} × ${money(price)}` : null,
            expense.eventId ? 'мероприятие' : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      </VStack>
      <Spacer />
      <Text modifiers={[primary, monospacedDigit(), font({ weight: 'medium' })]}>{money(toNumber(expense.amount))}</Text>
    </HStack>
  );
}
