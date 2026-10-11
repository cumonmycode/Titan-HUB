import { ContentUnavailableView, Form, Host, ProgressView, Section, Text } from '@expo/ui/swift-ui';
import { refreshable } from '@expo/ui/swift-ui/modifiers';
import { Stack, useRouter } from 'expo-router';

import { LinkRow } from '@/components/native-form';
import { ToolbarButton } from '@/components/toolbar';
import { categoryHex, categorySymbol, isTariffCategory } from '@/lib/catalog-api';
import { plural } from '@/lib/format';
import { isMenuItem, useGoods } from '@/lib/goods-api';

/**
 * Категории меню: значок, цвет, сколько позиций и видна ли категория гостям в Titan Home.
 * Нажатие — правка категории (там же порядок её позиций); «Порядок» в шапке — порядок
 * категорий в кассе и у гостей.
 */
export default function GoodsCategoriesScreen() {
  const router = useRouter();
  const goods = useGoods();
  const data = goods.data;
  const categories = (data?.categories ?? []).filter((c) => !isTariffCategory(c));
  const count = (id: string) => (data?.items ?? []).filter((i) => isMenuItem(i) && i.category === id).length;

  return (
    <>
      <Stack.Title>Категории</Stack.Title>
      <Stack.Toolbar placement="right">
        <ToolbarButton
          icon="arrow.up.arrow.down"
          accessibilityLabel="Порядок категорий"
          onPress={() => router.push({ pathname: '/manage/goods/reorder', params: { scope: 'categories' } })}
        />
        <ToolbarButton icon="plus" accessibilityLabel="Новая категория" onPress={() => router.push('/manage/goods/category')} />
      </Stack.Toolbar>
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <Form modifiers={[refreshable(async () => void (await goods.refetch()))]}>
          {!data ? (
            <Section>
              {goods.isError ? (
                <ContentUnavailableView title="Нет связи" systemImage="wifi.exclamationmark" description={goods.error.message} />
              ) : (
                <ProgressView />
              )}
            </Section>
          ) : categories.length === 0 ? (
            <Section>
              <ContentUnavailableView title="Категорий нет" systemImage="folder" description="Создайте первую кнопкой «+»." />
            </Section>
          ) : (
            <Section footer={<Text>Категория «Тарифы» живёт в «Тарифах и аренде» и здесь не показывается.</Text>}>
              {categories.map((category) => {
                const n = count(category.id);
                return (
                  <LinkRow
                    key={category.id}
                    icon={categorySymbol(category.icon)}
                    color={categoryHex(category.color)}
                    title={category.name}
                    subtitle={category.isTabletVisible === false ? 'скрыта в Titan Home' : undefined}
                    value={`${n} ${plural(n, ['позиция', 'позиции', 'позиций'])}`}
                    onPress={() => router.push({ pathname: '/manage/goods/category', params: { categoryId: category.id } })}
                  />
                );
              })}
            </Section>
          )}
        </Form>
      </Host>
    </>
  );
}
