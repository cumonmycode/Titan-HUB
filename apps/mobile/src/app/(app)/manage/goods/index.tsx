import { ContentUnavailableView, Form, Host, Picker, ProgressView, Section, Text } from '@expo/ui/swift-ui';
import { pickerStyle, refreshable, tag } from '@expo/ui/swift-ui/modifiers';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';

import { IngredientsTab } from '@/components/goods/ingredients-tab';
import { MenuTab } from '@/components/goods/menu-tab';
import { WarehouseTab, type StockFilter } from '@/components/goods/warehouse-tab';
import { ToolbarButton, ToolbarMenu, ToolbarMenuAction } from '@/components/toolbar';
import { useGoods } from '@/lib/goods-api';
import { haptic } from '@/lib/haptics';
import { queryClient } from '@/lib/query';
import { useClubKey, useMe } from '@/lib/queries';
import { useSession } from '@/lib/session';

type Tab = 'menu' | 'ingredients' | 'warehouse';

const TAB_TITLES: Record<Tab, string> = { menu: 'Меню', ingredients: 'Ингредиенты', warehouse: 'Склад' };

/** Старые ссылки (?tab=stock, ?tab=operations) ведут на «Склад». */
const TAB_ALIASES: Record<string, Tab> = { menu: 'menu', ingredients: 'ingredients', warehouse: 'warehouse', stock: 'warehouse', operations: 'warehouse' };

/**
 * «Товары» — меню, ингредиенты и склад одним разделом. Меню — что продаём, Ингредиенты —
 * из чего собираем блюда, Склад — что меняет остатки (приход, списание, ревизия) и что
 * заканчивается. Кнопки шапки зависят от вкладки: на каждое действие — одно место.
 */
export default function GoodsScreen() {
  const router = useRouter();
  const club = useClubKey();
  const params = useLocalSearchParams<{ tab?: string }>();
  const me = useMe();
  const sessionRole = useSession((s) => s.user?.role);
  const role = me.data?.role ?? sessionRole ?? 'staff';
  const permissions = me.data?.permissions ?? null;
  const allowed = (perm: string) => role === 'owner' || permissions?.[perm] !== false;
  const tabs = ([] as Tab[]).concat(allowed('menu') ? ['menu'] : [], allowed('inventory') ? ['ingredients', 'warehouse'] : []);

  const [picked, setPicked] = useState<Tab | null>(() => (params.tab ? (TAB_ALIASES[params.tab] ?? null) : null));
  const tab: Tab | undefined = picked && tabs.includes(picked) ? picked : tabs[0];
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [filter, setFilter] = useState<StockFilter>('all');
  const goods = useGoods();

  const refresh = async () => {
    await queryClient.refetchQueries({ queryKey: [club, 'goods'], type: 'active' });
  };

  const newItem = () => router.push({ pathname: '/manage/goods/edit', params: category && category !== 'none' ? { categoryId: category } : {} });

  return (
    <>
      <Stack.Title>Товары</Stack.Title>
      {tab === 'menu' && (
        <Stack.Toolbar placement="right">
          <ToolbarButton icon="folder" accessibilityLabel="Категории" onPress={() => router.push('/manage/goods/categories')} />
          <ToolbarMenu icon="plus" accessibilityLabel="Создать">
            <ToolbarMenuAction icon="cup.and.saucer" onPress={newItem}>
              Позиция
            </ToolbarMenuAction>
            <ToolbarMenuAction icon="folder.badge.plus" onPress={() => router.push('/manage/goods/category')}>
              Категория
            </ToolbarMenuAction>
          </ToolbarMenu>
        </Stack.Toolbar>
      )}
      {tab === 'ingredients' && (
        <Stack.Toolbar placement="right">
          <ToolbarButton
            icon="plus"
            accessibilityLabel="Новый ингредиент"
            onPress={() => router.push({ pathname: '/manage/goods/edit', params: { kind: 'ingredient' } })}
          />
        </Stack.Toolbar>
      )}

      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <Form modifiers={[refreshable(refresh)]}>
          {tabs.length > 1 && tab && (
            <Section>
              <Picker
                selection={tab}
                onSelectionChange={(value) => {
                  haptic.selection();
                  setPicked(value as Tab);
                  setQuery('');
                }}
                modifiers={[pickerStyle('segmented')]}
              >
                {tabs.map((t) => (
                  <Text key={t} modifiers={[tag(t)]}>
                    {TAB_TITLES[t]}
                  </Text>
                ))}
              </Picker>
            </Section>
          )}

          {!tab ? (
            <Section>
              <ContentUnavailableView title="Нет доступа" systemImage="lock" description="Меню и склад закрыты для вашей роли — попросите владельца." />
            </Section>
          ) : !goods.data ? (
            <Section>
              {goods.isError ? (
                <ContentUnavailableView title="Нет связи" systemImage="wifi.exclamationmark" description={goods.error.message} />
              ) : (
                <ProgressView />
              )}
            </Section>
          ) : tab === 'menu' ? (
            <MenuTab catalog={goods.data} query={query} onQuery={setQuery} category={category} onCategory={setCategory} />
          ) : tab === 'ingredients' ? (
            <IngredientsTab catalog={goods.data} query={query} onQuery={setQuery} />
          ) : (
            <WarehouseTab catalog={goods.data} filter={filter} onFilter={setFilter} />
          )}
        </Form>
      </Host>
    </>
  );
}
