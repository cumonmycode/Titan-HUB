import { DatePicker, Form, HStack, Picker, Section, Spacer, Text } from '@expo/ui/swift-ui';
import { font, monospacedDigit, pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';

import { EditorToolbar } from '@/components/editor-toolbar';
import { ActionRow, FieldRow, FormHost, InputRow, LinkRow, primary, secondary } from '@/components/native-form';
import { useDebounced } from '@/components/player-picker';
import { fromDateTime, toDateString } from '@/lib/events-api';
import { formatMoney } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import {
  createExpenses,
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_CHOICES,
  round2,
  useExpenseCatalog,
  type ExpenseCatalogItem,
  type ExpenseCategory,
} from '@/lib/expenses-api';
import { currentBusinessDay, useBusinessDayStartHour } from '@/lib/salary-api';
import { newIdempotencyKey, parseAmount } from '@/lib/shift-api';

/** `version` пересоздаёт поля, когда название и цена подставлены из подсказки. */
type Line = { key: string; description: string; category: ExpenseCategory; price: string; qty: string; version: number };

const money = (n: number) => formatMoney(n, { kopecks: 'auto' });
let seq = 0;
const newLine = (): Line => ({ key: `expense-${++seq}`, description: '', category: 'other', price: '', qty: '1', version: 0 });

/** Новый расход клуба: дата и позиции — название с подсказками из прошлых расходов, категория, цена × количество. */
export default function ExpenseNewSheet() {
  const router = useRouter();
  // Дата по умолчанию — бизнес-день (ночной расход относится к текущей смене), как «Сегодня» в сводке.
  const startHour = useBusinessDayStartHour();
  const [date, setDate] = useState<Date>(() => fromDateTime(currentBusinessDay(startHour), '12:00'));
  const [lines, setLines] = useState<Line[]>(() => [newLine()]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [idempotencyKey] = useState(newIdempotencyKey);

  const active = lines.find((l) => l.key === activeKey);
  const catalogQuery = useDebounced(active?.description ?? '', 250);
  const catalog = useExpenseCatalog(catalogQuery);

  const update = (key: string, patch: Partial<Line>) => setLines((current) => current.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const sums = lines.map((l) => round2((parseAmount(l.price) ?? 0) * (parseAmount(l.qty) ?? 0)));
  const total = round2(sums.reduce((s, n) => s + n, 0));

  const pick = (line: Line, item: ExpenseCatalogItem) => {
    haptic.selection();
    update(line.key, {
      description: item.name,
      category: item.category === 'salary' ? 'other' : item.category,
      ...(item.unitPrice !== null ? { price: String(item.unitPrice).replace('.', ',') } : {}),
      version: line.version + 1,
    });
    setActiveKey(null);
  };

  const save = async () => {
    if (total <= 0) return Alert.alert('Добавьте хотя бы одну позицию с суммой');
    haptic.medium();
    setBusy(true);
    try {
      await createExpenses(
        toDateString(date),
        lines.map((l) => ({ category: l.category, description: l.description, unitPrice: parseAmount(l.price) ?? 0, quantity: parseAmount(l.qty) ?? 0 })),
        idempotencyKey,
      );
      haptic.success();
      router.back();
    } catch (error) {
      haptic.error();
      Alert.alert('Расход не добавлен', error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <EditorToolbar title="Новый расход" canSave={total > 0} busy={busy} saveLabel="Добавить" onSave={() => void save()} />
      <FormHost>
        <Form>
          <Section>
            <DatePicker title="Дата расхода" selection={date} displayedComponents={['date']} range={{ end: new Date() }} onDateChange={setDate} />
          </Section>

          {lines.map((line, index) => {
            const suggestions = activeKey === line.key && catalogQuery.trim().length >= 2 ? (catalog.data ?? []).slice(0, 5) : [];
            return (
              <Section key={line.key} title={lines.length > 1 ? `Позиция ${index + 1}` : 'Позиция'}>
                <FieldRow
                  key={`${line.key}-name-${line.version}`}
                  value={line.description}
                  placeholder="Название — например, «Салфетки»"
                  onChange={(text) => {
                    setActiveKey(line.key);
                    update(line.key, { description: text });
                  }}
                />
                {suggestions.map((item) => (
                  <LinkRow
                    key={item.name}
                    icon={EXPENSE_CATEGORIES[item.category].symbol}
                    color={EXPENSE_CATEGORIES[item.category].color}
                    title={item.name}
                    value={item.unitPrice !== null ? money(item.unitPrice) : undefined}
                    chevron={false}
                    onPress={() => pick(line, item)}
                  />
                ))}
                <Picker
                  label="Категория"
                  selection={line.category}
                  onSelectionChange={(value) => {
                    haptic.selection();
                    update(line.key, { category: value as ExpenseCategory });
                  }}
                  modifiers={[pickerStyle('menu')]}
                >
                  {EXPENSE_CATEGORY_CHOICES.map((category) => (
                    <Text key={category} modifiers={[tag(category)]}>
                      {EXPENSE_CATEGORIES[category].label}
                    </Text>
                  ))}
                </Picker>
                <InputRow
                  key={`${line.key}-price-${line.version}`}
                  label="Цена, ₽"
                  value={line.price}
                  placeholder="0"
                  keyboard="decimal-pad"
                  onChange={(text) => update(line.key, { price: text })}
                />
                <InputRow
                  key={`${line.key}-qty-${line.version}`}
                  label="Количество"
                  value={line.qty}
                  placeholder="1"
                  keyboard="decimal-pad"
                  onChange={(text) => update(line.key, { qty: text })}
                />
                <HStack>
                  <Text modifiers={[secondary]}>Сумма</Text>
                  <Spacer />
                  <Text modifiers={[primary, monospacedDigit(), font({ weight: 'semibold' })]}>{sums[index]! > 0 ? money(sums[index]!) : '—'}</Text>
                </HStack>
                {lines.length > 1 ? (
                  <ActionRow
                    title="Убрать позицию"
                    icon="minus.circle"
                    destructive
                    onPress={() => setLines((current) => current.filter((l) => l.key !== line.key))}
                  />
                ) : null}
              </Section>
            );
          })}

          <Section footer={<Text>Зарплата сюда не входит — её выдают в разделе «Зарплата».</Text>}>
            <ActionRow title="Добавить позицию" icon="plus.circle" onPress={() => setLines((current) => [...current, newLine()])} />
            <HStack>
              <Text modifiers={[primary, font({ weight: 'semibold' })]}>Итого</Text>
              <Spacer />
              <Text modifiers={[primary, monospacedDigit(), font({ textStyle: 'title3', weight: 'bold', design: 'rounded' })]}>{money(total)}</Text>
            </HStack>
          </Section>
        </Form>
      </FormHost>
    </>
  );
}
