import { Button, Section, SwipeActions, Text } from '@expo/ui/swift-ui';
import { useRouter } from 'expo-router';

import { DocLineRow, NumberInput } from '@/components/goods/parts';
import { ActionRow } from '@/components/native-form';
import { formatMoney } from '@/lib/format';
import { itemQty, packText, unitWord, type Catalog } from '@/lib/goods-api';
import { baseQuantity, useDocDraft } from '@/lib/goods-draft';

const money = (n: number) => formatMoney(n, { kopecks: 'auto' });

/**
 * «Состав» в редакторе позиции: ингредиенты порции и сколько каждого уходит — 6 шт
 * наггетсов, 1 пачка соуса, 18 г зёрен. Есть строки — позиция учитывается по составу:
 * продажа спишет ингредиенты, себестоимость посчитается по ним. Строки — в общем
 * черновике, чтобы экран «Добавить ингредиент» дописывал их сюда же.
 */
export function RecipeSection({ catalog, showErrors }: { catalog: Catalog; showErrors: boolean }) {
  const router = useRouter();
  const lines = useDocDraft((s) => s.lines);
  const setText = useDocDraft((s) => s.setText);
  const remove = useDocDraft((s) => s.remove);

  const footer = lines.length
    ? 'Продажа спишет этот состав со склада. Смахните строку влево, чтобы убрать ингредиент.'
    : 'Из чего собрана порция: например, 6 шт наггетсов и 1 пачка соуса. Продажа спишет их со склада, а себестоимость посчитается сама. Без состава продажа склад не трогает.';

  return (
    <Section title="Состав" footer={<Text>{footer}</Text>}>
      {lines.map((line) => {
        const component = line.itemId ? catalog.byId.get(line.itemId) : undefined;
        const qty = baseQuantity(line);
        const invalid = showErrors && qty <= 0;
        const caption = invalid
          ? 'Укажите, сколько уходит на порцию'
          : component
            ? [`на складе ${itemQty(component, component.stockQuantity)}`, packText(component)].filter(Boolean).join(' · ')
            : undefined;
        return (
          <SwipeActions key={line.key}>
            <DocLineRow
              title={line.name}
              caption={caption}
              captionColor={invalid ? '#F43F5E' : undefined}
              total={component && qty > 0 ? money(qty * component.costPrice) : undefined}
              fields={
                <NumberInput
                  key={`${line.key}-${line.version}`}
                  label={`${line.name}, на порцию`}
                  value={line.qty}
                  integer
                  invalid={invalid}
                  suffix={`${unitWord(line.unit, line.label, line.qty)} на порцию`}
                  onChange={(text) => setText(line.key, 'qty', text)}
                />
              }
            />
            <SwipeActions.Actions edge="trailing">
              <Button role="destructive" label="Убрать" systemImage="minus.circle" onPress={() => remove(line.key)} />
            </SwipeActions.Actions>
          </SwipeActions>
        );
      })}
      <ActionRow title="Ингредиент" icon="plus.circle.fill" onPress={() => router.push({ pathname: '/manage/goods/pick', params: { mode: 'recipe' } })} />
    </Section>
  );
}
