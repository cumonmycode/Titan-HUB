import { ContentUnavailableView, Section, Text } from '@expo/ui/swift-ui';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { ScrollView, StyleSheet } from 'react-native';

import { MenuRow } from '@/components/goods/parts';
import { SearchRow } from '@/components/native-form';
import { GlassChip } from '@/components/new-check-parts';
import { categoryHex, categorySymbol, isTariffCategory } from '@/lib/catalog-api';
import { plural } from '@/lib/format';
import { isMenuItem, type Catalog, type GoodsItem } from '@/lib/goods-api';
import { haptic } from '@/lib/haptics';
import { space } from '@/lib/theme';

const NONE = 'none';

/** Поиск по названию и тегам — тот же, что у кассы. */
export function matches(item: GoodsItem, query: string): boolean {
  if (!query) return true;
  return item.name.toLowerCase().includes(query) || item.searchTags.some((t) => t.toLowerCase().includes(query));
}

/**
 * Вкладка «Меню»: что продаём. Категории — чипсами сверху (фильтр), позиции — по
 * категориям с ценой, маржой и запасом. Тарифы сюда не попадают: их правят в «Тарифах».
 */
export function MenuTab({
  catalog,
  query,
  onQuery,
  category,
  onCategory,
}: {
  catalog: Catalog;
  query: string;
  onQuery: (q: string) => void;
  category: string | null;
  onCategory: (id: string | null) => void;
}) {
  const router = useRouter();
  const q = query.trim().toLowerCase();

  const categories = useMemo(() => catalog.categories.filter((c) => !isTariffCategory(c)), [catalog.categories]);
  const items = useMemo(() => catalog.items.filter(isMenuItem), [catalog.items]);
  const known = useMemo(() => new Set(categories.map((c) => c.id)), [categories]);
  const keyOf = (item: GoodsItem) => (item.category && known.has(item.category) ? item.category : NONE);

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of items) map.set(keyOf(item), (map.get(keyOf(item)) ?? 0) + 1);
    return map;
    // keyOf зависит только от known
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, known]);

  const groups = useMemo(() => {
    const visible = items.filter((i) => matches(i, q) && (!category || keyOf(i) === category));
    const order = [...categories.map((c) => ({ id: c.id, title: c.name })), { id: NONE, title: 'Без категории' }];
    return order.map((g) => ({ ...g, items: visible.filter((i) => keyOf(i) === g.id) })).filter((g) => g.items.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, categories, q, category, known]);

  const open = (item: GoodsItem) => router.push({ pathname: '/manage/goods/[itemId]', params: { itemId: item.id, name: item.name } });
  const pick = (id: string | null) => {
    haptic.selection();
    onCategory(id === category ? null : id);
  };

  return (
    <>
      <Section>
        <SearchRow placeholder="Название или тег" onChange={onQuery} />
      </Section>

      {categories.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips} contentContainerStyle={styles.chipsContent}>
          <GlassChip label={`Все · ${items.length}`} active={!category} onPress={() => pick(null)} />
          {categories.map((c) => (
            <GlassChip
              key={c.id}
              label={`${c.name} · ${counts.get(c.id) ?? 0}`}
              icon={categorySymbol(c.icon)}
              tint={categoryHex(c.color)}
              active={category === c.id}
              onPress={() => pick(c.id)}
            />
          ))}
          {(counts.get(NONE) ?? 0) > 0 && <GlassChip label={`Без категории · ${counts.get(NONE)}`} active={category === NONE} onPress={() => pick(NONE)} />}
        </ScrollView>
      )}

      {groups.length === 0 ? (
        <Section>
          <ContentUnavailableView
            title={q || category ? 'Ничего не нашли' : 'Меню пустое'}
            systemImage={q ? 'magnifyingglass' : 'menucard'}
            description={q || category ? 'Измените запрос или категорию.' : 'Добавьте категорию и первую позицию кнопкой «+».'}
          />
        </Section>
      ) : (
        groups.map((group) => (
          <Section key={group.id} title={`${group.title} · ${group.items.length} ${plural(group.items.length, ['позиция', 'позиции', 'позиций'])}`}>
            {group.items.map((item) => (
              <MenuRow key={item.id} item={item} catalog={catalog} onPress={() => open(item)} />
            ))}
          </Section>
        ))
      )}

      <Section footer={<Text>Цена, место в меню и учёт на складе — в карточке позиции. Тарифы гостей — в «Тарифах и аренде».</Text>}>{null}</Section>
    </>
  );
}

const styles = StyleSheet.create({
  // Форма даёт поля 16 pt — чипсы листаются от края до края экрана.
  chips: { marginHorizontal: -space.lg, flexGrow: 0, flexShrink: 0 },
  chipsContent: { gap: space.sm, paddingHorizontal: space.lg },
});
