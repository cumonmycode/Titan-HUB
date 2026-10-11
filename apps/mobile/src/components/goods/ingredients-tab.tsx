import { ContentUnavailableView, Section, Text } from '@expo/ui/swift-ui';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';

import { matches } from '@/components/goods/menu-tab';
import { StockRow } from '@/components/goods/parts';
import { SearchRow } from '@/components/native-form';
import { type Catalog, type GoodsItem } from '@/lib/goods-api';

/**
 * Вкладка «Ингредиенты»: всё, из чего собираются блюда, — остаток, фасовка при закупке и
 * в скольких блюдах используется. Новый ингредиент — «+» в шапке.
 */
export function IngredientsTab({ catalog, query, onQuery }: { catalog: Catalog; query: string; onQuery: (q: string) => void }) {
  const router = useRouter();
  const q = query.trim().toLowerCase();
  const ingredients = useMemo(() => catalog.items.filter((i) => i.kind === 'ingredient').sort((a, b) => a.name.localeCompare(b.name, 'ru')), [catalog.items]);
  const usage = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of catalog.items) for (const line of item.recipe) map.set(line.componentId, (map.get(line.componentId) ?? 0) + 1);
    return map;
  }, [catalog.items]);
  const visible = ingredients.filter((i) => matches(i, q));
  const open = (item: GoodsItem) => router.push({ pathname: '/manage/goods/[itemId]', params: { itemId: item.id, name: item.name } });

  if (ingredients.length === 0) {
    return (
      <Section>
        <ContentUnavailableView
          title="Ингредиентов пока нет"
          systemImage="leaf"
          description="Ингредиент — то, из чего собирается блюдо: наггетсы, соус, зёрна, молоко, табак. Добавьте первый кнопкой «+», затем укажите его в составе блюда."
        />
      </Section>
    );
  }

  return (
    <>
      <Section>
        <SearchRow placeholder="Наггетсы, соус, молоко…" onChange={onQuery} />
      </Section>
      {visible.length === 0 ? (
        <Section>
          <ContentUnavailableView title="Ничего не нашли" systemImage="magnifyingglass" />
        </Section>
      ) : (
        <Section title={`${visible.length} ${visible.length === ingredients.length ? 'всего' : 'найдено'}`}>
          {visible.map((item) => (
            <StockRow key={item.id} item={item} usedIn={usage.get(item.id) ?? 0} onPress={() => open(item)} />
          ))}
        </Section>
      )}
      <Section footer={<Text>Продажа блюда сама списывает его ингредиенты. Пополнить — «Приход» во вкладке «Склад».</Text>}>{null}</Section>
    </>
  );
}
