import { ContentUnavailableView, Form, Host, Picker, ProgressView, Section, Text } from '@expo/ui/swift-ui';
import { pickerStyle, refreshable, tag } from '@expo/ui/swift-ui/modifiers';
import { Stack, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';

import { ActionRow, LinkRow, SearchRow } from '@/components/native-form';
import { ToolbarButton } from '@/components/toolbar';
import { tierLook, useClientTiers } from '@/lib/clients-api';
import { useGoods } from '@/lib/goods-api';
import { haptic } from '@/lib/haptics';
import { discountSummary, discountValueText, useDiscounts, type Discount } from '@/lib/loyalty-api';

type Filter = 'all' | 'auto' | 'manual' | 'off';
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'Все' },
  { key: 'auto', label: 'Сами' },
  { key: 'manual', label: 'Кассир' },
  { key: 'off', label: 'Выкл.' },
];

const matchFilter = (d: Discount, f: Filter) =>
  f === 'all' ? true : f === 'off' ? !d.isActive : d.isActive && (f === 'auto' ? d.isAuto : !d.isAuto);

/**
 * Скидки и акции списком с фильтром и поиском. У каждой свои условия: на что, кому, когда,
 * от какой суммы. «Сами» — ложатся на чек автоматически, «Кассир» — выбираются в кассе.
 */
export default function DiscountsScreen() {
  const router = useRouter();
  const discounts = useDiscounts();
  const tiers = useClientTiers();
  const goods = useGoods();
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');

  const names = useMemo(
    () => ({
      tier: (key: string) => tierLook(key, tiers.data).label,
      category: (id: string) => goods.data?.categories.find((c) => c.id === id)?.name ?? 'категория',
    }),
    [tiers.data, goods.data],
  );

  const all = discounts.data ?? [];
  const q = query.trim().toLowerCase();
  const list = all.filter((d) => matchFilter(d, filter) && (!q || d.name.toLowerCase().includes(q)));
  const activeCount = all.filter((d) => d.isActive).length;

  return (
    <>
      <Stack.Title>Скидки и акции</Stack.Title>
      <Stack.Toolbar placement="right">
        <ToolbarButton
          icon="plus"
          accessibilityLabel="Новая скидка"
          onPress={() => {
            haptic.light();
            router.push('/manage/loyalty/discount');
          }}
        />
      </Stack.Toolbar>
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <Form modifiers={[refreshable(async () => void (await Promise.allSettled([discounts.refetch(), goods.refetch()])))]}>
          <Section title={`${activeCount} включено`}>
            <Picker selection={filter} onSelectionChange={(v) => setFilter(v as Filter)} modifiers={[pickerStyle('segmented')]}>
              {FILTERS.map((f) => (
                <Text key={f.key} modifiers={[tag(f.key)]}>
                  {f.label}
                </Text>
              ))}
            </Picker>
            {all.length > 5 && <SearchRow placeholder="Найти скидку" onChange={setQuery} />}
          </Section>

          <Section footer={<Text>Несколько скидок «одна на чек» не складываются — берётся самая выгодная. Скидки с отметкой «складывается» добавляются друг к другу.</Text>}>
            {discounts.isLoading ? (
              <ProgressView />
            ) : list.length === 0 ? (
              <ContentUnavailableView
                title={all.length ? 'Ничего не нашли' : 'Скидок пока нет'}
                systemImage="percent"
                description={all.length ? 'Поменяйте фильтр или запрос.' : 'Начните с готовой акции на главном экране «Лояльности».'}
              />
            ) : (
              list.map((d) => (
                <LinkRow
                  key={d.id}
                  icon={d.mechanic === 'free_units' ? 'seal.fill' : d.isAuto ? 'sparkles' : 'hand.tap.fill'}
                  color={!d.isActive ? '#8E8E93' : d.mechanic === 'free_units' ? '#AF52DE' : d.isAuto ? '#FF2D55' : '#007AFF'}
                  title={d.name}
                  subtitle={[
                    d.isActive ? null : 'выключена',
                    d.isAuto ? null : 'кассир',
                    d.mechanic === 'free_units' && d.freeHistory ? 'штамп-карта' : null,
                    discountSummary(d, names),
                    d.combinable ? 'складывается' : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                  value={discountValueText(d)}
                  onPress={() => router.push({ pathname: '/manage/loyalty/discount', params: { discountId: d.id } })}
                />
              ))
            )}
            <ActionRow title="Новая скидка" icon="plus.circle.fill" onPress={() => router.push('/manage/loyalty/discount')} />
          </Section>
        </Form>
      </Host>
    </>
  );
}
