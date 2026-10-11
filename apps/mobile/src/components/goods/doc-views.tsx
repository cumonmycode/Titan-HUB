import { ContentUnavailableView, HStack, ProgressView, Section, Text } from '@expo/ui/swift-ui';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, StyleSheet, View, type ColorValue } from 'react-native';

import { Tile } from '@/components/analytics/native';
import { DOC_LOOK, IconPlate, NumberInput, positionsText } from '@/components/goods/parts';
import { ActionRow, LinkRow } from '@/components/native-form';
import { Text as RNText } from '@/components/text';
import { ToolbarButton } from '@/components/toolbar';
import { formatMoney, plural, toNumber } from '@/lib/format';
import { PIECE_NAMES, formatQty, numberText, pieceText, unitPrice, unitWord, type Catalog } from '@/lib/goods-api';
import { correctRevision, deleteSupply, deleteWriteOff, useRevision, useSupply, useWriteOff } from '@/lib/goods-docs';
import { haptic } from '@/lib/haptics';
import { useSession } from '@/lib/session';
import { colors, space, type } from '@/lib/theme';

/**
 * Просмотр проведённых документов склада. Приход можно исправить (с причиной) или удалить
 * с откатом остатков, списание — отменить (товар вернётся), последнюю ревизию — поправить.
 * Удаление и отмена — только владельцу.
 */

const money = (n: number) => formatMoney(n, { kopecks: 'auto' });
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const longDate = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' });

function Loading({ title, error }: { title: string; error: unknown }) {
  return (
    <>
      <Stack.Title>{title}</Stack.Title>
      <Section>
        {error ? <ContentUnavailableView title="Не загрузилось" systemImage="wifi.exclamationmark" description={errorText(error)} /> : <ProgressView />}
      </Section>
    </>
  );
}

/** Шапка документа: значок типа, дата, кто провёл, итог крупно. */
function DocHeader({
  type: docType,
  date,
  lines,
  total,
  totalColor,
}: {
  type: keyof typeof DOC_LOOK;
  date: string;
  lines: string[];
  total: string;
  totalColor?: ColorValue;
}) {
  const look = DOC_LOOK[docType];
  return (
    <View style={styles.header}>
      <IconPlate symbol={look.symbol} color={look.color} size={44} />
      <View style={styles.flex}>
        <RNText style={[type.headline, styles.label]}>{longDate.format(new Date(date)).replace('.', '')}</RNText>
        {lines.map((line) => (
          <RNText key={line} style={[type.footnote, styles.secondary]}>
            {line}
          </RNText>
        ))}
      </View>
      <RNText style={[type.title3, type.amount, { color: totalColor ?? colors.label }]}>{total}</RNText>
    </View>
  );
}

export function SupplyView({ id, catalog }: { id: string; catalog: Catalog }) {
  const router = useRouter();
  const isOwner = useSession((s) => s.user?.role === 'owner');
  const supply = useSupply(id);
  if (!supply.data) return <Loading title="Приход" error={supply.error} />;
  const { supply: doc, items, corrections } = supply.data;

  const remove = () =>
    Alert.alert(
      'Удалить приход?',
      'Принятое количество снимется с остатков; выдача из кассы открытой смены тоже отменится. Себестоимость не пересчитается назад.',
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Удалить',
          style: 'destructive',
          onPress: () =>
            deleteSupply(id)
              .then(() => {
                haptic.success();
                router.back();
              })
              .catch((error: unknown) => Alert.alert('Приход не удалён', errorText(error))),
        },
      ],
    );

  return (
    <>
      <Stack.Title>Приход</Stack.Title>
      <Stack.Toolbar placement="right">
        <ToolbarButton onPress={() => router.push({ pathname: '/manage/goods/supply', params: { supplyId: id } })}>Исправить</ToolbarButton>
      </Stack.Toolbar>
      <Section>
        <DocHeader
          type="supply"
          date={doc.createdAt}
          lines={[[doc.supplier, positionsText(items.length)].filter(Boolean).join(' · '), doc.cashOperationId ? 'наличными из кассы смены' : 'не из кассы']}
          total={money(toNumber(doc.totalCost))}
        />
      </Section>
      <Section title="Состав">
        {items.map((line, index) => {
          const item = line.itemId ? catalog.byId.get(line.itemId) : undefined;
          const unit = line.stockUnit ?? item?.unit ?? 'pcs';
          const per = line.packs
            ? { value: (line.costPerUnit * line.quantity) / line.packs, label: `за ${PIECE_NAMES[item?.packName ?? 'pack'].per}` }
            : unitPrice(line.costPerUnit, unit, item?.unitLabel);
          return (
            <LinkRow
              key={`${line.itemId ?? line.name}-${index}`}
              title={item?.name ?? line.name}
              subtitle={
                line.itemId
                  ? `${formatQty(line.quantity, unit, item?.unitLabel)}${line.packs ? ` (${pieceText(line.packs, item?.packName ?? 'pack')})` : ''} по ${money(per.value)} ${per.label}`
                  : `${numberText(line.quantity)} ${line.unit} · затрата без карточки`
              }
              value={money(line.quantity * line.costPerUnit)}
              onPress={item ? () => router.push({ pathname: '/manage/goods/[itemId]', params: { itemId: item.id, name: item.name } }) : undefined}
            />
          );
        })}
      </Section>
      {corrections.length > 0 && (
        <Section title="Исправления">
          {corrections.map((c) => (
            <LinkRow key={c.id} title={c.reason} subtitle={longDate.format(new Date(c.createdAt))} value={`${money(c.totalBefore)} → ${money(c.totalAfter)}`} />
          ))}
        </Section>
      )}
      {isOwner && (
        <Section footer={<Text>Исправить состав или сумму — кнопкой «Исправить» в шапке, с причиной.</Text>}>
          <ActionRow title="Удалить приход" icon="trash" destructive onPress={remove} />
        </Section>
      )}
    </>
  );
}

export function WriteOffView({ id, catalog }: { id: string; catalog: Catalog }) {
  const router = useRouter();
  const isOwner = useSession((s) => s.user?.role === 'owner');
  const writeOff = useWriteOff(id);
  if (!writeOff.data) return <Loading title="Списание" error={writeOff.error} />;
  const { writeOff: doc, items } = writeOff.data;

  const cancel = () =>
    Alert.alert('Отменить списание?', 'Списанное вернётся на склад.', [
      { text: 'Нет', style: 'cancel' },
      {
        text: 'Отменить',
        style: 'destructive',
        onPress: () =>
          deleteWriteOff(id)
            .then(() => {
              haptic.success();
              router.back();
            })
            .catch((error: unknown) => Alert.alert('Не отменено', errorText(error))),
      },
    ]);

  return (
    <>
      <Stack.Title>Списание</Stack.Title>
      <Section footer={doc.note ? <Text>{doc.note}</Text> : undefined}>
        <DocHeader
          type="write_off"
          date={doc.createdAt}
          lines={[[doc.reason, positionsText(items.length)].filter(Boolean).join(' · '), doc.author ? `списал ${doc.author}` : ''].filter(Boolean)}
          total={money(toNumber(doc.totalCost))}
        />
      </Section>
      <Section title="Списано">
        {items.map((line) => {
          const item = catalog.byId.get(line.itemId);
          const portions = item?.stockMode === 'recipe';
          return (
            <LinkRow
              key={line.id}
              title={line.name}
              subtitle={
                portions
                  ? `${line.quantity} ${plural(line.quantity, ['порция', 'порции', 'порций'])} по составу`
                  : formatQty(line.quantity, line.unit ?? item?.unit ?? 'pcs', item?.unitLabel)
              }
              value={money(line.quantity * toNumber(line.unitCost))}
              onPress={item ? () => router.push({ pathname: '/manage/goods/[itemId]', params: { itemId: item.id, name: item.name } }) : undefined}
            />
          );
        })}
      </Section>
      {isOwner && (
        <Section>
          <ActionRow title="Отменить списание" icon="arrow.uturn.backward" destructive onPress={cancel} />
        </Section>
      )}
    </>
  );
}

export function RevisionView({ id, catalog }: { id: string; catalog: Catalog }) {
  const revision = useRevision(id);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!revision.data) return <Loading title="Ревизия" error={revision.error} />;
  const { revision: doc, items } = revision.data;
  const editable = doc.isLatest && doc.status === 'applied';

  const rows = items.map((line) => {
    const raw = (edits[line.id] ?? '').replace(/[^\d]/g, '');
    const actual = raw !== '' ? Number(raw) : line.actual;
    const diff = actual - line.expected;
    return {
      line,
      unit: line.unit ?? catalog.byId.get(line.itemId)?.unit ?? 'pcs',
      label: catalog.byId.get(line.itemId)?.unitLabel ?? null,
      actual,
      diff,
      value: diff * toNumber(line.costPrice),
      changed: raw !== '' && actual !== line.actual,
    };
  });
  const changes = rows.filter((r) => r.changed);
  const surplus = rows.filter((r) => r.diff > 0).reduce((s, r) => s + r.value, 0);
  const shortage = rows.filter((r) => r.diff < 0).reduce((s, r) => s - r.value, 0);
  const net = surplus - shortage;

  const apply = () =>
    Alert.alert('Исправить ревизию?', `Текущие остатки ${positionsText(changes.length)} сдвинутся на разницу между новым и прежним фактом.`, [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Исправить',
        onPress: async () => {
          haptic.medium();
          setBusy(true);
          try {
            await correctRevision(
              id,
              changes.map((r) => ({ id: r.line.id, actual: r.actual })),
            );
            haptic.success();
            setEdits({});
            setEditing(false);
          } catch (error) {
            haptic.error();
            Alert.alert('Не исправлено', errorText(error));
          } finally {
            setBusy(false);
          }
        },
      },
    ]);

  return (
    <>
      <Stack.Title>Ревизия</Stack.Title>
      {editable && (
        <Stack.Toolbar placement="right">
          {editing ? (
            <ToolbarButton variant="done" tintColor={colors.accent} disabled={busy || changes.length === 0} onPress={apply}>
              {busy ? 'Сохраняем…' : 'Сохранить'}
            </ToolbarButton>
          ) : (
            <ToolbarButton onPress={() => setEditing(true)}>Исправить</ToolbarButton>
          )}
        </Stack.Toolbar>
      )}
      <Section
        footer={
          <Text>
            {editable
              ? 'Поправить можно последнюю ревизию: остаток сдвинется на разницу, продажи после неё сохранятся.'
              : 'Только просмотр: после неё уже была ревизия.'}
          </Text>
        }
      >
        <DocHeader
          type="revision"
          date={doc.createdAt}
          lines={[positionsText(items.length), doc.author ? `провёл ${doc.author}` : ''].filter(Boolean)}
          total={Math.abs(net) < 0.005 ? 'сходится' : formatMoney(net, { sign: true, kopecks: 'auto' })}
          totalColor={Math.abs(net) < 0.005 ? colors.green : net > 0 ? colors.green : colors.red}
        />
        <HStack spacing={12}>
          <Tile label="Излишек" value={surplus > 0.005 ? `+${money(surplus)}` : '—'} />
          <Tile label="Недостача" value={shortage > 0.005 ? `−${money(shortage)}` : '—'} />
        </HStack>
      </Section>
      <Section title="Позиции">
        {rows.map((row) => (
          <View key={row.line.id} style={styles.row}>
            <View style={styles.flex}>
              <RNText style={[type.body, styles.label]} numberOfLines={2}>
                {row.line.name}
              </RNText>
              <RNText style={[type.footnote, { color: row.diff === 0 ? colors.secondaryLabel : row.diff > 0 ? colors.green : colors.red }]}>
                {row.diff === 0
                  ? `учёт ${formatQty(row.line.expected, row.unit, row.label)} · сходится`
                  : `учёт ${formatQty(row.line.expected, row.unit, row.label)} · ${row.diff > 0 ? '+' : '−'}${formatQty(Math.abs(row.diff), row.unit, row.label)} · ${formatMoney(row.value, { sign: true, kopecks: 'auto' })}`}
              </RNText>
            </View>
            {editing ? (
              <View style={styles.field}>
                <NumberInput
                  label={`${row.line.name}, факт`}
                  value={edits[row.line.id] ?? String(row.line.actual)}
                  integer
                  suffix={unitWord(row.unit, row.label, edits[row.line.id] ?? String(row.line.actual))}
                  onChange={(t) => setEdits((e) => ({ ...e, [row.line.id]: t }))}
                />
              </View>
            ) : (
              <RNText style={[type.body, styles.label, styles.amount]}>{formatQty(row.actual, row.unit, row.label)}</RNText>
            )}
          </View>
        ))}
      </Section>
    </>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: 10, minHeight: 52 },
  field: { width: 132 },
  flex: { flex: 1, gap: 2 },
  label: { color: colors.label },
  secondary: { color: colors.secondaryLabel },
  amount: { fontVariant: ['tabular-nums'], fontWeight: '600' },
});
