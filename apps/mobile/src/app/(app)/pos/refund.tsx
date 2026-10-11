import { useLocalSearchParams, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import Animated, { FadeIn, ZoomIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text, TextInput } from '@/components/text';
import { GlassView } from '@/components/glass';
import { FormField, FormSection } from '@/components/form-parts';
import { GlassCard, GlassChip, PrimaryButton, SheetHeader, sheetStyles } from '@/components/new-check-parts';
import { checkTitle } from '@/lib/checks';
import { formatMoney } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { KEYBOARD_DISMISS } from '@/lib/layout';
import { METHODS, usePosPlayer } from '@/lib/payment';
import { useCheck, useShiftSummary } from '@/lib/queries';
import {
  createRefund,
  fetchRefundPrepare,
  fromKopecks,
  parseKopecks,
  REFUND_METHODS,
  REFUND_REASONS,
  toKopecks,
  useRefundPrepare,
  useRefunds,
  type RefundMethod,
  type RefundPrepare,
  type RefundReason,
} from '@/lib/refunds-api';
import { FONT_SCALE_MAX } from '@/lib/text-scale';
import { colors, space, type } from '@/lib/theme';

const rub = (kopecks: number) => formatMoney(fromKopecks(kopecks), { kopecks: 'auto' });
const closedAt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' });
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Возврат по закрытому чеку. Суммы вводятся явно по каждому способу оплаты и не больше
 * доступного; товары на склад выбираются поштучно. Перед отправкой лимиты перечитываются,
 * затем — подтверждение со всеми последствиями. Отменить возврат нельзя.
 */
export default function RefundSheet() {
  const { checkId } = useLocalSearchParams<{ checkId: string }>();
  const router = useRouter();
  const prepare = useRefundPrepare(checkId);

  if (!prepare.data) {
    return (
      <View style={styles.loading}>
        {prepare.isError ? (
          <>
            <SymbolView name="exclamationmark.triangle" size={34} tintColor={colors.secondaryLabel} />
            <Text style={[type.body, sheetStyles.secondary, styles.centered]}>{errorText(prepare.error)}</Text>
          </>
        ) : (
          <ActivityIndicator />
        )}
      </View>
    );
  }

  return <RefundForm prepare={prepare.data} onRefetch={() => void prepare.refetch()} onClose={() => router.back()} />;
}

type Done = { totalKopecks: number; lines: string[]; verified: boolean };

function RefundForm({ prepare, onRefetch, onClose }: { prepare: RefundPrepare; onRefetch: () => void; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const checkId = prepare.check.id;
  const check = useCheck(checkId);
  const shift = useShiftSummary();
  const player = usePosPlayer(prepare.check.playerId);
  const refunds = useRefunds();

  const [reason, setReason] = useState<RefundReason>('return');
  const [amounts, setAmounts] = useState<Partial<Record<RefundMethod, string>>>({});
  const [restore, setRestore] = useState<Record<string, number>>({});
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Done | null>(null);

  const closed = prepare.check.status === 'closed';
  const methods = REFUND_METHODS.filter((m) => (prepare.availableByMethod[m] ?? 0) > 0);
  const splitPaid = prepare.paidByMethod.split ?? 0;

  const rows = methods.map((method) => {
    const availK = toKopecks(prepare.availableByMethod[method] ?? 0);
    const text = amounts[method] ?? '';
    const enteredK = parseKopecks(text) ?? 0;
    const error =
      text.trim() && parseKopecks(text) === null
        ? 'Введите сумму'
        : enteredK > availK
          ? `Не больше ${rub(availK)}`
          : method === 'bonus' && enteredK % 100 !== 0
            ? 'Бонусы — только целые'
            : null;
    return { method, availK, text, enteredK: error ? 0 : enteredK, error };
  });
  const totalK = rows.reduce((sum, r) => sum + r.enteredK, 0);
  const hasErrors = rows.some((r) => r.error);
  const sumOf = (method: RefundMethod) => rows.find((r) => r.method === method)?.enteredK ?? 0;

  const needsPlayer = sumOf('deposit') + sumOf('debt') + sumOf('bonus') > 0;
  const recipientMissing = needsPlayer && !prepare.check.playerId;
  const certificateMissing = sumOf('certificate') > 0 && !prepare.check.certificateId;
  const manualK = sumOf('card') + sumOf('transfer');
  const cashK = sumOf('cash');
  const currentShiftId = shift.data?.shift ? shift.data.shift.id : null;
  const otherShift = cashK > 0 && !!check.data && check.data.shiftId !== currentShiftId;
  const inRegisterK = shift.data && 'cashInRegister' in shift.data ? toKopecks(shift.data.cashInRegister) : null;
  const cashShort = cashK > 0 && !otherShift && inRegisterK !== null && cashK > inRegisterK;

  // Товары: схлопываем строки чека по itemId, вычитаем уже возвращённое прошлыми возвратами.
  const already = new Map<string, number>();
  for (const refund of (refunds.data ?? []).filter((r) => r.checkId === checkId)) {
    for (const item of refund.restoredItems ?? []) already.set(item.itemId, (already.get(item.itemId) ?? 0) + item.quantity);
  }
  const goods = [
    ...prepare.items
      .filter((i) => i.trackStock && i.quantity > 0)
      .reduce((map, i) => map.set(i.itemId, { itemId: i.itemId, name: i.name, sold: (map.get(i.itemId)?.sold ?? 0) + i.quantity }), new Map<string, { itemId: string; name: string; sold: number }>())
      .values(),
  ].map((g) => ({ ...g, max: Math.max(0, g.sold - (already.get(g.itemId) ?? 0)) }));
  const restoreItems = goods.map((g) => ({ itemId: g.itemId, name: g.name, quantity: Math.min(restore[g.itemId] ?? 0, g.max) })).filter((i) => i.quantity > 0);

  const canSubmit = closed && totalK > 0 && !hasErrors && !recipientMissing && !certificateMissing && !busy;

  const fillAll = () => {
    haptic.selection();
    setAmounts(Object.fromEntries(rows.map((r) => [r.method, String(fromKopecks(r.method === 'bonus' ? Math.floor(r.availK / 100) * 100 : r.availK)).replace('.', ',')])));
  };

  const review = async () => {
    if (!canSubmit) return;
    haptic.medium();
    setBusy(true);
    let fresh: RefundPrepare;
    try {
      // Лимиты перечитываем прямо перед подтверждением — не из кэша.
      fresh = await fetchRefundPrepare(checkId);
    } catch (error) {
      setBusy(false);
      Alert.alert('Не удалось проверить чек', errorText(error));
      return;
    }
    setBusy(false);
    if (fresh.check.status !== 'closed') return Alert.alert('Возврат возможен только по оплаченному чеку');
    const changed = rows.some((r) => r.enteredK > toKopecks(fresh.availableByMethod[r.method] ?? 0));
    if (changed) {
      onRefetch();
      return Alert.alert('Данные чека изменились', 'По чеку только что оформили другой возврат. Проверьте суммы.');
    }

    const tenders = rows.filter((r) => r.enteredK > 0).map((r) => ({ method: r.method, kopecks: r.enteredK }));
    const lines = tenders.map((t) => `${METHODS[t.method].title} — ${rub(t.kopecks)}`);
    const message = [
      ...lines,
      needsPlayer ? `Зачислится клиенту ${player.data?.nickname ?? 'чека'}` : null,
      restoreItems.length ? `На склад: ${restoreItems.map((i) => `${i.name} × ${i.quantity}`).join(', ')}` : 'Товары на склад не возвращаются',
      `Причина: ${REFUND_REASONS[reason]}`,
      manualK > 0 ? `Перевод и СБП система только запишет — ${rub(manualK)} верните гостю вручную.` : null,
      otherShift ? 'Чек из другой смены: наличные в остатке текущей кассы не учтутся.' : null,
      'Отменить возврат нельзя.',
    ]
      .filter(Boolean)
      .join('\n');

    Alert.alert(`Оформить возврат ${rub(totalK)}?`, message, [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Оформить',
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          try {
            const result = await createRefund(
              { checkId, tenders, reason, note, items: restoreItems.map((i) => ({ itemId: i.itemId, quantity: i.quantity })), maxRefundKopecks: toKopecks(fresh.maxRefund) },
              toKopecks(fresh.refundedTotal),
            );
            haptic.success();
            setDone({ totalKopecks: totalK, lines, verified: result.verified });
          } catch (error) {
            haptic.error();
            Alert.alert('Возврат не оформлен', errorText(error));
            onRefetch();
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  };

  if (done) {
    return (
      <View style={[styles.done, { paddingBottom: Math.max(insets.bottom, space.xl) }]}>
        <Animated.View entering={ZoomIn.springify().damping(14)} style={styles.doneIcon}>
          <SymbolView name="arrow.uturn.backward.circle.fill" size={72} tintColor={colors.green} />
        </Animated.View>
        <Animated.View entering={FadeIn.delay(120)} style={styles.doneText}>
          <Text style={[type.title2, sheetStyles.label]}>Возврат оформлен</Text>
          <Text style={[styles.doneAmount, type.amount]}>{rub(done.totalKopecks)}</Text>
          {done.lines.map((line) => (
            <Text key={line} style={[type.body, sheetStyles.secondary]}>
              {line}
            </Text>
          ))}
          {done.verified && <Text style={[type.footnote, styles.orange, styles.centered]}>Ответ сервера потерялся, но возврат записан — проверено по чеку.</Text>}
          {manualK > 0 && <Text style={[type.footnote, styles.orange, styles.centered]}>{`Не забудьте вернуть гостю ${rub(manualK)} переводом или через СБП.`}</Text>}
        </Animated.View>
        <PrimaryButton title="Готово" icon="checkmark" onPress={onClose} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView behavior="padding" style={styles.flex}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, space.lg) }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={KEYBOARD_DISMISS}
        showsVerticalScrollIndicator={false}>
        <SheetHeader title="Возврат" onClose={onClose} />

        <GlassCard style={styles.checkCard}>
          <View style={styles.checkTop}>
            <View style={styles.flex}>
              <Text style={[type.headline, sheetStyles.label]} numberOfLines={1}>
                {check.data ? checkTitle(check.data) : 'Чек'}
              </Text>
              <Text style={[type.footnote, sheetStyles.secondary]}>
                {prepare.check.closedAt ? `Оплачен ${closedAt.format(new Date(prepare.check.closedAt))}` : 'Не оплачен'}
              </Text>
            </View>
            <Text style={[type.title3, type.amount, sheetStyles.label]}>{rub(toKopecks(prepare.paidTotal))}</Text>
          </View>
          <View style={styles.stats}>
            <Stat label="Оплачено" value={rub(toKopecks(prepare.paidTotal))} />
            <Stat label="Возвращено" value={rub(toKopecks(prepare.refundedTotal))} />
            <Stat label="Доступно" value={rub(toKopecks(prepare.maxRefund))} accent />
          </View>
        </GlassCard>

        {!closed ? (
          <Notice tone="red" icon="xmark.octagon.fill" text="Возврат возможен только по оплаченному чеку." />
        ) : methods.length === 0 ? (
          <Notice tone="gray" icon="checkmark.seal.fill" text={splitPaid > 0 ? 'Оплата была раздельной без разбивки — вернуть через систему нельзя.' : 'Нечего возвращать: по чеку всё уже возвращено или оплат не было.'} />
        ) : (
          <>
            <FormSection title="ПРИЧИНА">
              <View style={styles.chips}>
                {(Object.keys(REFUND_REASONS) as RefundReason[]).map((key) => (
                  <GlassChip
                    key={key}
                    label={REFUND_REASONS[key]}
                    active={reason === key}
                    onPress={() => {
                      haptic.selection();
                      setReason(key);
                    }}
                  />
                ))}
              </View>
            </FormSection>

            <FormSection title="СУММЫ ПО СПОСОБАМ ОПЛАТЫ" footer={splitPaid > 0 ? `${rub(toKopecks(splitPaid))} оплачено раздельно без разбивки — эту часть через систему не вернуть.` : undefined}>
              <GlassCard>
                {rows.map((row, index) => {
                  const look = METHODS[row.method];
                  return (
                    <View key={row.method}>
                      {index > 0 && <View style={[sheetStyles.separator, styles.separator]} />}
                      <View style={styles.methodRow}>
                        <View style={[styles.methodIcon, { backgroundColor: `${look.color}24` }]}>
                          <SymbolView name={look.symbol} size={16} tintColor={look.color} />
                        </View>
                        <View style={styles.flex}>
                          <Text style={[type.body, sheetStyles.label]}>{look.title}</Text>
                          <Text style={[type.footnote, row.error ? styles.red : sheetStyles.secondary]}>{row.error ?? `до ${rub(row.availK)}`}</Text>
                        </View>
                        <Pressable
                          onPress={() => {
                            haptic.selection();
                            const value = row.method === 'bonus' ? Math.floor(row.availK / 100) * 100 : row.availK;
                            setAmounts((current) => ({ ...current, [row.method]: String(fromKopecks(value)).replace('.', ',') }));
                          }}
                          hitSlop={6}
                          style={({ pressed }) => [styles.allButton, pressed && styles.pressed]}
                          accessibilityRole="button"
                          accessibilityLabel={`Вернуть всё: ${look.title}`}>
                          <Text style={[type.caption1, styles.allText]}>Всё</Text>
                        </Pressable>
                        <TextInput
                          value={row.text}
                          onChangeText={(text) => setAmounts((current) => ({ ...current, [row.method]: text }))}
                          keyboardType={row.method === 'bonus' ? 'number-pad' : 'decimal-pad'}
                          placeholder="0"
                          placeholderTextColor={colors.tertiaryLabel}
                          selectionColor={colors.accent}
                          style={[type.headline, type.amount, styles.amountInput, row.error && styles.amountError]}
                          maxFontSizeMultiplier={FONT_SCALE_MAX.compact}
                          accessibilityLabel={`Сумма возврата: ${look.title}`}
                        />
                      </View>
                    </View>
                  );
                })}
              </GlassCard>
              {rows.length > 1 && (
                <Pressable onPress={fillAll} style={({ pressed }) => [styles.fillAll, pressed && styles.pressed]} accessibilityRole="button">
                  <Text style={[type.subhead, styles.allText]}>{`Вернуть всё доступное — ${rub(toKopecks(prepare.maxRefund))}`}</Text>
                </Pressable>
              )}
            </FormSection>

            {recipientMissing && <Notice tone="red" icon="person.crop.circle.badge.xmark" text="У чека нет клиента — вернуть на депозит, долг или бонусы нельзя." />}
            {certificateMissing && <Notice tone="red" icon="giftcard" text="У чека нет сертификата для возврата." />}
            {needsPlayer && !recipientMissing && <Notice tone="blue" icon="person.crop.circle.badge.checkmark" text={`Депозит, долг и бонусы зачислятся клиенту ${player.data?.nickname ?? 'чека'}.`} />}
            {manualK > 0 && <Notice tone="orange" icon="arrow.left.arrow.right" text={`Перевод и СБП система только запишет — ${rub(manualK)} нужно вернуть гостю вручную через банк или кабинет эквайринга.`} />}
            {otherShift && <Notice tone="orange" icon="exclamationmark.triangle.fill" text="Чек из другой смены: выданные наличные в остатке текущей кассы не учтутся — при закрытии смены будет недостача." />}
            {cashShort && inRegisterK !== null && <Notice tone="orange" icon="banknote" text={`В кассе ${rub(inRegisterK)} — после выдачи остаток уйдёт в минус.`} />}

            {goods.length > 0 && (
              <FormSection title="ТОВАРЫ НА СКЛАД" footer="Отметьте, что гость реально вернул. Неотмеченные товары остатки не меняют.">
                <GlassCard>
                  {goods.map((good, index) => {
                    const qty = Math.min(restore[good.itemId] ?? 0, good.max);
                    return (
                      <View key={good.itemId}>
                        {index > 0 && <View style={[sheetStyles.separator, styles.goodSeparator]} />}
                        <View style={styles.goodRow}>
                          <View style={styles.flex}>
                            <Text style={[type.body, sheetStyles.label]} numberOfLines={1}>
                              {good.name}
                            </Text>
                            <Text style={[type.footnote, sheetStyles.secondary]}>
                              {good.max === good.sold ? `продано ${good.sold}` : `продано ${good.sold} · уже на складе ${good.sold - good.max}`}
                            </Text>
                          </View>
                          <Stepper
                            value={qty}
                            max={good.max}
                            onChange={(next) => {
                              haptic.selection();
                              setRestore((current) => ({ ...current, [good.itemId]: next }));
                            }}
                          />
                        </View>
                      </View>
                    );
                  })}
                </GlassCard>
              </FormSection>
            )}

            <FormSection title="КОММЕНТАРИЙ">
              <GlassCard style={styles.noteCard}>
                <FormField icon="text.bubble" value={note} onChange={setNote} placeholder="Необязательно" autoCapitalize="sentences" />
              </GlassCard>
            </FormSection>

            <PrimaryButton
              title={busy ? 'Проверяем…' : totalK > 0 ? `Оформить возврат · ${rub(totalK)}` : 'Введите сумму возврата'}
              icon="arrow.uturn.backward"
              busy={busy}
              disabled={!canSubmit}
              onPress={() => void review()}
            />
            <Text style={[type.footnote, sheetStyles.secondary, styles.centered]}>Перед оформлением покажем итог. Отменить возврат нельзя.</Text>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <View style={styles.stat}>
      <Text style={[type.caption1, sheetStyles.secondary]}>{label}</Text>
      <Text style={[type.subhead, type.amount, accent ? styles.green : sheetStyles.label]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
    </View>
  );
}

const TONES = {
  red: { tint: 'rgba(255,59,48,0.14)', color: '#F43F5E' },
  orange: { tint: 'rgba(255,149,0,0.16)', color: '#F59E0B' },
  blue: { tint: 'rgba(59,130,246,0.14)', color: '#3B82F6' },
  gray: { tint: undefined, color: '#94A3B8' },
} as const;

function Notice({ tone, icon, text }: { tone: keyof typeof TONES; icon: Parameters<typeof SymbolView>[0]['name']; text: string }) {
  return (
    <Animated.View entering={FadeIn.duration(160)}>
      <GlassCard tint={TONES[tone].tint} style={styles.notice}>
        <SymbolView name={icon} size={20} tintColor={TONES[tone].color} />
        <Text style={[type.subhead, sheetStyles.label, styles.flex]}>{text}</Text>
      </GlassCard>
    </Animated.View>
  );
}

function Stepper({ value, max, onChange }: { value: number; max: number; onChange: (next: number) => void }) {
  if (max === 0) return <Text style={[type.footnote, sheetStyles.tertiary]}>всё возвращено</Text>;
  return (
    <GlassView style={styles.stepper}>
      <Pressable onPress={() => onChange(Math.max(0, value - 1))} disabled={value === 0} hitSlop={6} style={styles.stepButton} accessibilityRole="button" accessibilityLabel="Меньше">
        <SymbolView name="minus" size={14} weight="semibold" tintColor={value === 0 ? colors.tertiaryLabel : colors.label} />
      </Pressable>
      <Text style={[type.headline, type.amount, sheetStyles.label, styles.stepValue]} maxFontSizeMultiplier={FONT_SCALE_MAX.compact}>
        {value}
      </Text>
      <Pressable onPress={() => onChange(Math.min(max, value + 1))} disabled={value >= max} hitSlop={6} style={styles.stepButton} accessibilityRole="button" accessibilityLabel="Больше">
        <SymbolView name="plus" size={14} weight="semibold" tintColor={value >= max ? colors.tertiaryLabel : colors.label} />
      </Pressable>
    </GlassView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  loading: { flex: 1, minHeight: 300, alignItems: 'center', justifyContent: 'center', gap: space.md, padding: space.xxl },
  centered: { textAlign: 'center' },
  red: { color: colors.red },
  green: { color: colors.green },
  orange: { color: colors.orange },
  pressed: { opacity: 0.6 },
  content: { paddingHorizontal: space.lg, paddingTop: space.xl, gap: space.lg },
  checkCard: { padding: space.lg, gap: space.md },
  checkTop: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  stats: { flexDirection: 'row', gap: space.sm },
  stat: { flex: 1, gap: 2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  separator: { marginLeft: 60 },
  methodRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, minHeight: 64 },
  methodIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  allButton: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: colors.fill },
  allText: { color: colors.accent, fontWeight: '600' },
  amountInput: { width: 104, minHeight: 42, borderRadius: 12, backgroundColor: colors.fill, color: colors.label, textAlign: 'right', paddingHorizontal: space.md },
  amountError: { backgroundColor: 'rgba(255,59,48,0.16)' },
  fillAll: { alignSelf: 'center', paddingVertical: space.xs, paddingHorizontal: space.md },
  notice: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg },
  goodSeparator: { marginLeft: space.lg },
  goodRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, minHeight: 60 },
  stepper: { flexDirection: 'row', alignItems: 'center', borderRadius: 999, paddingHorizontal: 4, minHeight: 36 },
  stepButton: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  stepValue: { minWidth: 24, textAlign: 'center' },
  noteCard: { paddingHorizontal: space.lg },
  done: { flex: 1, minHeight: 420, paddingHorizontal: space.xl, paddingTop: space.xxl, gap: space.xl, justifyContent: 'center' },
  doneIcon: { alignItems: 'center' },
  doneText: { alignItems: 'center', gap: 4 },
  doneAmount: { fontSize: 44, lineHeight: 52, color: colors.label, marginVertical: space.xs },
});
