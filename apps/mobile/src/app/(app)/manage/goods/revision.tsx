import { ContentUnavailableView, Form, HStack, Host, ProgressView, Section, Text } from '@expo/ui/swift-ui';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';

import { Tile } from '@/components/analytics/native';
import { useAutosave } from '@/components/goods/autosave';
import { NumberInput, positionsText } from '@/components/goods/parts';
import { ActionRow } from '@/components/native-form';
import { GlassChip } from '@/components/new-check-parts';
import { Text as RNText } from '@/components/text';
import { ToolbarButton } from '@/components/toolbar';
import { isTariffCategory } from '@/lib/catalog-api';
import { formatMoney } from '@/lib/format';
import { isStockItem, itemQty, unitWord, useGoods, type Catalog, type GoodsItem } from '@/lib/goods-api';
import { deleteRevisionDraft, postRevision, saveRevisionDraft, useRevision, type RevisionDetail } from '@/lib/goods-docs';
import { haptic } from '@/lib/haptics';
import { colors, space, type } from '@/lib/theme';

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const timeFormat = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' });
const RAW = 'raw';
const NONE = 'none';

/**
 * Ревизия: все учётные позиции списком, по категориям и сырьё. Считаете «вслепую» —
 * ожидаемый остаток не виден, чтобы не подгонять. «Сверить» показывает расхождения и их
 * цену; проводятся только посчитанные позиции, остальные не меняются.
 */
export default function RevisionScreen() {
  const { draftId, itemId } = useLocalSearchParams<{ draftId?: string; itemId?: string }>();
  const goods = useGoods();
  const source = useRevision(draftId);

  // Черновик из кэша на диске мог устареть: редактор берёт факты один раз, поэтому ждём
  // ответа сервера — иначе автосохранение затёрло бы более новую версию.
  if (!goods.data || (draftId && (!source.data || !source.isFetchedAfterMount))) {
    const error = goods.error ?? source.error;
    return (
      <>
        <Stack.Title>Ревизия</Stack.Title>
        <Host style={{ flex: 1 }} useViewportSizeMeasurement>
          {error ? <ContentUnavailableView title="Не загрузилось" systemImage="wifi.exclamationmark" description={errorText(error)} /> : <ProgressView />}
        </Host>
      </>
    );
  }
  return <RevisionEditor sourceId={draftId ?? null} source={source.data ?? null} presetItem={itemId ?? null} catalog={goods.data} />;
}

type Row = { item: GoodsItem; actual: number | null; diff: number; value: number };

function RevisionEditor({
  sourceId,
  source,
  presetItem,
  catalog,
}: {
  sourceId: string | null;
  source: RevisionDetail | null;
  presetItem: string | null;
  catalog: Catalog;
}) {
  const router = useRouter();
  const items = useMemo(() => catalog.items.filter(isStockItem), [catalog.items]);
  const [facts, setFacts] = useState<Record<string, string>>(() =>
    Object.fromEntries((source?.revision.draftData?.items ?? []).filter((l) => l.actual !== null).map((l) => [l.itemId, String(l.actual)])),
  );
  const [scope, setScope] = useState<string>(presetItem && !sourceId ? `item:${presetItem}` : 'all');
  const [reviewing, setReviewing] = useState(false);
  const [draftId, setDraftId] = useState<string | null>(sourceId);
  // id черновика для сохранений и проведения: окно «Провести?» держит замыкание старого
  // рендера, а черновик мог родиться, пока оно открыто.
  const draftRef = useRef(draftId);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const groups = useMemo(() => {
    const categories = catalog.categories.filter((c) => !isTariffCategory(c));
    const known = new Set(categories.map((c) => c.id));
    const keyOf = (i: GoodsItem) => (i.kind === 'ingredient' ? RAW : i.category && known.has(i.category) ? i.category : NONE);
    const order = [...categories.map((c) => ({ id: c.id, title: c.name })), { id: NONE, title: 'Без категории' }, { id: RAW, title: 'Ингредиенты' }];
    return order.map((g) => ({ ...g, items: items.filter((i) => keyOf(i) === g.id) })).filter((g) => g.items.length > 0);
  }, [catalog.categories, items]);

  const rows: Row[] = items.map((item) => {
    const raw = (facts[item.id] ?? '').replace(/[^\d]/g, '');
    const actual = raw === '' ? null : Number(raw);
    const diff = actual === null ? 0 : actual - item.stockQuantity;
    return { item, actual, diff, value: diff * item.costPrice };
  });
  const counted = rows.filter((r) => r.actual !== null);
  const changed = counted.filter((r) => r.diff !== 0);
  const surplus = changed.filter((r) => r.diff > 0).reduce((s, r) => s + r.value, 0);
  const shortage = changed.filter((r) => r.diff < 0).reduce((s, r) => s - r.value, 0);
  const payload = counted.map((r) => ({ itemId: r.item.id, actual: r.actual }));

  const autosave = useAutosave(JSON.stringify(payload), !done && !busy && (counted.length > 0 || !!draftId), async () => {
    const id = await saveRevisionDraft(draftRef.current, payload);
    draftRef.current = id;
    setDraftId(id);
  });

  const post = async () => {
    haptic.medium();
    setBusy(true);
    try {
      await autosave.flush();
      const id = await postRevision(
        draftRef.current,
        counted.map((r) => ({ itemId: r.item.id, actual: r.actual! })),
      );
      setDone(true);
      haptic.success();
      router.replace({ pathname: '/manage/goods/doc', params: { type: 'revision', id } });
    } catch (error) {
      haptic.error();
      Alert.alert('Ревизия не проведена', `${errorText(error)}\n\nОстатки не изменились.`);
    } finally {
      setBusy(false);
    }
  };

  const confirm = () =>
    Alert.alert(
      'Провести ревизию?',
      changed.length
        ? `Остатки ${positionsText(changed.length)} станут равны факту, расхождения попадут в журнал.`
        : 'Всё сходится — остатки не изменятся, ревизия сохранится в истории.',
      [
        { text: 'Отмена', style: 'cancel' },
        { text: 'Провести', onPress: () => void post() },
      ],
    );

  const removeDraft = () =>
    draftId &&
    Alert.alert('Удалить черновик ревизии?', 'Остатки не изменятся.', [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Удалить',
        style: 'destructive',
        onPress: () => {
          setDone(true);
          void autosave
            .flush()
            .then(() => deleteRevisionDraft(draftId))
            .then(() => router.back())
            .catch((error: unknown) => Alert.alert('Черновик не удалён', errorText(error)));
        },
      },
    ]);

  if (items.length === 0) {
    return (
      <>
        <Stack.Title>Ревизия</Stack.Title>
        <Host style={{ flex: 1 }} useViewportSizeMeasurement>
          <ContentUnavailableView title="Нечего пересчитывать" systemImage="checklist" description="Остатки ведут ингредиенты и позиции с учётом штуками." />
        </Host>
      </>
    );
  }

  const visibleGroups = scope.startsWith('item:')
    ? groups.map((g) => ({ ...g, items: g.items.filter((i) => `item:${i.id}` === scope) })).filter((g) => g.items.length > 0)
    : groups.filter((g) => scope === 'all' || g.id === scope);
  const money = (n: number) => formatMoney(n, { kopecks: 'auto' });

  return (
    <>
      <Stack.Title>{reviewing ? 'Сверка' : 'Ревизия'}</Stack.Title>
      <Stack.Toolbar placement="right">
        {reviewing ? (
          <ToolbarButton variant="done" tintColor={colors.accent} disabled={busy} onPress={confirm}>
            {busy ? 'Проводим…' : 'Провести'}
          </ToolbarButton>
        ) : (
          <ToolbarButton
            variant="done"
            tintColor={colors.accent}
            disabled={counted.length === 0}
            onPress={() => {
              haptic.medium();
              setReviewing(true);
            }}
          >
            Сверить
          </ToolbarButton>
        )}
      </Stack.Toolbar>
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <Form>
          {reviewing ? (
            <>
              <Section footer={<Text>Излишек и недостача — по себестоимости. Непосчитанные позиции не изменятся.</Text>}>
                <HStack spacing={12}>
                  <Tile label="Посчитано" value={`${counted.length} из ${items.length}`} />
                  <Tile label="Излишек" value={surplus > 0 ? `+${money(surplus)}` : '—'} />
                  <Tile label="Недостача" value={shortage > 0 ? `−${money(shortage)}` : '—'} />
                </HStack>
              </Section>
              <Section
                title={changed.length ? `Расхождения · ${changed.length}` : 'Расхождений нет'}
                footer={changed.length === 0 ? <Text>Факт везде совпал с учётом.</Text> : undefined}
              >
                {changed.map((r) => (
                  <DiffRow key={r.item.id} row={r} />
                ))}
              </Section>
              <Section>
                <ActionRow title="Вернуться к подсчёту" icon="pencil" onPress={() => setReviewing(false)} />
              </Section>
            </>
          ) : (
            <>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips} contentContainerStyle={styles.chipsContent}>
                <GlassChip label={`Все · ${items.length}`} active={scope === 'all'} onPress={() => setScope('all')} />
                {groups.map((g) => (
                  <GlassChip key={g.id} label={g.title} active={scope === g.id} onPress={() => setScope(g.id)} />
                ))}
              </ScrollView>

              {visibleGroups.map((group) => (
                <Section key={group.id} title={group.title}>
                  {group.items.map((item) => (
                    <CountRow key={item.id} item={item} value={facts[item.id] ?? ''} onChange={(t) => setFacts((f) => ({ ...f, [item.id]: t }))} />
                  ))}
                </Section>
              ))}

              {scope.startsWith('item:') ? (
                <Section>
                  <ActionRow title="Пересчитать и остальное" icon="list.bullet" onPress={() => setScope('all')} />
                </Section>
              ) : null}

              <Section
                footer={
                  <Text>
                    {`Посчитано ${counted.length} из ${items.length}. Ожидаемый остаток скрыт до сверки — считайте по факту.`}
                    {autosave.savedAt ? ` Черновик сохранён в ${timeFormat.format(autosave.savedAt)}.` : ' Черновик сохраняется сам.'}
                  </Text>
                }
              >
                {draftId ? <ActionRow title="Удалить черновик" icon="trash" destructive onPress={() => removeDraft()} /> : null}
              </Section>
            </>
          )}
        </Form>
      </Host>
    </>
  );
}

/** Строка подсчёта: название и поле факта — без ожидаемого остатка (слепой подсчёт). */
function CountRow({ item, value, onChange }: { item: GoodsItem; value: string; onChange: (t: string) => void }) {
  return (
    <View style={styles.countRow}>
      <RNText style={[type.body, styles.label, styles.flex]} numberOfLines={2}>
        {item.name}
      </RNText>
      <View style={styles.countField}>
        <NumberInput
          label={`${item.name}, факт`}
          value={value}
          integer
          placeholder="—"
          suffix={unitWord(item.unit, item.unitLabel, value)}
          onChange={onChange}
        />
      </View>
    </View>
  );
}

/** Расхождение: было → стало, разница цветом и её цена. */
function DiffRow({ row }: { row: Row }) {
  const { item, actual, diff, value } = row;
  const color = diff > 0 ? colors.green : colors.red;
  return (
    <View style={styles.diffRow}>
      <View style={styles.flex}>
        <RNText style={[type.body, styles.label]} numberOfLines={2}>
          {item.name}
        </RNText>
        <RNText style={[type.footnote, styles.secondary]}>{`учёт ${itemQty(item, item.stockQuantity)} → факт ${itemQty(item, actual ?? 0)}`}</RNText>
      </View>
      <View style={styles.trailing}>
        <RNText style={[type.body, styles.amount, { color }]}>{`${diff > 0 ? '+' : '−'}${itemQty(item, Math.abs(diff))}`}</RNText>
        <RNText style={[type.footnote, { color }]}>{formatMoney(value, { sign: true, kopecks: 'auto' })}</RNText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { marginHorizontal: -space.lg, flexGrow: 0, flexShrink: 0 },
  chipsContent: { gap: space.sm, paddingHorizontal: space.lg },
  countRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.sm, minHeight: 56 },
  countField: { width: 132 },
  diffRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: 10, minHeight: 52 },
  flex: { flex: 1 },
  trailing: { alignItems: 'flex-end', gap: 2 },
  label: { color: colors.label },
  secondary: { color: colors.secondaryLabel },
  amount: { fontVariant: ['tabular-nums'], fontWeight: '600' },
});
