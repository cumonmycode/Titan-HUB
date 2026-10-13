import { ContentUnavailableView, Form, Host, Picker, ProgressView, Section, Text } from '@expo/ui/swift-ui';
import { pickerStyle, refreshable, tag } from '@expo/ui/swift-ui/modifiers';
import { Stack, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';

import { ActionRow, LinkRow, SearchRow } from '@/components/native-form';
import { useSettingsEditor } from '@/components/settings-parts';
import { ToolbarButton } from '@/components/toolbar';
import { tierLook, useClientTiers } from '@/lib/clients-api';
import { useGoods } from '@/lib/goods-api';
import { haptic } from '@/lib/haptics';
import { discountSummary, discountValueText, useCertificates, useDiscounts, type Discount } from '@/lib/loyalty-api';
import { useSession } from '@/lib/session';

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
 * Лояльность: бонусы и сертификаты — отдельными экранами, скидки — здесь списком с
 * фильтром и поиском. У каждой скидки свои условия: на что, кому, когда, от какой суммы.
 * «Сами» — применяются к чеку автоматически, «Кассир» — выбираются в кассе.
 */
export default function LoyaltyScreen() {
  const router = useRouter();
  const isOwner = useSession((s) => s.user?.role === 'owner');
  const discounts = useDiscounts();
  const tiers = useClientTiers();
  const goods = useGoods();
  const certificates = useCertificates();
  const settings = useSettingsEditor();
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
  const bonusOn = settings.flag('bonus_enabled', true);
  const activeCertificates = (certificates.data ?? []).filter((c) => c.status === 'active').length;

  const refresh = async () => {
    await Promise.allSettled([discounts.refetch(), certificates.refetch(), settings.refetch(), goods.refetch()]);
  };

  return (
    <>
      <Stack.Title>Лояльность</Stack.Title>
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
        <Form modifiers={[refreshable(refresh)]}>
          <Section>
            {isOwner && (
              <LinkRow
                icon="star.circle.fill"
                color="#FF9500"
                title="Бонусная программа"
                subtitle={bonusOn ? `${settings.number('bonus_accrual_rate', 5)}% от покупки, по статусам — свой процент` : 'Выключена'}
                value={bonusOn ? 'Вкл.' : 'Выкл.'}
                onPress={() => router.push('/manage/loyalty/bonus')}
              />
            )}
            <LinkRow
              icon="giftcard.fill"
              color="#AF52DE"
              title="Сертификаты"
              subtitle="Свой номер или серия, на что действуют, срок"
              value={certificates.data ? `${activeCertificates} действ.` : undefined}
              onPress={() => router.push('/manage/loyalty/certificates')}
            />
          </Section>

          <Section title={`Скидки · ${activeCount} включено`}>
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
                description={all.length ? 'Поменяйте фильтр или запрос.' : 'Например: −20% на бар по будням с 17 до 19, или −10% резидентам на весь чек.'}
              />
            ) : (
              list.map((d) => (
                <LinkRow
                  key={d.id}
                  icon={d.isAuto ? 'sparkles' : 'hand.tap.fill'}
                  color={!d.isActive ? '#8E8E93' : d.isAuto ? '#FF2D55' : '#007AFF'}
                  title={d.name}
                  subtitle={[d.isActive ? null : 'выключена', d.isAuto ? null : 'кассир', discountSummary(d, names), d.combinable ? 'складывается' : null].filter(Boolean).join(' · ')}
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
