import { ContentUnavailableView, Form, ProgressView, Section, Text } from '@expo/ui/swift-ui';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { EditorToolbar } from '@/components/editor-toolbar';
import { matches } from '@/components/goods/menu-tab';
import { ActionRow, FormHost, SearchRow } from '@/components/native-form';
import { Text as RNText } from '@/components/text';
import { isTariffCategory } from '@/lib/catalog-api';
import { chooseAction } from '@/lib/dialog';
import { LEVEL_LOOK, QUICK_UNITS, createItem, isStockItem, itemQty, reorderQuantity, stockLevel, useGoods, type GoodsItem } from '@/lib/goods-api';
import { useDocDraft, type DraftMode } from '@/lib/goods-draft';
import { haptic } from '@/lib/haptics';
import { colors, space, type } from '@/lib/theme';

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

const TITLES: Record<DraftMode, string> = { supply: 'Что пришло', write_off: 'Что списать', recipe: 'Ингредиенты' };

/** Что можно добавить в документ: приход и состав — то, что ведёт остаток; списать можно и порцию по составу. */
function candidates(mode: DraftMode, items: GoodsItem[], productId: string | null): GoodsItem[] {
  return items.filter((item) => {
    if (item.id === productId) return false;
    if (isStockItem(item)) return true;
    return mode === 'write_off' && item.stockMode === 'recipe' && item.role !== 'tariff';
  });
}

/**
 * Выбор позиций для прихода, списания или состава: отметьте нужное и «Добавить».
 * Для прихода — «Добавить заканчивающиеся» (сколько дозаказать — до целевого уровня).
 * Нет нужного — тут же новый ингредиент или (в приходе) затрата без карточки.
 */
export default function PickScreen() {
  const { mode: modeParam } = useLocalSearchParams<{ mode?: DraftMode }>();
  const router = useRouter();
  const goods = useGoods();
  const mode = useDocDraft((s) => s.mode) ?? modeParam ?? 'supply';
  const productId = useDocDraft((s) => s.productId);
  const present = useDocDraft((s) => s.lines);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const q = query.trim().toLowerCase();

  const inDoc = useMemo(() => new Set(present.map((l) => l.itemId)), [present]);
  const pool = useMemo(() => (goods.data ? candidates(mode, goods.data.items, productId) : []), [goods.data, mode, productId]);
  const low = useMemo(() => pool.filter((i) => isStockItem(i) && stockLevel(i) !== 'ok' && reorderQuantity(i) > 0 && !inDoc.has(i.id)), [pool, inDoc]);

  const groups = useMemo(() => {
    if (!goods.data) return [];
    const visible = pool.filter((i) => matches(i, q));
    const categories = goods.data.categories.filter((c) => !isTariffCategory(c));
    const keyOf = (i: GoodsItem) => (i.kind === 'ingredient' ? 'raw' : i.category && categories.some((c) => c.id === i.category) ? i.category : 'none');
    const order = [{ id: 'raw', title: 'Ингредиенты' }, ...categories.map((c) => ({ id: c.id, title: c.name })), { id: 'none', title: 'Без категории' }];
    return order.map((g) => ({ ...g, items: visible.filter((i) => keyOf(i) === g.id) })).filter((g) => g.items.length > 0);
  }, [goods.data, pool, q]);

  const toggle = (id: string) => {
    haptic.selection();
    setPicked((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));
  };

  const finish = (ids: string[]) => {
    const byId = goods.data?.byId;
    if (!byId) return;
    useDocDraft.getState().addItems(ids.map((id) => byId.get(id)).filter((i): i is GoodsItem => !!i));
    haptic.success();
    router.back();
  };

  const createIngredient = () => {
    const name = query.trim();
    chooseAction(`Новый ингредиент «${name}»`, 'В чём его считать?', [
      ...QUICK_UNITS.map((choice) => ({
        text: choice.title,
        onPress: () => {
          setBusy(true);
          createItem('ingredient', { name, unit: choice.unit, ...(choice.label ? { unitLabel: choice.label } : {}) })
            .then(async (id) => {
              const fresh = await goods.refetch();
              const item = fresh.data?.byId.get(id);
              if (item) useDocDraft.getState().addItems([item]);
              haptic.success();
              router.back();
            })
            .catch((error: unknown) => Alert.alert('Ингредиент не создан', errorText(error)))
            .finally(() => setBusy(false));
        },
      })),
      { text: 'Отмена', style: 'cancel' as const },
    ]);
  };

  return (
    <>
      <EditorToolbar
        title={TITLES[mode]}
        canSave={picked.length > 0}
        busy={busy}
        saveLabel={picked.length ? `Добавить ${picked.length}` : 'Добавить'}
        busyLabel="Создаём…"
        onSave={() => finish(picked)}
      />
      <FormHost>
        <Form>
          <Section>
            <SearchRow placeholder={mode === 'recipe' ? 'Наггетсы, соус, молоко…' : 'Название или тег'} onChange={setQuery} />
          </Section>

          {mode === 'supply' && low.length > 0 && !q ? (
            <Section footer={<Text>Сколько заказать — до целевого уровня из карточки (или вдвое выше точки заказа).</Text>}>
              <ActionRow title={`Добавить заканчивающиеся · ${low.length}`} icon="cart.badge.plus" onPress={() => finish(low.map((i) => i.id))} />
            </Section>
          ) : null}

          {!goods.data ? (
            <Section>
              <ProgressView />
            </Section>
          ) : groups.length === 0 ? (
            <Section>
              <ContentUnavailableView
                title={q ? 'Ничего не нашли' : 'Нечего добавить'}
                systemImage={q ? 'magnifyingglass' : 'shippingbox'}
                description={q ? undefined : 'Наберите название — и создайте ингредиент прямо отсюда.'}
              />
            </Section>
          ) : (
            groups.map((group) => (
              <Section key={group.id} title={group.title}>
                {group.items.map((item) => (
                  <PickRow key={item.id} item={item} checked={picked.includes(item.id)} added={inDoc.has(item.id)} onPress={() => toggle(item.id)} />
                ))}
              </Section>
            ))
          )}

          {q && mode !== 'write_off' ? (
            <Section
              footer={
                <Text>
                  {mode === 'supply'
                    ? 'Затрата без карточки попадёт в сумму прихода, но не в остатки.'
                    : 'Ингредиент появится во вкладке «Ингредиенты»; фасовку и точку заказа задайте там.'}
                </Text>
              }
            >
              <ActionRow title={`Новый ингредиент «${query.trim()}»`} icon="plus.circle" onPress={createIngredient} />
              {mode === 'supply' ? (
                <ActionRow
                  title={`Затрата без карточки «${query.trim()}»`}
                  icon="doc.text"
                  onPress={() => {
                    useDocDraft.getState().addFree(query);
                    router.back();
                  }}
                />
              ) : null}
            </Section>
          ) : null}
        </Form>
      </FormHost>
    </>
  );
}

/** Строка выбора: отметка, название, остаток; уже добавленное — серым. */
function PickRow({ item, checked, added, onPress }: { item: GoodsItem; checked: boolean; added: boolean; onPress: () => void }) {
  const level = stockLevel(item);
  const caption = item.stockMode === 'recipe' ? 'по составу' : `на складе ${itemQty(item, item.stockQuantity)}`;
  return (
    <Pressable
      disabled={added}
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled: added }}
      accessibilityLabel={item.name}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <SymbolView
        name={added ? 'checkmark.circle' : checked ? 'checkmark.circle.fill' : 'circle'}
        size={22}
        tintColor={added ? colors.tertiaryLabel : checked ? colors.accent : colors.tertiaryLabel}
      />
      <View style={styles.titles}>
        <RNText style={[type.body, added ? styles.tertiary : styles.label]} numberOfLines={2}>
          {item.name}
        </RNText>
        <RNText
          style={[
            type.footnote,
            { color: added ? colors.tertiaryLabel : level === 'ok' || item.stockMode === 'recipe' ? colors.secondaryLabel : LEVEL_LOOK[level].color },
          ]}
        >
          {added ? 'уже в списке' : caption}
        </RNText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: 10, minHeight: 52 },
  pressed: { backgroundColor: colors.fill },
  titles: { flex: 1, gap: 2 },
  label: { color: colors.label },
  tertiary: { color: colors.tertiaryLabel },
});
