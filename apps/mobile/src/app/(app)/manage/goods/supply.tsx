import { Button, ContentUnavailableView, Form, HStack, Host, Picker, ProgressView, Section, Spacer, SwipeActions, Text } from '@expo/ui/swift-ui';
import { font, monospacedDigit, pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet } from 'react-native';

import { useAutosave } from '@/components/goods/autosave';
import { DocLineRow, NumberInput, positionsText } from '@/components/goods/parts';
import { ActionRow, FieldRow, primary } from '@/components/native-form';
import { GlassChip } from '@/components/new-check-parts';
import { ToolbarButton } from '@/components/toolbar';
import { formatMoney } from '@/lib/format';
import { BIG_UNIT, PIECE_NAMES, itemQty, packText, unitWord, useGoods, useSuppliers, type Catalog } from '@/lib/goods-api';
import { correctSupply, deleteSupply, postSupply, saveSupplyDraft, useSupply, type SupplyDetail, type SupplyLine } from '@/lib/goods-docs';
import { draftLineOf, supplyTotal, supplyValues, useDocDraft, withPreset, type DraftLine } from '@/lib/goods-draft';
import { haptic } from '@/lib/haptics';
import { newIdempotencyKey } from '@/lib/shift-api';
import { colors, space } from '@/lib/theme';

const money = (n: number) => formatMoney(n, { kopecks: 'auto' });
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const timeFormat = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' });

type Mode = 'new' | 'draft' | 'correct';

/**
 * Приход: что пришло, сколько и почём. Позиции — из каталога (отметить сразу несколько,
 * «Добавить заканчивающиеся»), количество и цена — в одной строке, в килограммах и литрах
 * для сырья. Черновик сохраняется сам; «Провести» добавляет остатки и пересчитывает
 * себестоимость. Оплата «из кассы» уменьшает наличные в кассе смены.
 */
export default function SupplyScreen() {
  const { draftId, supplyId, itemId } = useLocalSearchParams<{ draftId?: string; supplyId?: string; itemId?: string }>();
  const goods = useGoods();
  const source = useSupply(supplyId ?? draftId);
  const mode: Mode = supplyId ? 'correct' : draftId ? 'draft' : 'new';

  // Документ из кэша на диске мог устареть: редактор берёт состав один раз, поэтому ждём
  // ответа сервера — иначе автосохранение затёрло бы более новую версию черновика.
  if (!goods.data || (mode !== 'new' && (!source.data || !source.isFetchedAfterMount))) {
    const error = goods.error ?? source.error;
    return (
      <>
        <Stack.Title>Приход</Stack.Title>
        <Host style={{ flex: 1 }} useViewportSizeMeasurement>
          {error ? <ContentUnavailableView title="Не загрузилось" systemImage="wifi.exclamationmark" description={errorText(error)} /> : <ProgressView />}
        </Host>
      </>
    );
  }
  return <SupplyEditor mode={mode} sourceId={supplyId ?? draftId ?? null} source={source.data ?? null} presetItem={itemId ?? null} catalog={goods.data} />;
}

/** Состав из сохранённого документа: проведённого (корректировка) или черновика. */
function initialLines(mode: Mode, source: SupplyDetail | null, catalog: Catalog): DraftLine[] {
  if (!source) return [];
  const saved = mode === 'correct' ? source.items : (source.supply.draftData?.items ?? []);
  return saved.map((line) => draftLineOf('supply', line.itemId ? (catalog.byId.get(line.itemId) ?? null) : null, line));
}

function SupplyEditor({
  mode,
  sourceId,
  source,
  presetItem,
  catalog,
}: {
  mode: Mode;
  sourceId: string | null;
  source: SupplyDetail | null;
  presetItem: string | null;
  catalog: Catalog;
}) {
  const router = useRouter();
  const suppliers = useSuppliers();
  const lines = useDocDraft((s) => s.lines);
  const revision = useDocDraft((s) => s.revision);
  const ready = useDocDraft((s) => s.mode === 'supply');
  const { setText, remove } = useDocDraft.getState();

  const [draftId, setDraftId] = useState<string | null>(mode === 'draft' ? sourceId : null);
  // id черновика для сохранений и проведения: окно «Провести?» держит замыкание старого
  // рендера, а черновик мог родиться, пока оно открыто.
  const draftRef = useRef(draftId);
  const [supplier, setSupplier] = useState(source?.supply.draftData?.supplier ?? source?.supply.supplier ?? '');
  const [supplierVersion, setSupplierVersion] = useState(0);
  const [fromRegister, setFromRegister] = useState(mode === 'correct' ? !!source?.supply.cashOperationId : !!source?.supply.draftData?.fromRegister);
  const [reason, setReason] = useState('');
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [idempotencyKey] = useState(newIdempotencyKey);

  useEffect(() => {
    // Позиция из карточки — часть начального состава, не правка: черновик не родится, пока его не тронули.
    const preset = presetItem ? catalog.byId.get(presetItem) : undefined;
    const session = useDocDraft.getState().start('supply', withPreset('supply', initialLines(mode, source, catalog), preset));
    return () => useDocDraft.getState().reset(session);
    // Состав берём один раз, при открытии редактора.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const parsed = lines.map((line) => ({ line, ...supplyValues(line) }));
  // Итог — как у сервера (Σ количество × цена единицы): столько и уйдёт из кассы.
  const total = supplyTotal(parsed);
  const valid = lines.length > 0 && parsed.every((p) => !p.error) && (mode !== 'correct' || reason.trim().length >= 3);
  const payload: SupplyLine[] = parsed.map((p) => ({
    itemId: p.line.itemId,
    name: p.line.name,
    quantity: p.quantity,
    costPerUnit: p.costPerUnit,
    packs: p.packs,
  }));
  const header = { supplier, fromRegister };

  const autosave = useAutosave(
    `${revision}|${supplier}|${fromRegister}`,
    mode !== 'correct' && ready && !done && !busy && (lines.length > 0 || !!draftId),
    async () => {
      const id = await saveSupplyDraft(draftRef.current, header, payload);
      draftRef.current = id;
      setDraftId(id);
    },
  );

  const post = async () => {
    setShowErrors(true);
    if (!valid) {
      haptic.error();
      Alert.alert(
        mode === 'correct' && reason.trim().length < 3 ? 'Укажите причину корректировки' : 'Проверьте приход',
        lines.length === 0 ? 'Добавьте, что пришло.' : 'Ошибки подписаны под позициями.',
      );
      return;
    }
    haptic.medium();
    setBusy(true);
    try {
      await autosave.flush();
      if (mode === 'correct' && sourceId) await correctSupply(sourceId, payload, reason.trim());
      else {
        const result = await postSupply(draftRef.current, header, payload, idempotencyKey);
        if (result.duplicate) Alert.alert('Приход уже проведён', 'Повторная отправка не задвоила остатки.');
      }
      setDone(true);
      haptic.success();
      router.back();
    } catch (error) {
      haptic.error();
      Alert.alert('Приход не проведён', `${errorText(error)}\n\nОстатки не изменились.`);
    } finally {
      setBusy(false);
    }
  };

  const confirm = () => {
    if (mode === 'correct') return void post();
    Alert.alert(
      'Провести приход?',
      `${positionsText(lines.length)} на ${money(total)}${fromRegister ? ' — наличными из кассы смены' : ''}. Остатки и себестоимость обновятся.`,
      [
        { text: 'Отмена', style: 'cancel' },
        { text: 'Провести', onPress: () => void post() },
      ],
    );
  };

  const removeDraft = () =>
    draftId &&
    Alert.alert('Удалить черновик?', 'Остатки не изменятся.', [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Удалить',
        style: 'destructive',
        onPress: () => {
          setDone(true);
          void autosave
            .flush()
            .then(() => deleteSupply(draftId))
            .then(() => router.back())
            .catch((error: unknown) => Alert.alert('Черновик не удалён', errorText(error)));
        },
      },
    ]);

  const hints = (suppliers.data ?? [])
    .filter((s) => s !== supplier && (!supplier.trim() || s.toLowerCase().includes(supplier.trim().toLowerCase())))
    .slice(0, 8);
  const title = mode === 'correct' ? 'Корректировка прихода' : 'Приход';

  return (
    <>
      <Stack.Title>{title}</Stack.Title>
      <Stack.Toolbar placement="right">
        <ToolbarButton variant="done" tintColor={colors.accent} disabled={busy} onPress={confirm}>
          {busy ? 'Проводим…' : mode === 'correct' ? 'Сохранить' : 'Провести'}
        </ToolbarButton>
      </Stack.Toolbar>
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <Form>
          {mode !== 'correct' && (
            <Section title="Поставщик">
              <FieldRow key={`supplier-${supplierVersion}`} value={supplier} placeholder="Метро, рынок, бар-маркет…" onChange={setSupplier} />
            </Section>
          )}
          {mode !== 'correct' && hints.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips} contentContainerStyle={styles.chipsContent}>
              {hints.map((name) => (
                <GlassChip
                  key={name}
                  label={name}
                  active={false}
                  onPress={() => {
                    haptic.selection();
                    setSupplier(name);
                    setSupplierVersion((v) => v + 1);
                  }}
                />
              ))}
            </ScrollView>
          ) : null}

          {mode !== 'correct' && (
            <Section
              footer={
                <Text>
                  {fromRegister
                    ? 'Сумма прихода уйдёт выдачей из кассы открытой смены — наличные в кассе уменьшатся.'
                    : 'Касса смены не меняется: оплачено переводом, картой или не из кассы.'}
                </Text>
              }
            >
              <Picker
                selection={fromRegister ? 'register' : 'other'}
                onSelectionChange={(value) => setFromRegister(value === 'register')}
                modifiers={[pickerStyle('segmented')]}
              >
                <Text modifiers={[tag('other')]}>Не из кассы</Text>
                <Text modifiers={[tag('register')]}>Из кассы смены</Text>
              </Picker>
            </Section>
          )}

          <Section
            title={lines.length ? `Что пришло · ${positionsText(lines.length)}` : 'Что пришло'}
            footer={lines.length ? <Text>Смахните строку влево, чтобы убрать её. Граммы и миллилитры вносятся в килограммах и литрах.</Text> : undefined}
          >
            {parsed.map(({ line, sum, error }) => {
              const item = line.itemId ? catalog.byId.get(line.itemId) : undefined;
              const big = !line.itemId ? 'шт' : line.unit === 'pcs' ? PIECE_NAMES[line.label ?? 'pcs'].forms[2] : BIG_UNIT[line.unit].label;
              const invalid = showErrors && !!error;
              // С фасовкой цена — за упаковку («₽ за пачку»).
              const byPack = !!line.packSize;
              const priceUnit = byPack ? PIECE_NAMES[line.packName ?? 'pack'].per : line.unit === 'pcs' ? PIECE_NAMES[line.label ?? 'pcs'].per : big;
              const lastPrice = item && item.costPrice > 0 ? item.costPrice * (byPack ? (item.packSize ?? 1) : BIG_UNIT[item.unit].factor) : null;
              const entered = Number(line.price.replace(',', '.')) || 0;
              const priceNote =
                lastPrice && entered > 0 && Math.abs(entered - lastPrice) >= 0.01
                  ? `${entered > lastPrice ? 'дороже' : 'дешевле'} средней (${money(lastPrice)})`
                  : null;
              const caption = invalid
                ? error!
                : [item ? packText(item) : null, item ? `на складе ${itemQty(item, item.stockQuantity)}` : 'затрата без карточки', priceNote]
                    .filter(Boolean)
                    .join(' · ');
              return (
                <SwipeActions key={line.key}>
                  <DocLineRow
                    title={line.name}
                    caption={caption}
                    captionColor={invalid ? colors.red : undefined}
                    total={sum > 0 ? money(sum) : undefined}
                    fields={
                      <>
                        {line.packSize ? (
                          <NumberInput
                            key={`${line.key}-k-${line.version}`}
                            label={`${line.name}, упаковок`}
                            value={line.packs}
                            suffix={unitWord('pcs', line.packName ?? 'pack', line.packs)}
                            onChange={(t) => setText(line.key, 'packs', t)}
                          />
                        ) : null}
                        <NumberInput
                          key={`${line.key}-q-${line.version}`}
                          label={`${line.name}, количество`}
                          value={line.qty}
                          suffix={big}
                          invalid={invalid && error === 'Укажите количество'}
                          onChange={(t) => setText(line.key, 'qty', t)}
                        />
                        <NumberInput
                          key={`${line.key}-p-${line.version}`}
                          label={`${line.name}, цена`}
                          value={line.price}
                          suffix={`₽ за ${priceUnit}`}
                          onChange={(t) => setText(line.key, 'price', t)}
                        />
                      </>
                    }
                  />
                  <SwipeActions.Actions edge="trailing">
                    <Button role="destructive" label="Убрать" systemImage="minus.circle" onPress={() => remove(line.key)} />
                  </SwipeActions.Actions>
                </SwipeActions>
              );
            })}
            <ActionRow
              title={lines.length ? 'Добавить ещё' : 'Добавить из каталога'}
              icon="plus.circle.fill"
              onPress={() => router.push({ pathname: '/manage/goods/pick', params: { mode: 'supply' } })}
            />
          </Section>

          {mode === 'correct' && (
            <Section
              title="Причина корректировки"
              footer={showErrors && reason.trim().length < 3 ? <Text>Не короче 3 символов — она попадёт в историю прихода.</Text> : undefined}
            >
              <FieldRow value={reason} placeholder="Например, ошиблись в количестве" multiline onChange={setReason} />
            </Section>
          )}

          <Section
            footer={
              <Text>
                {mode === 'correct'
                  ? 'Остатки сдвинутся на разницу с прежним составом.'
                  : autosave.savedAt
                    ? `Черновик сохранён в ${timeFormat.format(autosave.savedAt)}. Остатки изменятся, только когда проведёте приход.`
                    : 'Черновик сохраняется сам. Остатки изменятся, только когда проведёте приход.'}
              </Text>
            }
          >
            <HStack>
              <Text modifiers={[primary, font({ weight: 'semibold' })]}>Итого</Text>
              <Spacer />
              <Text modifiers={[primary, monospacedDigit(), font({ textStyle: 'title3', weight: 'bold', design: 'rounded' })]}>{money(total)}</Text>
            </HStack>
          </Section>

          {draftId && mode !== 'correct' ? (
            <Section>
              <ActionRow title="Удалить черновик" icon="trash" destructive onPress={() => removeDraft()} />
            </Section>
          ) : null}
        </Form>
      </Host>
    </>
  );
}

const styles = StyleSheet.create({
  chips: { marginHorizontal: -space.lg, marginTop: -space.sm, flexGrow: 0, flexShrink: 0 },
  chipsContent: { gap: space.sm, paddingHorizontal: space.lg },
});
