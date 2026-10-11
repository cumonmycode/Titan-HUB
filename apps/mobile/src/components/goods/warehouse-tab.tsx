import { Section, Text } from '@expo/ui/swift-ui';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { OperationsTab } from '@/components/goods/operations-tab';
import { StockRow } from '@/components/goods/parts';
import { Text as RNText } from '@/components/text';
import { formatMoney } from '@/lib/format';
import { LEVEL_LOOK, isStockItem, stockLevel, type Catalog, type GoodsItem } from '@/lib/goods-api';
import { haptic } from '@/lib/haptics';
import { FONT_SCALE_MAX } from '@/lib/text-scale';
import { colors, space, type } from '@/lib/theme';

export type StockFilter = 'all' | 'low' | 'out';

/**
 * Вкладка «Склад»: стоимость остатков и счётчики «заканчивается / нет» по всему, что
 * ведёт остаток (товары меню и ингредиенты), — нажатие показывает эти позиции. Ниже —
 * приход, списание, ревизия, черновики и история (единственное место, где их начинают).
 */
export function WarehouseTab({ catalog, filter, onFilter }: { catalog: Catalog; filter: StockFilter; onFilter: (f: StockFilter) => void }) {
  const router = useRouter();
  const stock = useMemo(() => catalog.items.filter(isStockItem), [catalog.items]);
  const summary = useMemo(() => {
    let value = 0;
    let low = 0;
    let out = 0;
    for (const item of stock) {
      value += Math.max(0, item.stockQuantity) * item.costPrice;
      const level = stockLevel(item);
      if (level === 'low') low++;
      if (level === 'out') out++;
    }
    return { value, low, out };
  }, [stock]);
  const usage = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of catalog.items) for (const line of item.recipe) map.set(line.componentId, (map.get(line.componentId) ?? 0) + 1);
    return map;
  }, [catalog.items]);
  const shown = filter === 'all' ? [] : stock.filter((i) => stockLevel(i) === filter).sort((a, b) => a.name.localeCompare(b.name, 'ru'));

  const open = (item: GoodsItem) => router.push({ pathname: '/manage/goods/[itemId]', params: { itemId: item.id, name: item.name } });
  const toggle = (next: StockFilter) => {
    haptic.selection();
    onFilter(filter === next ? 'all' : next);
  };

  return (
    <>
      <Section>
        <View style={styles.summary}>
          <View>
            <RNText style={[type.footnote, styles.secondary]}>На складе по себестоимости</RNText>
            <RNText style={[type.title2, type.amount, styles.label]} maxFontSizeMultiplier={FONT_SCALE_MAX.display}>
              {formatMoney(summary.value)}
            </RNText>
          </View>
          <View style={styles.counters}>
            <Counter label="Заканчивается" value={summary.low} color={LEVEL_LOOK.low.color} active={filter === 'low'} onPress={() => toggle('low')} />
            <Counter label="Нет на складе" value={summary.out} color={LEVEL_LOOK.out.color} active={filter === 'out'} onPress={() => toggle('out')} />
          </View>
        </View>
      </Section>

      {shown.length > 0 && (
        <Section
          title={filter === 'low' ? 'Заканчивается' : 'Нет на складе'}
          footer={<Text>Сотрудникам приходит уведомление, когда остаток доходит до точки заказа. Дозаказать всё сразу — в приходе.</Text>}
        >
          {shown.map((item) => (
            <StockRow key={item.id} item={item} usedIn={usage.get(item.id)} onPress={() => open(item)} />
          ))}
        </Section>
      )}

      <OperationsTab />
    </>
  );
}

/** Счётчик-фильтр в сводке: число цветом статуса, нажатие — показать эти позиции. */
function Counter({ label, value, color, active, onPress }: { label: string; value: number; color: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={value === 0 && !active}
      accessibilityRole="button"
      accessibilityState={{ selected: active, disabled: value === 0 && !active }}
      accessibilityLabel={`${label}: ${value}`}
      style={({ pressed }) => [styles.counter, active && { backgroundColor: color }, pressed && styles.pressed]}
    >
      <RNText
        style={[type.title3, type.amount, { color: active ? 'white' : value > 0 ? color : colors.secondaryLabel }]}
        maxFontSizeMultiplier={FONT_SCALE_MAX.display}
      >
        {String(value)}
      </RNText>
      <RNText style={[type.caption1, active ? styles.white : styles.secondary]} numberOfLines={1} maxFontSizeMultiplier={FONT_SCALE_MAX.compact}>
        {label}
      </RNText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  summary: { paddingHorizontal: space.lg, paddingVertical: space.lg, gap: space.md },
  counters: { flexDirection: 'row', gap: space.sm },
  counter: {
    flex: 1,
    minHeight: 56,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: 14,
    borderCurve: 'continuous',
    backgroundColor: colors.fill,
    justifyContent: 'center',
  },
  pressed: { opacity: 0.7 },
  label: { color: colors.label },
  secondary: { color: colors.secondaryLabel },
  white: { color: 'white' },
});
