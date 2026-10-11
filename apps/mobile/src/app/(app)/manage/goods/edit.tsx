import { ContentUnavailableView, Form, HStack, Picker, ProgressView, Section, Text, Toggle } from '@expo/ui/swift-ui';
import { pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert } from 'react-native';

import { EditorToolbar } from '@/components/editor-toolbar';
import { RecipeSection } from '@/components/goods/recipe-section';
import { ActionRow, DisclosureRow, FieldRow, FormHost, InputRow, LinkRow, primary, secondary } from '@/components/native-form';
import { isTariffCategory } from '@/lib/catalog-api';
import { formatMoney } from '@/lib/format';
import {
  BIG_UNIT,
  PIECE_CHOICES,
  PIECE_NAMES,
  UNIT_CHOICES,
  createItem,
  deleteItem,
  itemQty,
  margin,
  numberText,
  parseDecimal,
  recipeCost,
  updateItem,
  useGoods,
  type Catalog,
  type GoodsItem,
  type ItemInput,
  type PieceName,
  type StockMode,
  type Unit,
} from '@/lib/goods-api';
import { baseQuantity, draftLineOf, useDocDraft, type DraftLine } from '@/lib/goods-draft';
import { haptic } from '@/lib/haptics';
import { useSpaces, type Space } from '@/lib/pos-api';
import { useSession } from '@/lib/session';

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const money = (n: number) => formatMoney(n, { kopecks: 'auto' });
const text = (n: number | null | undefined, factor = 1) => (n ? numberText(n / factor) : '');
/** Пустое поле — null, иначе целое в базовой единице. */
const toBase = (value: string, factor: number) => {
  const n = parseDecimal(value);
  return n === null || n === 0 ? null : Math.round(n * factor);
};
const NO_LINES: DraftLine[] = [];
const NO_PACK = 'none';

/**
 * Редактор позиции меню или ингредиента. Позиция: главное сверху (название, цена,
 * категория), ниже «Состав» — есть строки, значит учёт по составу; остальное (где
 * продаётся, учёт штуками, теги, зона) свёрнуто в «Дополнительно». Ингредиент: в чём
 * считать, фасовка при закупке, точка заказа. Остаток здесь не меняется — только документами.
 */
export default function GoodsEditScreen() {
  const { itemId, categoryId, kind } = useLocalSearchParams<{ itemId?: string; categoryId?: string; kind?: string }>();
  const goods = useGoods();
  const spaces = useSpaces();

  if (!goods.data) {
    return (
      <FormHost>
        {goods.isError ? (
          <ContentUnavailableView title="Нет связи" systemImage="wifi.exclamationmark" description={errorText(goods.error)} />
        ) : (
          <ProgressView />
        )}
      </FormHost>
    );
  }
  const original = itemId ? (goods.data.byId.get(itemId) ?? null) : null;
  if (itemId && !original) {
    return (
      <FormHost>
        <ContentUnavailableView title="Позиция удалена" systemImage="trash" />
      </FormHost>
    );
  }
  if (original?.kind === 'ingredient' || (!original && kind === 'ingredient')) return <IngredientForm key={original?.id ?? 'new'} original={original} />;
  return <ItemForm key={original?.id ?? 'new'} original={original} presetCategory={categoryId ?? null} catalog={goods.data} spaces={spaces.data ?? []} />;
}

function useRemove(original: GoodsItem | null) {
  const router = useRouter();
  return () =>
    original &&
    Alert.alert(
      `Удалить «${original.name}»?`,
      original.kind === 'ingredient' ? 'Ингредиент пропадёт из остатков.' : 'Позиция исчезнет из меню и кассы. Прошлые чеки сохранятся.',
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Удалить',
          style: 'destructive',
          onPress: () =>
            deleteItem(original.id)
              .then(() => {
                haptic.success();
                router.dismissTo('/manage/goods');
              })
              .catch((error: unknown) => Alert.alert('Не удалено', errorText(error))),
        },
      ],
    );
}

/* ─────────────────────────── Позиция меню ─────────────────────────── */

function ItemForm({
  original,
  presetCategory,
  catalog,
  spaces,
}: {
  original: GoodsItem | null;
  presetCategory: string | null;
  catalog: Catalog;
  spaces: Space[];
}) {
  const router = useRouter();
  const isOwner = useSession((s) => s.user?.role === 'owner');
  const remove = useRemove(original);
  const draftKey = original?.id ?? 'new';
  const recipeReady = useDocDraft((s) => s.mode === 'recipe' && s.productId === draftKey);
  const lines = useDocDraft((s) => (s.mode === 'recipe' && s.productId === draftKey ? s.lines : NO_LINES));

  const [name, setName] = useState(original?.name ?? '');
  const [price, setPrice] = useState(original ? numberText(original.price, 2) : '');
  const [category, setCategory] = useState<string | null>(original ? original.category : presetCategory);
  const [flags, setFlags] = useState({
    isActive: original?.isActive ?? true,
    isTabletVisible: original?.isTabletVisible ?? false,
    isScreenVisible: original?.isScreenVisible ?? true,
    isTop: original?.isTop ?? false,
  });
  const [pieces, setPieces] = useState(original?.stockMode === 'pieces');
  const [reorder, setReorder] = useState(text(original?.reorderPoint));
  const [par, setPar] = useState(text(original?.parLevel));
  const [cost, setCost] = useState(original && original.costPrice > 0 ? numberText(Math.round(original.costPrice * 100) / 100, 2) : '');
  const [costTouched, setCostTouched] = useState(false);
  const [tags, setTags] = useState((original?.searchTags ?? []).join(', '));
  const [spaceId, setSpaceId] = useState<string | null>(original?.linkedSpaceId ?? null);
  const [more, setMore] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);

  // Состав — в общем черновике: экран «Добавить ингредиент» дописывает его туда же.
  useEffect(() => {
    const initial = (original?.recipe ?? []).map((line) =>
      draftLineOf('recipe', catalog.byId.get(line.componentId) ?? null, { itemId: line.componentId, quantity: line.quantity }),
    );
    const session = useDocDraft.getState().start('recipe', initial, draftKey);
    return () => useDocDraft.getState().reset(session);
    // Начальный состав берём один раз, при открытии.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Есть состав — учёт по составу; нет — штуками (если включено) или без учёта.
  const mode: StockMode = lines.length > 0 ? 'recipe' : pieces ? 'pieces' : 'none';
  const categories = catalog.categories.filter((c) => !isTariffCategory(c));
  const priceValue = parseDecimal(price);
  const costValue = parseDecimal(cost);
  const costEditable = mode === 'none' || (mode === 'pieces' && !original?.hasReceipts);
  const portionCost = recipeCost(
    lines.map((l) => ({ componentId: l.itemId ?? '', quantity: baseQuantity(l) })),
    catalog.byId,
  );
  const shownCost = mode === 'recipe' ? portionCost : costEditable ? (costValue ?? 0) : (original?.costPrice ?? 0);
  const m = priceValue !== null ? margin(priceValue, shownCost) : null;
  const canSave = name.trim().length > 0 && priceValue !== null && (!costEditable || cost.trim() === '' || costValue !== null);

  const priceFooter =
    m !== null
      ? `Себестоимость ${money(shownCost)}${mode === 'recipe' ? ' по составу' : ''} · маржа ${m}% · ${money((priceValue ?? 0) - shownCost)} с продажи.`
      : mode === 'none'
        ? 'Добавьте состав — себестоимость и маржа посчитаются сами.'
        : null;

  const stockLeft = !!original && original.stockMode === 'pieces' && mode !== 'pieces' && original.stockQuantity !== 0;
  const summary = [
    flags.isActive ? 'касса' : 'скрыта из кассы',
    flags.isTabletVisible ? 'Titan Home' : null,
    flags.isScreenVisible ? 'экран ТВ' : null,
    flags.isTop ? 'хит' : null,
    mode === 'pieces' ? 'учёт штуками' : null,
    tags.trim() ? 'теги' : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const save = async () => {
    if (mode === 'recipe' && lines.some((l) => baseQuantity(l) <= 0)) {
      setShowErrors(true);
      haptic.error();
      Alert.alert('Проверьте состав', 'Укажите, сколько каждого ингредиента уходит на порцию, или уберите лишнюю строку.');
      return;
    }
    const input: ItemInput = {
      name: name.trim(),
      price: priceValue ?? 0,
      category,
      ...flags,
      searchTags: tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      stockMode: mode,
      ...(mode === 'recipe' ? { recipe: lines.map((l) => ({ componentId: l.itemId!, quantity: baseQuantity(l) })) } : {}),
      ...(mode === 'pieces' ? { reorderPoint: toBase(reorder, 1), parLevel: toBase(par, 1) } : {}),
      ...(costEditable && costTouched && costValue !== null ? { costPrice: costValue } : {}),
      ...(spaceId !== (original?.linkedSpaceId ?? null) ? { linkedSpaceId: spaceId } : {}),
    };
    haptic.medium();
    setBusy(true);
    try {
      if (original) await updateItem(original.id, input);
      else await createItem('goods', input);
      haptic.success();
      router.back();
    } catch (error) {
      haptic.error();
      Alert.alert('Позиция не сохранена', errorText(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <EditorToolbar title={original ? 'Позиция' : 'Новая позиция'} canSave={canSave} busy={busy} onSave={() => void save()} />
      <FormHost>
        <Form>
          <Section footer={priceFooter ? <Text>{priceFooter}</Text> : undefined}>
            <FieldRow value={name} placeholder="Название, например Наггетсы 6 шт" autoFocus={!original} maxLength={120} onChange={setName} />
            <HStack spacing={8}>
              <Text modifiers={[primary]}>Цена</Text>
              <FieldRow value={price} placeholder="0" keyboard="decimal-pad" trailing onChange={setPrice} />
              <Text modifiers={[secondary]}>₽</Text>
            </HStack>
            <Picker
              label="Категория"
              selection={category ?? 'none'}
              onSelectionChange={(value) => setCategory(value === 'none' ? null : String(value))}
              modifiers={[pickerStyle('menu')]}
            >
              {[{ id: 'none', name: 'Без категории' }, ...categories].map((c) => (
                <Text key={c.id} modifiers={[tag(c.id)]}>
                  {c.name}
                </Text>
              ))}
            </Picker>
          </Section>

          {recipeReady ? <RecipeSection catalog={catalog} showErrors={showErrors} /> : null}

          <Section>
            <DisclosureRow title="Дополнительно" subtitle={summary} open={more} onToggle={() => setMore((v) => !v)} />
          </Section>

          {more && (
            <>
              <Section title="Где продаётся" footer={<Text>В Titan Home позицию видно, если её категория тоже показана гостям.</Text>}>
                <Toggle label="В кассе" isOn={flags.isActive} onIsOnChange={(on) => setFlags((f) => ({ ...f, isActive: on }))} />
                <Toggle label="В Titan Home" isOn={flags.isTabletVisible} onIsOnChange={(on) => setFlags((f) => ({ ...f, isTabletVisible: on }))} />
                <Toggle label="На экране ТВ" isOn={flags.isScreenVisible} onIsOnChange={(on) => setFlags((f) => ({ ...f, isScreenVisible: on }))} />
                <Toggle label="Хит продаж" isOn={flags.isTop} onIsOnChange={(on) => setFlags((f) => ({ ...f, isTop: on }))} />
              </Section>

              <Section
                title="Склад"
                footer={
                  <Text>
                    {[
                      mode === 'recipe'
                        ? 'Позиция с составом списывает ингредиенты, а не себя. Учёт штуками — для позиций без состава.'
                        : 'Для готового товара — банка колы, шоколадка: продажа спишет одну штуку, остаток пополняет приход.',
                      stockLeft ? `На складе ещё ${itemQty(original, original.stockQuantity)} — их можно списать.` : null,
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  </Text>
                }
              >
                {mode === 'recipe' ? (
                  <LinkRow icon="list.bullet.rectangle" color="#8B5CF6" title="Учёт по составу" value={`${lines.length} в составе`} />
                ) : (
                  <Toggle
                    label="Считать штуки на складе"
                    isOn={pieces}
                    onIsOnChange={(on) => {
                      haptic.selection();
                      setPieces(on);
                    }}
                  />
                )}
                {mode === 'pieces' ? (
                  <>
                    <InputRow
                      label="Точка заказа"
                      caption="Предупредить, когда останется столько"
                      value={reorder}
                      placeholder="—"
                      keyboard="numeric"
                      maxLength={6}
                      onChange={setReorder}
                    />
                    <InputRow
                      label="Дозаказ до"
                      caption="Сколько держать после прихода"
                      value={par}
                      placeholder="—"
                      keyboard="numeric"
                      maxLength={6}
                      onChange={setPar}
                    />
                  </>
                ) : null}
              </Section>

              {mode !== 'recipe' && costEditable ? (
                <Section title="Себестоимость" footer={<Text>Для маржи. С первым приходом её начнёт считать склад по ценам закупки.</Text>}>
                  <InputRow
                    label="За штуку, ₽"
                    value={cost}
                    placeholder="0"
                    keyboard="decimal-pad"
                    onChange={(next) => {
                      setCost(next);
                      setCostTouched(true);
                    }}
                  />
                </Section>
              ) : null}

              <Section title="Поиск в кассе" footer={<Text>Через запятую: касса найдёт позицию и по этим словам.</Text>}>
                <FieldRow value={tags} placeholder="кола, газировка" onChange={setTags} />
              </Section>

              {spaces.length > 0 && (original?.role === 'rental' || !original) ? (
                <Section footer={<Text>Для аренды: касса свяжет позицию с зоной.</Text>}>
                  <Picker
                    label="Зона аренды"
                    selection={spaceId ?? 'none'}
                    onSelectionChange={(value) => setSpaceId(value === 'none' ? null : String(value))}
                    modifiers={[pickerStyle('menu')]}
                  >
                    {[{ id: 'none', name: 'Не привязана' }, ...spaces].map((s) => (
                      <Text key={s.id} modifiers={[tag(s.id)]}>
                        {s.name}
                      </Text>
                    ))}
                  </Picker>
                </Section>
              ) : null}

              {original && isOwner && (
                <Section>
                  <ActionRow title="Удалить позицию" icon="trash" destructive onPress={() => remove()} />
                </Section>
              )}
            </>
          )}
        </Form>
      </FormHost>
    </>
  );
}

/* ─────────────────────────── Ингредиент ─────────────────────────── */

/** Слово единицы для полей запаса и фасовки: «шт», «пачек», «кг», «л». */
const bigWord = (unit: Unit, label: PieceName | null) => (unit === 'pcs' ? PIECE_NAMES[label ?? 'pcs'].forms[2] : BIG_UNIT[unit].label);

function IngredientForm({ original }: { original: GoodsItem | null }) {
  const router = useRouter();
  const isOwner = useSession((s) => s.user?.role === 'owner');
  const remove = useRemove(original);
  const startFactor = BIG_UNIT[original?.unit ?? 'pcs'].factor;

  const [name, setName] = useState(original?.name ?? '');
  const [unit, setUnit] = useState<Unit>(original?.unit ?? 'pcs');
  const [label, setLabel] = useState<PieceName | null>(original?.unitLabel ?? null);
  const [packName, setPackName] = useState<PieceName | null>(original?.packName ?? null);
  const [packSize, setPackSize] = useState(text(original?.packSize, startFactor));
  const [reorder, setReorder] = useState(text(original?.reorderPoint, startFactor));
  const [par, setPar] = useState(text(original?.parLevel, startFactor));
  const [cost, setCost] = useState(original && original.costPrice > 0 ? numberText(Math.round(original.costPrice * startFactor * 100) / 100, 2) : '');
  const [costTouched, setCostTouched] = useState(false);
  const [busy, setBusy] = useState(false);

  // Единицу меняем, пока по ингредиенту не было движений (иначе остаток потерял бы смысл).
  const unitLocked = !!original && (original.hasReceipts || original.stockQuantity !== 0);
  const factor = BIG_UNIT[unit].factor;
  const pieceLabel = unit === 'pcs' ? label : null;
  const word = bigWord(unit, pieceLabel);
  const costEditable = !original?.hasReceipts;
  const costValue = parseDecimal(cost);
  const packValue = toBase(packSize, factor);
  const packMissing = packName !== null && !packValue;
  const canSave = name.trim().length > 0 && !packMissing && (!costEditable || cost.trim() === '' || costValue !== null);

  const save = async () => {
    // Сменили единицу — цена в поле теперь за новую единицу: отправляем её, даже если поле
    // не трогали, иначе на сервере останется цена за прежнюю (89 ₽/шт стали бы 89 ₽/мл).
    const unitChanged = !!original && unit !== original.unit;
    const input: ItemInput = {
      name: name.trim(),
      ...(unitLocked ? {} : { unit }),
      unitLabel: pieceLabel,
      packName: packName && packValue ? packName : null,
      packSize: packName && packValue ? packValue : null,
      reorderPoint: toBase(reorder, factor),
      parLevel: toBase(par, factor),
      ...(costEditable && (costTouched || unitChanged) && costValue !== null ? { costPrice: Math.round((costValue / factor) * 10000) / 10000 } : {}),
    };
    haptic.medium();
    setBusy(true);
    try {
      if (original) await updateItem(original.id, input);
      else await createItem('ingredient', input);
      haptic.success();
      router.back();
    } catch (error) {
      haptic.error();
      Alert.alert('Ингредиент не сохранён', errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const choosePack = (value: string) => {
    if (value === NO_PACK) {
      setPackName(null);
      return;
    }
    setPackName(value as PieceName);
  };

  return (
    <>
      <EditorToolbar title={original ? 'Ингредиент' : 'Новый ингредиент'} canSave={canSave} busy={busy} onSave={() => void save()} />
      <FormHost>
        <Form>
          <Section footer={<Text>Ингредиент не продаётся сам — его списывают продажи блюд, в чьём составе он есть.</Text>}>
            <FieldRow value={name} placeholder="Название, например Наггетсы" autoFocus={!original} maxLength={120} onChange={setName} />
          </Section>

          <Section
            title="Считаем в"
            footer={
              <Text>
                {unitLocked
                  ? 'По ингредиенту уже были движения — единицу не поменять, а название штуки можно.'
                  : unit === 'pcs'
                    ? 'Штуки — то, что кладут в порцию целиком: наггетс, пачка соуса, стакан.'
                    : 'Остаток ведётся в граммах и миллилитрах, а в приходе и на складе показывается в килограммах и литрах.'}
              </Text>
            }
          >
            {unitLocked ? (
              <LinkRow title="Единица" value={UNIT_CHOICES.find((c) => c.unit === unit)?.title ?? unit} />
            ) : (
              <Picker
                selection={unit}
                onSelectionChange={(value) => {
                  haptic.selection();
                  setUnit(value as Unit);
                }}
                modifiers={[pickerStyle('segmented')]}
              >
                {UNIT_CHOICES.map((choice) => (
                  <Text key={choice.unit} modifiers={[tag(choice.unit)]}>
                    {choice.title}
                  </Text>
                ))}
              </Picker>
            )}
            {unit === 'pcs' ? (
              <Picker
                label="Штука называется"
                selection={label ?? 'pcs'}
                onSelectionChange={(value) => setLabel(value === 'pcs' ? null : (value as PieceName))}
                modifiers={[pickerStyle('menu')]}
              >
                {PIECE_CHOICES.map((choice) => (
                  <Text key={choice} modifiers={[tag(choice)]}>
                    {choice === 'pcs' ? 'Штука (шт)' : PIECE_NAMES[choice].title}
                  </Text>
                ))}
              </Picker>
            ) : null}
          </Section>

          <Section
            title="Фасовка при закупке"
            footer={
              <Text>
                {packMissing
                  ? `Укажите, сколько в ${PIECE_NAMES[packName].in}.`
                  : 'Как приходит от поставщика. В приходе вносите упаковки — количество подставится само, его можно поправить на факт.'}
              </Text>
            }
          >
            <Picker label="Упаковка" selection={packName ?? NO_PACK} onSelectionChange={(value) => choosePack(String(value))} modifiers={[pickerStyle('menu')]}>
              {[NO_PACK, ...PIECE_CHOICES.filter((c) => c !== 'pcs')].map((choice) => (
                <Text key={choice} modifiers={[tag(choice)]}>
                  {choice === NO_PACK ? 'Без фасовки' : PIECE_NAMES[choice as PieceName].title}
                </Text>
              ))}
            </Picker>
            {packName ? (
              <InputRow
                label={`В ${PIECE_NAMES[packName].in}, ${word}`}
                caption="Обычно; в приходе поправите на факт"
                value={packSize}
                placeholder="—"
                keyboard={unit === 'pcs' ? 'numeric' : 'decimal-pad'}
                maxLength={8}
                onChange={setPackSize}
              />
            ) : null}
          </Section>

          <Section
            title="Запас"
            footer={<Text>{`В ${word}. Когда останется меньше точки заказа, ингредиент попадёт в «Заканчивается» и сотрудникам придёт уведомление.`}</Text>}
          >
            <InputRow label="Точка заказа" value={reorder} placeholder="—" keyboard="decimal-pad" maxLength={8} onChange={setReorder} />
            <InputRow label="Дозаказ до" value={par} placeholder="—" keyboard="decimal-pad" maxLength={8} onChange={setPar} />
          </Section>

          {costEditable ? (
            <Section title="Себестоимость" footer={<Text>Только до первого прихода — дальше её считает склад по ценам закупки.</Text>}>
              <InputRow
                label={`Цена за ${unit === 'pcs' ? PIECE_NAMES[pieceLabel ?? 'pcs'].per : BIG_UNIT[unit].label}, ₽`}
                value={cost}
                placeholder="0"
                keyboard="decimal-pad"
                onChange={(next) => {
                  setCost(next);
                  setCostTouched(true);
                }}
              />
            </Section>
          ) : null}

          {original && isOwner && (
            <Section>
              <ActionRow title="Удалить ингредиент" icon="trash" destructive onPress={() => remove()} />
            </Section>
          )}
        </Form>
      </FormHost>
    </>
  );
}
