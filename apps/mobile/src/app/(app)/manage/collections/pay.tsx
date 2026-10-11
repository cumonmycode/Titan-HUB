import { useLocalSearchParams, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/text';
import { GlassView } from '@/components/glass';
import { AmountKeypad, Avatar, GlassCard, PrimaryButton, SheetHeader, sheetStyles } from '@/components/new-check-parts';
import { RollingText } from '@/components/rolling-text';
import { balanceText } from '@/lib/clients-api';
import { CONTRIBUTION_METHODS, payContribution, round2, suggestedAmount, useCollection, type ContributionMethod } from '@/lib/collections-api';
import { formatMoney } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { parseAmount } from '@/lib/shift-api';
import { colors, space, type } from '@/lib/theme';

const METHOD_ORDER: ContributionMethod[] = ['cash', 'transfer', 'sbp', 'deposit', 'debt'];
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const isBalanceMethod = (method: ContributionMethod) => method === 'deposit' || method === 'debt';

/**
 * Отметка взноса: сумма (по умолчанию — долг с прошлых месяцев или взнос периода) и способ.
 * Депозит списывается с баланса клиента, долг записывается ему в долг.
 */
export default function PaySheet() {
  const params = useLocalSearchParams<{ collectionId: string; periodKey?: string; playerId: string }>();
  const router = useRouter();
  const detail = useCollection(params.collectionId, params.periodKey || null);
  const row = detail.data?.roster.find((r) => r.playerId === params.playerId);

  if (!detail.data || !row) {
    return (
      <View style={styles.loading}>
        {detail.isLoading ? <ActivityIndicator /> : <Text style={[type.body, sheetStyles.secondary]}>Участник не найден</Text>}
      </View>
    );
  }

  return <PayForm key={row.playerId} collectionId={params.collectionId} period={detail.data.period} row={row} onClose={() => router.back()} />;
}

function PayForm({
  collectionId,
  period,
  row,
  onClose,
}: {
  collectionId: string;
  period: { id: string; label: string };
  row: NonNullable<ReturnType<typeof useCollection>['data']>['roster'][number];
  onClose: () => void;
}) {
  const [text, setText] = useState(String(suggestedAmount(row)).replace('.', ','));
  const [method, setMethod] = useState<ContributionMethod>('cash');
  const [busy, setBusy] = useState(false);

  const amount = parseAmount(text) ?? 0;
  const noDeposit = method === 'deposit' && row.balance + 0.004 < amount;
  // Доплата к отметке периода: наличные, перевод и СБП сервер складывает с ней,
  // депозит и долг — нет (снятие такой отметки вернуло бы на баланс не ту сумму).
  const existing = row.contribution;
  const mark = existing ? `«${CONTRIBUTION_METHODS[existing.method].label} · ${formatMoney(existing.amount, { kopecks: 'auto' })}»` : '';
  const mergeBlocked = !!existing && (isBalanceMethod(existing.method) || isBalanceMethod(method));
  const canPay = amount > 0 && !noDeposit && !mergeBlocked && !busy;

  const hint = (() => {
    if (existing && isBalanceMethod(existing.method)) return `Отметка ${mark} не складывается с доплатой — сначала снимите её`;
    if (existing && isBalanceMethod(method)) return `Депозит и долг не складываются с отметкой ${mark} — выберите наличные, перевод или СБП`;
    if (existing) return `Добавится к отметке ${mark} — мимо кассы и баланса клиента`;
    if (method === 'deposit') return noDeposit ? `Депозита не хватает — на балансе ${formatMoney(Math.max(row.balance, 0), { kopecks: 'auto' })}. Выберите «Долг»` : 'Спишется с депозита клиента и попадёт в его историю';
    if (method === 'debt') return 'Запишется клиенту в долг и попадёт в его историю';
    return 'Деньги копятся в сборе — мимо кассы и баланса клиента';
  })();

  const pay = async () => {
    if (!canPay) return;
    haptic.medium();
    setBusy(true);
    try {
      await payContribution(collectionId, { periodId: period.id, playerId: row.playerId, amount: round2(amount), method });
      haptic.success();
      onClose();
    } catch (error) {
      haptic.error();
      Alert.alert('Взнос не отмечен', errorText(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.sheet}>
      <SheetHeader title={`Взнос · ${period.label}`} onClose={onClose} />

      <GlassCard style={styles.member}>
        <Avatar name={row.nickname} photoUrl={row.photoUrl} size={36} />
        <View style={styles.flex}>
          <Text style={[type.headline, sheetStyles.label]} numberOfLines={1}>
            {row.nickname}
          </Text>
          <Text style={[type.footnote, row.balance < 0 ? styles.debt : sheetStyles.secondary]}>{balanceText(row.balance) ?? 'Баланс 0 ₽'}</Text>
        </View>
        {row.topUp > row.expected + 0.004 && <Text style={[type.caption1, styles.debt]}>{`долг за прошлые месяцы`}</Text>}
      </GlassCard>

      <View style={styles.display} accessibilityLiveRegion="polite">
        <View style={styles.valueRow}>
          <RollingText text={text || '0'} style={[styles.value, type.amount, !text && styles.placeholder]} />
          <Text style={[styles.suffix, type.amount]}>₽</Text>
        </View>
        <Text style={[type.subhead, sheetStyles.secondary]}>{`Взнос периода ${formatMoney(row.expected, { kopecks: 'auto' })}${row.amountOverride !== null ? ' · персональный' : ''}`}</Text>
      </View>

      <View style={styles.methods}>
        {METHOD_ORDER.map((key) => {
          const look = CONTRIBUTION_METHODS[key];
          const active = method === key;
          return (
            <Pressable
              key={key}
              style={styles.methodCell}
              onPress={() => {
                haptic.selection();
                setMethod(key);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}>
              <GlassView isInteractive tintColor={active ? `${look.color}59` : undefined} style={styles.method}>
                <SymbolView name={look.symbol} size={18} tintColor={look.color} />
                <Text style={[type.footnote, styles.methodText]}>{look.label}</Text>
              </GlassView>
            </Pressable>
          );
        })}
      </View>
      <Text style={[type.footnote, noDeposit || mergeBlocked ? styles.debt : sheetStyles.secondary, styles.hint]}>{hint}</Text>

      <AmountKeypad value={text} onChange={setText} maxLength={8} />

      <PrimaryButton
        title={busy ? 'Отмечаем…' : amount > 0 ? `Отметить · ${formatMoney(amount, { kopecks: 'auto' })}` : 'Отметить взнос'}
        icon="checkmark"
        busy={busy}
        disabled={!canPay}
        onPress={() => void pay()}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { paddingHorizontal: space.xl, paddingTop: space.xl, paddingBottom: space.lg, gap: space.md },
  loading: { height: 320, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
  member: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.md, paddingVertical: space.sm },
  debt: { color: colors.red },
  display: { alignItems: 'center', gap: 2 },
  valueRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', gap: 4 },
  value: { fontSize: 56, lineHeight: 64, color: colors.label },
  placeholder: { color: colors.tertiaryLabel },
  suffix: { fontSize: 34, lineHeight: 64, color: colors.secondaryLabel },
  methods: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  methodCell: { width: '31.5%', flexGrow: 1 },
  method: { alignItems: 'center', gap: 4, paddingVertical: space.sm, borderRadius: 16, borderCurve: 'continuous' },
  methodText: { color: colors.label, fontWeight: '600' },
  hint: { textAlign: 'center', paddingHorizontal: space.sm },
});
