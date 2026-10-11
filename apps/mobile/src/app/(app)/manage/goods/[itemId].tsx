import { ActionRow, LinkRow } from '@/components/native-form';
import { ContentUnavailableView, Form, HStack, Host, ProgressView, Section, Text } from '@expo/ui/swift-ui';
import { refreshable } from '@expo/ui/swift-ui/modifiers';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';

import { Tile } from '@/components/analytics/native';
import { DaysChart, ItemHero, MovementLine, StockHero } from '@/components/goods/card-parts';
import { ToolbarButton } from '@/components/toolbar';
import { chooseAction } from '@/lib/dialog';
import { formatMoney, plural } from '@/lib/format';
import { PIECE_NAMES, itemQty, packText, servings, useGoods, useGoodsCard, type Catalog, type GoodsCard, type GoodsItem } from '@/lib/goods-api';

const money = (n: number) => formatMoney(n, { kopecks: 'auto' });
const longDate = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: 'Europe/Moscow' });
const decimal = (n: number) => n.toFixed(1).replace('.', ',').replace(',0', '');
const MOVEMENTS_SHORT = 12;

/**
 * Карточка позиции: что о ней важно знать — цена и маржа (или остаток сырья), как она
 * учитывается и из чего состоит, продажи и расход за 30 дней, журнал движений. Правка —
 * кнопкой «Изменить»; остаток меняют документы (списать, пересчитать, приход).
 */
export default function GoodsItemScreen() {
  const { itemId, name } = useLocalSearchParams<{ itemId: string; name?: string }>();
  const router = useRouter();
  const goods = useGoods();
  const card = useGoodsCard(itemId);
  const item = goods.data?.byId.get(itemId);

  if (!goods.data || !item) {
    return (
      <>
        <Stack.Title>{name ?? 'Позиция'}</Stack.Title>
        <Host style={{ flex: 1 }} useViewportSizeMeasurement>
          {goods.isError ? (
            <ContentUnavailableView title="Нет связи" systemImage="wifi.exclamationmark" description={goods.error.message} />
          ) : goods.data ? (
            <ContentUnavailableView title="Позиция удалена" systemImage="trash" />
          ) : (
            <ProgressView />
          )}
        </Host>
      </>
    );
  }

  return (
    <>
      <Stack.Title>{item.name}</Stack.Title>
      {item.role !== 'tariff' && (
        <Stack.Toolbar placement="right">
          <ToolbarButton onPress={() => router.push({ pathname: '/manage/goods/edit', params: { itemId: item.id } })}>Изменить</ToolbarButton>
        </Stack.Toolbar>
      )}
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <Form modifiers={[refreshable(async () => void (await Promise.allSettled([goods.refetch(), card.refetch()])))]}>
          {item.kind === 'ingredient' ? (
            <IngredientBody item={item} catalog={goods.data} card={card.data} />
          ) : (
            <MenuItemBody item={item} catalog={goods.data} card={card.data} />
          )}
          <Journal item={item} card={card.data} loading={card.isLoading} />
        </Form>
      </Host>
    </>
  );
}

/** Изменить остаток: тремя документами, каждый открывается уже с этой позицией. */
function useStockActions(item: GoodsItem) {
  const router = useRouter();
  return () =>
    chooseAction(item.name, `Сейчас ${itemQty(item, item.stockQuantity)}`, [
      { text: 'Приход', icon: 'shippingbox', onPress: () => router.push({ pathname: '/manage/goods/supply', params: { itemId: item.id } }) },
      { text: 'Списать', icon: 'trash', onPress: () => router.push({ pathname: '/manage/goods/write-off', params: { itemId: item.id } }) },
      { text: 'Пересчитать', icon: 'checklist', onPress: () => router.push({ pathname: '/manage/goods/revision', params: { itemId: item.id } }) },
      { text: 'Отмена', style: 'cancel' },
    ]);
}

function MenuItemBody({ item, catalog, card }: { item: GoodsItem; catalog: Catalog; card: GoodsCard | undefined }) {
  const router = useRouter();
  const stockActions = useStockActions(item);
  const category = catalog.categories.find((c) => c.id === item.category)?.name ?? null;
  const portions = servings(item, catalog.byId);

  return (
    <>
      <Section>
        <ItemHero item={item} categoryName={category} />
      </Section>

      {item.stockMode === 'pieces' && (
        <Section title="Склад" footer={<Text>Остаток меняют приход, списание и ревизия; продажи кассы списывают сами.</Text>}>
          <StockHero item={item} />
          <ActionRow title="Изменить остаток" icon="plusminus" onPress={stockActions} />
        </Section>
      )}

      {item.stockMode === 'recipe' && (
        <Section
          title="Состав порции"
          footer={
            <Text>
              {`Порция стоит ${money(item.costPrice)}.${portions ? (portions.count > 0 ? ` Хватит на ≈ ${portions.count} ${plural(portions.count, ['порцию', 'порции', 'порций'])} — первым кончится «${portions.limitedBy?.name}».` : ` Не хватает «${portions.limitedBy?.name}».`) : ''} Продажа списывает состав со склада.`}
            </Text>
          }
        >
          {item.recipe.map((line) => {
            const component = catalog.byId.get(line.componentId);
            return (
              <LinkRow
                key={line.componentId}
                title={component?.name ?? 'Удалённый ингредиент'}
                subtitle={component ? `на складе ${itemQty(component, component.stockQuantity)}` : undefined}
                value={component ? `${itemQty(component, line.quantity)} · ${money(line.quantity * component.costPrice)}` : undefined}
                onPress={
                  component ? () => router.push({ pathname: '/manage/goods/[itemId]', params: { itemId: component.id, name: component.name } }) : undefined
                }
              />
            );
          })}
        </Section>
      )}

      {item.stockMode === 'none' && item.role !== 'tariff' && (
        <Section footer={<Text>Продажи не списывают эту позицию со склада. Включить учёт штуками или по составу — в «Изменить».</Text>}>
          <LinkRow icon="shippingbox" color="#8E8E93" title="Остатки не учитываются" />
        </Section>
      )}

      {card && (
        <Section title="Продажи · 30 дней" footer={card.sales.qty ? <Text>По оси — дней назад, 0 — сегодня. Только закрытые чеки.</Text> : undefined}>
          <HStack spacing={12}>
            <Tile label="Продано" value={`${card.sales.qty} шт`} />
            <Tile label="Выручка" value={money(card.sales.revenue)} />
            <Tile label="В день" value={`${decimal(card.sales.qty / 30)} шт`} />
          </HStack>
          <DaysChart series={card.sales.series} />
        </Section>
      )}
    </>
  );
}

function IngredientBody({ item, catalog, card }: { item: GoodsItem; catalog: Catalog; card: GoodsCard | undefined }) {
  const router = useRouter();
  const stockActions = useStockActions(item);
  const users = catalog.items.filter((i) => i.recipe.some((l) => l.componentId === item.id));
  return (
    <>
      <Section
        footer={
          item.packSize ? (
            <Text>{`В приходе вносите ${PIECE_NAMES[item.packName ?? 'pack'].forms[2]} — количество подставится, его можно поправить на факт.`}</Text>
          ) : undefined
        }
      >
        <StockHero item={item} />
        <LinkRow icon="shippingbox" color="#10B981" title="Фасовка" value={packText(item) ?? 'не задана'} />
        <ActionRow title="Изменить остаток" icon="plusminus" onPress={stockActions} />
      </Section>

      <Section
        title="Используется в"
        footer={users.length === 0 ? <Text>Добавьте ингредиент в состав блюда — продажи начнут списывать его сами.</Text> : undefined}
      >
        {users.length === 0 ? (
          <LinkRow icon="link" color="#8E8E93" title="Пока ни в одной позиции" />
        ) : (
          users.map((product) => {
            const line = product.recipe.find((l) => l.componentId === item.id);
            return (
              <LinkRow
                key={product.id}
                title={product.name}
                value={line ? `${itemQty(item, line.quantity)} на порцию` : undefined}
                onPress={() => router.push({ pathname: '/manage/goods/[itemId]', params: { itemId: product.id, name: product.name } })}
              />
            );
          })
        )}
      </Section>

      {card && card.usage.qty > 0 && (
        <Section title="Расход · 30 дней">
          <HStack spacing={12}>
            <Tile label="Ушло" value={itemQty(item, card.usage.qty)} />
            <Tile label="В день" value={itemQty(item, Math.round(card.usage.qty / 30))} />
          </HStack>
          <DaysChart series={card.usage.series} />
        </Section>
      )}
    </>
  );
}

/** Последний приход и журнал движений — у всего, что ведёт остаток. */
function Journal({ item, card, loading }: { item: GoodsItem; card: GoodsCard | undefined; loading: boolean }) {
  const router = useRouter();
  const [all, setAll] = useState(false);
  if (item.kind !== 'ingredient' && item.stockMode !== 'pieces') return null;
  const movements = card?.movements ?? [];
  const shown = all ? movements : movements.slice(0, MOVEMENTS_SHORT);
  return (
    <>
      {card?.lastSupply && (
        <Section title="Последний приход">
          <LinkRow
            icon="shippingbox.fill"
            color="#10B981"
            title={[longDate.format(new Date(card.lastSupply.date)), card.lastSupply.supplier].filter(Boolean).join(' · ')}
            subtitle={`${itemQty(item, card.lastSupply.quantity)} на ${money(card.lastSupply.quantity * card.lastSupply.costPerUnit)}`}
            onPress={() => router.push({ pathname: '/manage/goods/doc', params: { type: 'supply', id: card.lastSupply!.supplyId } })}
          />
        </Section>
      )}
      <Section title="Движения">
        {loading ? (
          <ProgressView />
        ) : movements.length === 0 ? (
          <Text>Движений пока не было</Text>
        ) : (
          shown.map((m) => <MovementLine key={m.id} movement={m} unit={item.unit} label={item.unitLabel} />)
        )}
        {!all && movements.length > MOVEMENTS_SHORT ? <ActionRow title={`Показать все · ${movements.length}`} onPress={() => setAll(true)} /> : null}
      </Section>
    </>
  );
}
