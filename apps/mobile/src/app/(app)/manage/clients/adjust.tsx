import { Host, Picker, Text as SwiftText } from '@expo/ui/swift-ui';
import { pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/text';
import { AmountKeypad, Avatar, GlassCard, GlassChip, PrimaryButton, SheetHeader, sheetStyles } from '@/components/new-check-parts';
import { RollingText } from '@/components/rolling-text';
import {
  BALANCE_METHOD_LABEL,
  BALANCE_OPS,
  balanceDelta,
  balanceText,
  changeBalance,
  changeBonus,
  clientPhoto,
  useClient,
  type BalanceMethod,
  type BalanceOp,
} from '@/lib/clients-api';
import { formatMoney, toNumber } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { newIdempotencyKey, parseAmount } from '@/lib/shift-api';
import { colors, space, type } from '@/lib/theme';
import { promptText } from '@/lib/dialog';

type Mode = 'balance' | 'bonus';
type BonusOp = 'plus' | 'minus';

const OP_LABEL: Record<BalanceOp, string> = { deposit_add: 'Пополнить', deposit_sub: 'Снять', debt_repay: 'Погасить', debt_lend: 'В долг' };
const QUICK: Record<Mode, number[]> = { balance: [500, 1000, 2000, 5000], bonus: [50, 100, 200, 500] };
const BONUS_REASONS = ['Турнир', 'Подарок', 'Компенсация', 'Корректировка'];

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Депозит, долг и бонусы клиента одной шторкой: сумма крупно и стеклянная клавиатура,
 * причина — системным диалогом. Для денег ключ идемпотентности живёт, пока не меняется
 * сама операция: повтор после обрыва связи не спишет дважды.
 */
export default function AdjustSheet() {
  const params = useLocalSearchParams<{ clientId: string; mode?: Mode; op?: string }>();
  const router = useRouter();
  const client = useClient(params.clientId);
  const mode: Mode = params.mode === 'bonus' ? 'bonus' : 'balance';
  const [balanceOp, setBalanceOp] = useState<BalanceOp>(params.op && params.op in BALANCE_OPS ? (params.op as BalanceOp) : 'deposit_add');
  const [bonusOp, setBonusOp] = useState<BonusOp>(params.op === 'minus' ? 'minus' : 'plus');
  // Чем прошли деньги: наличные сервер проводит через кассу смены. «В долг» — без денег.
  const [method, setMethod] = useState<BalanceMethod>('cash');
  const [text, setText] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  // Ключ привязан к «подписи» операции: та же операция при повторе — тот же ключ.
  const [idempotency, setIdempotency] = useState<{ signature: string; key: string } | null>(null);

  const data = client.data;
  if (!data) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator />
      </View>
    );
  }

  const balance = toNumber(data.balance);
  const bonus = Math.floor(toNumber(data.bonusPoints));
  const value = parseAmount(text) ?? 0;
  const defaultReason = mode === 'balance' ? BALANCE_OPS[balanceOp].reason : '';
  const effectiveReason = reason.trim() || defaultReason;
  const movesMoney = mode === 'balance' && balanceOp !== 'debt_lend';

  const delta = mode === 'balance' ? balanceDelta(balanceOp, value, balance) : bonusOp === 'plus' ? value : -Math.min(value, bonus);
  const clamped = value > 0 && Math.abs(Math.abs(delta) - value) > 0.004;
  const nothingToDo = value > 0 && Math.abs(delta) < 0.005;
  const canSubmit = value > 0 && !nothingToDo && !busy;

  const preview = (() => {
    if (value <= 0) return mode === 'balance' ? `Сейчас: ${balanceText(balance) ?? 'баланс 0 ₽'}` : `Сейчас: ★ ${bonus}`;
    if (nothingToDo) return mode === 'balance' ? (balanceOp === 'deposit_sub' ? 'Депозит пуст' : 'Долга нет') : 'Бонусов нет';
    if (mode === 'bonus') return `${clamped ? `Спишем все ${bonus} · ` : ''}станет ★ ${bonus + delta}`;
    const after = balanceText(balance + delta) ?? 'баланс 0 ₽';
    return clamped ? `Не больше ${formatMoney(Math.abs(delta), { kopecks: 'auto' })} · станет ${after}` : `Станет: ${after}`;
  })();

  const title =
    mode === 'balance'
      ? BALANCE_OPS[balanceOp].title
      : bonusOp === 'plus'
        ? 'Начислить бонусы'
        : 'Списать бонусы';

  const buttonTitle = (() => {
    if (busy) return 'Сохраняем…';
    if (value <= 0 || nothingToDo) return title;
    if (mode === 'bonus') return `${bonusOp === 'plus' ? 'Начислить' : 'Списать'} ★ ${Math.abs(delta)}`;
    const amount = formatMoney(Math.abs(delta), { kopecks: 'auto' });
    return { deposit_add: `Пополнить на ${amount}`, deposit_sub: `Снять ${amount}`, debt_repay: `Погасить ${amount}`, debt_lend: `В долг ${amount}` }[balanceOp];
  })();

  const editReason = (then?: (next: string) => void) =>
    promptText(
      'Причина',
      mode === 'bonus' ? 'Попадёт в историю бонусов клиента' : 'Попадёт в историю движений клиента',
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Готово',
          onPress: (input?: string) => {
            const next = (input ?? '').trim();
            setReason(next);
            then?.(next);
          },
        },
      ],
      'plain-text',
      reason || defaultReason,
    );

  const submit = async (reasonText: string) => {
    if (!canSubmit) return;
    if (reasonText.length < 3) {
      editReason((next) => {
        if (next.length >= 3) void submit(next);
        else Alert.alert('Причина — минимум 3 символа');
      });
      return;
    }
    haptic.medium();
    setBusy(true);
    try {
      if (mode === 'balance') {
        const signature = `${data.id}|${delta}|${reasonText}`;
        const key = idempotency?.signature === signature ? idempotency.key : newIdempotencyKey();
        setIdempotency({ signature, key });
        const paidWith = movesMoney ? method : undefined;
        const result = await changeBalance(data.id, delta, reasonText, key, paidWith);
        if (paidWith === 'cash' && !result.duplicate && !result.cashOperation) {
          Alert.alert('Смена не открыта', 'Баланс изменён, но наличные не записаны в кассу.');
        }
      } else {
        await changeBonus(data.id, delta, reasonText);
      }
      haptic.success();
      router.back();
    } catch (error) {
      haptic.error();
      Alert.alert(mode === 'balance' ? 'Баланс не изменён' : 'Бонусы не изменены', errorText(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.sheet}>
      <SheetHeader title={mode === 'balance' ? 'Депозит и долг' : 'Бонусы'} onClose={() => router.back()} />

      <GlassCard style={styles.client}>
        <Avatar name={data.nickname} photoUrl={clientPhoto(data)} size={36} />
        <Text style={[type.headline, sheetStyles.label, styles.flex]} numberOfLines={1}>
          {data.nickname}
        </Text>
        <Text style={[type.subhead, balance < 0 && mode === 'balance' ? styles.debt : sheetStyles.secondary]}>
          {mode === 'balance' ? (balanceText(balance) ?? '0 ₽') : `★ ${bonus}`}
        </Text>
      </GlassCard>

      <Host matchContents={{ vertical: true }} style={styles.stretch}>
        {mode === 'balance' ? (
          <Picker
            selection={balanceOp}
            onSelectionChange={(next) => {
              haptic.selection();
              setBalanceOp(next as BalanceOp);
              setReason('');
            }}
            modifiers={[pickerStyle('segmented')]}>
            {(Object.keys(OP_LABEL) as BalanceOp[]).map((op) => (
              <SwiftText key={op} modifiers={[tag(op)]}>
                {OP_LABEL[op]}
              </SwiftText>
            ))}
          </Picker>
        ) : (
          <Picker
            selection={bonusOp}
            onSelectionChange={(next) => {
              haptic.selection();
              setBonusOp(next as BonusOp);
            }}
            modifiers={[pickerStyle('segmented')]}>
            <SwiftText modifiers={[tag('plus')]}>Начислить</SwiftText>
            <SwiftText modifiers={[tag('minus')]}>Списать</SwiftText>
          </Picker>
        )}
      </Host>

      <View style={styles.display} accessibilityLiveRegion="polite">
        <View style={styles.valueRow}>
          <RollingText text={text || '0'} style={[styles.value, type.amount, !text && styles.placeholder]} />
          <Text style={[styles.suffix, type.amount]}>{mode === 'balance' ? '₽' : '★'}</Text>
        </View>
        <Text style={[type.subhead, nothingToDo ? styles.debt : sheetStyles.secondary]} numberOfLines={1}>
          {preview}
        </Text>
      </View>

      <View style={styles.quickRow}>
        {QUICK[mode].map((option) => (
          <GlassChip
            key={option}
            style={styles.flex}
            label={mode === 'balance' ? `${option.toLocaleString('ru-RU')} ₽` : `★ ${option}`}
            active={value === option}
            onPress={() => {
              haptic.selection();
              setText(String(option));
            }}
          />
        ))}
      </View>

      <AmountKeypad value={text} onChange={setText} allowDecimal={mode === 'balance'} maxLength={mode === 'balance' ? 8 : 6} />

      {movesMoney && (
        <Host matchContents={{ vertical: true }} style={styles.stretch}>
          <Picker
            selection={method}
            onSelectionChange={(next) => {
              haptic.selection();
              setMethod(next as BalanceMethod);
            }}
            modifiers={[pickerStyle('segmented')]}>
            {(Object.keys(BALANCE_METHOD_LABEL) as BalanceMethod[]).map((option) => (
              <SwiftText key={option} modifiers={[tag(option)]}>
                {BALANCE_METHOD_LABEL[option]}
              </SwiftText>
            ))}
          </Picker>
        </Host>
      )}

      {mode === 'bonus' && (
        <View style={styles.quickRow}>
          {BONUS_REASONS.map((option) => (
            <GlassChip
              key={option}
              style={styles.flex}
              label={option}
              active={reason === option}
              onPress={() => {
                haptic.selection();
                setReason(reason === option ? '' : option);
              }}
            />
          ))}
        </View>
      )}

      <Pressable onPress={() => editReason()} accessibilityRole="button" accessibilityLabel="Изменить причину">
        <GlassCard style={styles.reason}>
          <SymbolView name="text.bubble" size={17} tintColor={colors.secondaryLabel} />
          <View style={styles.flex}>
            <Text style={[type.caption1, sheetStyles.secondary]}>{mode === 'bonus' ? 'Причина · обязательно' : 'Причина'}</Text>
            <Text style={[type.body, effectiveReason ? sheetStyles.label : sheetStyles.tertiary]} numberOfLines={1}>
              {effectiveReason || 'Нажмите, чтобы указать'}
            </Text>
          </View>
          <SymbolView name="pencil" size={14} weight="semibold" tintColor={colors.tertiaryLabel} />
        </GlassCard>
      </Pressable>

      <PrimaryButton
        title={buttonTitle}
        icon={mode === 'bonus' ? 'star.fill' : BALANCE_OPS[balanceOp].symbol}
        busy={busy}
        disabled={!canSubmit}
        onPress={() => void submit(effectiveReason)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { paddingHorizontal: space.xl, paddingTop: space.xl, paddingBottom: space.lg, gap: space.md },
  loading: { height: 320, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
  stretch: { alignSelf: 'stretch' },
  client: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.md, paddingVertical: space.sm },
  debt: { color: colors.red },
  display: { alignItems: 'center', gap: 2 },
  valueRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', gap: 4 },
  value: { fontSize: 60, lineHeight: 68, color: colors.label },
  placeholder: { color: colors.tertiaryLabel },
  suffix: { fontSize: 36, lineHeight: 68, color: colors.secondaryLabel },
  quickRow: { flexDirection: 'row', gap: space.sm },
  reason: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.sm, minHeight: 54 },
});
