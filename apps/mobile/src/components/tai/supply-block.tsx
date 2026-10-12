import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, View } from 'react-native';

import { GlassCard, PrimaryButton } from '@/components/new-check-parts';
import { Text } from '@/components/text';
import { promptText } from '@/lib/dialog';
import { formatMoney } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { acceptTaiSupply, cancelTaiSupply, editTaiSupply, type TaiSupplyCard, type TaiSupplyLine, type TaiSupplyOp } from '@/lib/tai-api';
import { openRouteFromTai } from '@/lib/tai-navigate';
import { colors, space, type } from '@/lib/theme';

const parseNumber = (text?: string) => {
  const n = Number((text ?? '').replace(',', '.').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? n : null;
};

/**
 * Поставка, собранная Tai со слов: строки правятся прямо здесь (±, количество,
 * цена, верная позиция склада), «Принять» проводит приход как экран «Приход».
 */
export function SupplyBlock({ card: initial }: { card: TaiSupplyCard }) {
  const router = useRouter();
  const [card, setCard] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [choosing, setChoosing] = useState<number | null>(null);
  const draft = card.status === 'draft';

  const run = async (key: string, task: () => Promise<TaiSupplyCard | null>) => {
    setBusy(key);
    setError(null);
    try {
      const next = await task();
      if (next) setCard(next);
      haptic.light();
    } catch (e) {
      haptic.error();
      setError(e instanceof Error ? e.message : 'Не получилось');
    } finally {
      setBusy(null);
    }
  };
  const edit = (key: string, ops: TaiSupplyOp[]) => run(key, () => editTaiSupply(card.id, ops));

  const askNumber = (title: string, current: number, apply: (value: number) => TaiSupplyOp) => {
    promptText(title, undefined, [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Готово', onPress: (value) => { const n = parseNumber(value); if (n !== null) void edit(title, [apply(n)]); } },
    ], 'plain-text', String(current), 'decimal-pad');
  };

  const open = () => openRouteFromTai(router, { screen: 'supply', supplyId: card.id, draft: draft });
  const title = card.status === 'posted' ? 'Поставка принята' : card.status === 'cancelled' ? 'Черновик удалён' : 'Поставка';

  return (
    <GlassCard style={[styles.card, card.status === 'cancelled' && styles.faded]}>
      <View style={styles.header}>
        <SymbolView name={card.status === 'posted' ? 'checkmark.circle.fill' : 'shippingbox.fill'} size={20} weight="semibold" tintColor={card.status === 'posted' ? colors.green : colors.accent} />
        <Text style={[type.headline, styles.label, styles.flex]}>{title}</Text>
        {busy && <ActivityIndicator size="small" />}
      </View>
      {card.supplier ? <Text style={[type.subhead, styles.secondary]}>Поставщик: {card.supplier}</Text> : null}

      {card.lines.map((line) => (
        <SupplyRow key={`${line.index}-${line.itemId ?? line.name}`} line={line} draft={draft} disabled={!!busy}
          choosing={choosing === line.index}
          onChoose={() => setChoosing(choosing === line.index ? null : line.index)}
          onMatch={(itemId) => { setChoosing(null); void edit(`m${line.index}`, [{ op: 'match', line: line.index, itemId }]); }}
          onStep={(direction) => void edit(`s${line.index}`, [{ op: 'step', line: line.index, direction }])}
          onRemove={() => void edit(`r${line.index}`, [{ op: 'remove', line: line.index }])}
          onQuantity={() => askNumber(`Количество, ${line.unit}`, line.quantity, (quantity) => ({ op: 'quantity', line: line.index, quantity }))}
          onPrice={() => askNumber(`Цена за ${line.unit}`, line.costPerUnit, (costPerUnit) => ({ op: 'price', line: line.index, costPerUnit }))}
        />
      ))}

      <View style={[styles.row, styles.total]}>
        <Text style={[type.headline, styles.label, styles.flex]}>Итого</Text>
        <Text style={[type.headline, type.amount, styles.label]}>{formatMoney(card.total)}</Text>
      </View>

      {draft && (
        <View style={styles.row}>
          <Text style={[type.subhead, styles.label, styles.flex]}>Оплата наличными из кассы</Text>
          <Switch value={card.fromRegister} disabled={!!busy} onValueChange={(on) => void edit('pay', [{ op: 'payment', fromRegister: on }])} />
        </View>
      )}
      {error && <Text style={[type.subhead, styles.error]}>{error}</Text>}
      {card.result ? <Text style={[type.subhead, styles.secondary]}>{card.result}</Text> : null}

      {draft ? (
        <View style={styles.buttons}>
          <View style={styles.flex}>
            <PrimaryButton title={`Принять · ${formatMoney(card.total)}`} busy={busy === 'accept'} onPress={() => void run('accept', () => acceptTaiSupply(card.id))} />
          </View>
          <Pressable onPress={() => void run('cancel', () => cancelTaiSupply(card.id))} disabled={!!busy} hitSlop={8} accessibilityRole="button">
            <Text style={[type.body, styles.secondary]}>Отменить</Text>
          </Pressable>
        </View>
      ) : null}
      {card.status !== 'cancelled' && (
        <Pressable onPress={open} hitSlop={8} accessibilityRole="button">
          <Text style={[type.subhead, styles.link]}>{draft ? 'Открыть в редакторе прихода' : 'Открыть приход'}</Text>
        </Pressable>
      )}
    </GlassCard>
  );
}

function SupplyRow(props: {
  line: TaiSupplyLine;
  draft: boolean;
  disabled: boolean;
  choosing: boolean;
  onChoose: () => void;
  onMatch: (itemId: string) => void;
  onStep: (direction: 1 | -1) => void;
  onRemove: () => void;
  onQuantity: () => void;
  onPrice: () => void;
}) {
  const { line, draft, disabled } = props;
  const packs = line.packs && line.packSize ? ` · ${line.packs} ${line.packName || 'уп'}` : '';
  const doubtful = draft && line.uncertain;
  return (
    <View style={styles.line}>
      <Pressable onPress={doubtful && line.alternatives?.length ? props.onChoose : undefined} disabled={!doubtful} accessibilityRole={doubtful ? 'button' : undefined}>
        <Text style={[type.body, doubtful ? styles.warning : styles.label]} numberOfLines={2}>
          {doubtful ? '? ' : ''}{line.index + 1}. {line.name}
        </Text>
        {line.said ? <Text style={[type.footnote, styles.secondary]}>сказали «{line.said}»{doubtful ? ' — нажмите, чтобы выбрать позицию' : ''}</Text> : null}
      </Pressable>
      {props.choosing && (
        <View style={styles.alternatives}>
          {(line.alternatives ?? []).map((alt) => (
            <Pressable key={alt.itemId} onPress={() => props.onMatch(alt.itemId)} style={({ pressed }) => [styles.alternative, pressed && styles.faded]} accessibilityRole="button">
              <Text style={[type.subhead, styles.label]} numberOfLines={1}>{alt.name}</Text>
            </Pressable>
          ))}
        </View>
      )}
      <View style={styles.row}>
        {draft && <RoundButton icon="minus" disabled={disabled} onPress={() => props.onStep(-1)} label="Меньше" />}
        <Pressable onPress={draft ? props.onQuantity : undefined} disabled={!draft || disabled} accessibilityRole={draft ? 'button' : undefined}>
          <Text style={[type.subhead, styles.label]}>{line.quantity} {line.unit}{packs}</Text>
        </Pressable>
        {draft && <RoundButton icon="plus" disabled={disabled} onPress={() => props.onStep(1)} label="Больше" />}
        <Pressable onPress={draft ? props.onPrice : undefined} disabled={!draft || disabled} style={styles.flex} accessibilityRole={draft ? 'button' : undefined}>
          <Text style={[type.subhead, styles.secondary]} numberOfLines={1}>× {formatMoney(line.costPerUnit)}</Text>
        </Pressable>
        <Text style={[type.subhead, type.amount, styles.label]}>{formatMoney(line.sum)}</Text>
        {draft && <RoundButton icon="trash" disabled={disabled} onPress={props.onRemove} label="Убрать строку" destructive />}
      </View>
    </View>
  );
}

function RoundButton({ icon, onPress, disabled, label, destructive }: { icon: 'minus' | 'plus' | 'trash'; onPress: () => void; disabled: boolean; label: string; destructive?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} hitSlop={6} accessibilityRole="button" accessibilityLabel={label}
      style={({ pressed }) => [styles.round, pressed && styles.faded]}>
      <SymbolView name={icon} size={13} weight="bold" tintColor={destructive ? colors.red : colors.accent} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { padding: space.lg, gap: space.md },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  line: { gap: space.xs, paddingVertical: space.xs, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  total: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator, paddingTop: space.sm },
  buttons: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  alternatives: { gap: space.xs },
  alternative: { paddingVertical: space.sm, paddingHorizontal: space.md, borderRadius: 12, backgroundColor: colors.fill },
  round: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.fill },
  flex: { flex: 1, minWidth: 0 },
  label: { color: colors.label },
  secondary: { color: colors.secondaryLabel },
  warning: { color: colors.orange },
  error: { color: colors.red },
  link: { color: colors.accent },
  faded: { opacity: 0.55 },
});
