import { Button, ContentUnavailableView, Form, HStack, Host, ProgressView, Section, Spacer, SwipeActions, Text } from '@expo/ui/swift-ui';
import { font, monospacedDigit } from '@expo/ui/swift-ui/modifiers';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet } from 'react-native';

import { useAutosave } from '@/components/goods/autosave';
import { DocLineRow, NumberInput, positionsText } from '@/components/goods/parts';
import { ActionRow, FieldRow, primary } from '@/components/native-form';
import { GlassChip } from '@/components/new-check-parts';
import { ToolbarButton } from '@/components/toolbar';
import { promptText } from '@/lib/dialog';
import { formatMoney } from '@/lib/format';
import { itemQty, unitWord, useGoods, type Catalog } from '@/lib/goods-api';
import { WRITE_OFF_REASONS, deleteWriteOff, postWriteOff, saveWriteOffDraft, useWriteOff, type WriteOffDetail } from '@/lib/goods-docs';
import { baseQuantity, draftLineOf, useDocDraft, withPreset } from '@/lib/goods-draft';
import { haptic } from '@/lib/haptics';
import { newIdempotencyKey } from '@/lib/shift-api';
import { colors, space } from '@/lib/theme';

const money = (n: number) => formatMoney(n, { kopecks: 'auto' });
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const timeFormat = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' });

/**
 * Списание: бой, порча, угощение — одним документом на несколько позиций. Порция по
 * составу списывает свои ингредиенты. Больше, чем есть на складе, не спишется.
 */
export default function WriteOffScreen() {
  const { draftId, itemId } = useLocalSearchParams<{ draftId?: string; itemId?: string }>();
  const goods = useGoods();
  const source = useWriteOff(draftId);

  // Черновик из кэша на диске мог устареть: редактор берёт состав один раз, поэтому ждём
  // ответа сервера — иначе автосохранение затёрло бы более новую версию.
  if (!goods.data || (draftId && (!source.data || !source.isFetchedAfterMount))) {
    const error = goods.error ?? source.error;
    return (
      <>
        <Stack.Title>Списание</Stack.Title>
        <Host style={{ flex: 1 }} useViewportSizeMeasurement>
          {error ? <ContentUnavailableView title="Не загрузилось" systemImage="wifi.exclamationmark" description={errorText(error)} /> : <ProgressView />}
        </Host>
      </>
    );
  }
  return <WriteOffEditor sourceId={draftId ?? null} source={source.data ?? null} presetItem={itemId ?? null} catalog={goods.data} />;
}

function WriteOffEditor({
  sourceId,
  source,
  presetItem,
  catalog,
}: {
  sourceId: string | null;
  source: WriteOffDetail | null;
  presetItem: string | null;
  catalog: Catalog;
}) {
  const router = useRouter();
  const lines = useDocDraft((s) => s.lines);
  const revision = useDocDraft((s) => s.revision);
  const ready = useDocDraft((s) => s.mode === 'write_off');
  const { setText, remove } = useDocDraft.getState();

  const draft = source?.writeOff.draftData;
  const [draftId, setDraftId] = useState<string | null>(sourceId);
  // id черновика для сохранений и проведения: окно «Списать?» держит замыкание старого
  // рендера, а черновик мог родиться, пока оно открыто.
  const draftRef = useRef(draftId);
  const [reason, setReason] = useState(draft?.reason ?? '');
  const [note, setNote] = useState(draft?.note ?? '');
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [idempotencyKey] = useState(newIdempotencyKey);

  useEffect(() => {
    // Позиция из карточки — часть начального состава, не правка: черновик не родится, пока его не тронули.
    const preset = presetItem ? catalog.byId.get(presetItem) : undefined;
    const initial = (draft?.items ?? []).map((l) => draftLineOf('write_off', catalog.byId.get(l.itemId) ?? null, l));
    const session = useDocDraft.getState().start('write_off', withPreset('write_off', initial, preset));
    return () => useDocDraft.getState().reset(session);
    // Состав берём один раз, при открытии редактора.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rows = lines.map((line) => {
    const item = line.itemId ? catalog.byId.get(line.itemId) : undefined;
    const qty = baseQuantity(line);
    return { line, item, qty, cost: item ? qty * item.costPrice : 0 };
  });
  const total = rows.reduce((sum, r) => sum + r.cost, 0);
  const valid = rows.length > 0 && rows.every((r) => r.qty > 0) && reason.trim().length > 0;
  const payload = rows.filter((r) => r.line.itemId).map((r) => ({ itemId: r.line.itemId!, quantity: r.qty }));

  const autosave = useAutosave(`${revision}|${reason}|${note}`, ready && !done && !busy && (lines.length > 0 || !!draftId), async () => {
    const id = await saveWriteOffDraft(draftRef.current, reason, note, payload);
    draftRef.current = id;
    setDraftId(id);
  });

  const post = async () => {
    haptic.medium();
    setBusy(true);
    try {
      await autosave.flush();
      await postWriteOff(draftRef.current, reason.trim(), note, payload, idempotencyKey);
      setDone(true);
      haptic.success();
      router.back();
    } catch (error) {
      haptic.error();
      Alert.alert('Не списано', `${errorText(error)}\n\nОстатки не изменились.`);
    } finally {
      setBusy(false);
    }
  };

  const confirm = () => {
    setShowErrors(true);
    if (!valid) {
      haptic.error();
      Alert.alert(
        'Проверьте списание',
        !reason.trim() ? 'Выберите причину.' : rows.length === 0 ? 'Добавьте, что списать.' : 'Укажите количество у каждой позиции.',
      );
      return;
    }
    Alert.alert('Списать?', `${positionsText(rows.length)} на ${money(total)} — «${reason.trim()}». Остатки уменьшатся.`, [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Списать', style: 'destructive', onPress: () => void post() },
    ]);
  };

  const otherReason = () =>
    promptText(
      'Причина списания',
      undefined,
      [
        { text: 'Отмена', style: 'cancel' },
        { text: 'Готово', onPress: (value?: string) => value?.trim() && setReason(value.trim()) },
      ],
      'plain-text',
      WRITE_OFF_REASONS.includes(reason) ? '' : reason,
    );

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
            .then(() => deleteWriteOff(draftId))
            .then(() => router.back())
            .catch((error: unknown) => Alert.alert('Черновик не удалён', errorText(error)));
        },
      },
    ]);

  const custom = reason && !WRITE_OFF_REASONS.includes(reason);

  return (
    <>
      <Stack.Title>Списание</Stack.Title>
      <Stack.Toolbar placement="right">
        <ToolbarButton variant="done" tintColor={colors.accent} disabled={busy || lines.length === 0} onPress={confirm}>
          {busy ? 'Списываем…' : 'Списать'}
        </ToolbarButton>
      </Stack.Toolbar>
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <Form>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips} contentContainerStyle={styles.chipsContent}>
            {WRITE_OFF_REASONS.map((r) => (
              <GlassChip
                key={r}
                label={r}
                active={reason === r}
                tint={colors.red}
                onPress={() => {
                  haptic.selection();
                  setReason(r);
                }}
              />
            ))}
            <GlassChip label={custom ? reason : 'Другая…'} active={!!custom} tint={colors.red} onPress={otherReason} />
          </ScrollView>
          {showErrors && !reason.trim() ? <Section footer={<Text>Выберите причину — она попадёт в историю и аналитику потерь.</Text>}>{null}</Section> : null}

          <Section
            title={lines.length ? `Что списать · ${positionsText(lines.length)}` : 'Что списать'}
            footer={lines.length ? <Text>Больше, чем есть на складе, не спишется. Смахните строку влево, чтобы убрать её.</Text> : undefined}
          >
            {rows.map(({ line, item, qty, cost }) => {
              const invalid = showErrors && qty <= 0;
              const recipe = item?.stockMode === 'recipe';
              const over = item && !recipe && qty > Math.max(0, item.stockQuantity);
              const caption = invalid
                ? 'Укажите количество'
                : recipe
                  ? 'спишется состав порции'
                  : item
                    ? `на складе ${itemQty(item, item.stockQuantity)}${over ? ' — спишется только это' : ''}`
                    : undefined;
              return (
                <SwipeActions key={line.key}>
                  <DocLineRow
                    title={line.name}
                    caption={caption}
                    captionColor={invalid || over ? colors.red : undefined}
                    total={cost > 0 ? money(cost) : undefined}
                    fields={
                      <NumberInput
                        key={`${line.key}-${line.version}`}
                        label={`${line.name}, количество`}
                        value={line.qty}
                        integer
                        invalid={invalid}
                        suffix={recipe ? 'порц.' : unitWord(line.unit, line.label, line.qty)}
                        onChange={(t) => setText(line.key, 'qty', t)}
                      />
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
              onPress={() => router.push({ pathname: '/manage/goods/pick', params: { mode: 'write_off' } })}
            />
          </Section>

          <Section title="Комментарий">
            <FieldRow value={note} placeholder="Необязательно: что случилось" multiline onChange={setNote} />
          </Section>

          <Section
            footer={
              <Text>
                {autosave.savedAt ? `Черновик сохранён в ${timeFormat.format(autosave.savedAt)}. ` : 'Черновик сохраняется сам. '}
                Сумма — по себестоимости, она уйдёт в потери.
              </Text>
            }
          >
            <HStack>
              <Text modifiers={[primary, font({ weight: 'semibold' })]}>Итого</Text>
              <Spacer />
              <Text modifiers={[primary, monospacedDigit(), font({ textStyle: 'title3', weight: 'bold', design: 'rounded' })]}>{money(total)}</Text>
            </HStack>
          </Section>

          {draftId ? (
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
  chips: { marginHorizontal: -space.lg, flexGrow: 0, flexShrink: 0 },
  chipsContent: { gap: space.sm, paddingHorizontal: space.lg },
});
