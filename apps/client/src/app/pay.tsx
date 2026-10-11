// Оплата: пополнить депозит, погасить долг, внести взнос (фонд клуба и разовые сборы).
// Шторка открывается уже под конкретный платёж (purpose/collectionId в параметрах) —
// с главной: «Пополнить» у депозита или «Оплатить» в блоке «К оплате».
// Платёж создаётся на сервере и открывается страница СБП эквайера клуба; деньги
// зачисляются, когда банк подтвердит платёж (вебхук) — приложение ждёт этого,
// опрашивая статус. Закрыть шторку можно в любой момент: зачисление всё равно
// произойдёт, а клиент получит уведомление.
import { useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, ZoomIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlassButton, GlassChip } from '@/components/glass';
import { Icon, type IconName } from '@/components/icon';
import { amountToInput, Keypad, parseAmount } from '@/components/keypad';
import { SheetHeader, useCloseSheet } from '@/components/sheet';
import { EmptyState, Surface } from '@/components/ui';
import { errorText } from '@/lib/api';
import { money } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { createPayment, paymentStatus, refreshMoney, useWallet } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { colors, GUTTER, IS_IOS, MAX_WIDTH, space, type } from '@/lib/theme';
import type { CreatedPayment, PayPurpose, Wallet } from '@/lib/types';

type Phase = 'form' | 'creating' | 'waiting' | 'success' | 'failed' | 'timeout';
interface Target { id: string; purpose: PayPurpose; collectionId?: string; title: string; label: string; hint: string }

const POLL_MS = 3000;
const WAIT_LIMIT_MS = 8 * 60 * 1000;
const QUICK = [500, 1000, 2000, 5000];

function targetsFor(w: Wallet): Target[] {
  const list: Target[] = [
    { id: 'deposit', purpose: 'deposit', title: 'Пополнить депозит', label: 'Депозит', hint: 'Деньги на личном счёте в клубе' },
  ];
  if (w.debt > 0) list.unshift({ id: 'debt', purpose: 'debt', title: 'Погасить долг', label: 'Долг', hint: `Текущий долг ${money(w.debt)}` });
  for (const c of w.collections.filter((x) => !x.excluded)) {
    list.push({
      id: `fund:${c.id}`, purpose: 'fund', collectionId: c.id, title: c.name, label: c.name,
      hint: c.topUp > 0 ? `К оплате ${money(c.topUp)}${c.kind === 'recurring' ? ` · ${c.period.label}` : ''}` : c.kind === 'recurring' ? 'Оплачено — можно внести вперёд' : 'Оплачено',
    });
  }
  return list;
}

function suggested(t: Target, w: Wallet): number {
  if (t.purpose === 'debt') return w.debt;
  if (t.purpose === 'fund') {
    const c = w.collections.find((x) => x.id === t.collectionId);
    return c ? (c.topUp > 0 ? c.topUp : c.due) : 0;
  }
  return 0;
}

const groupDigits = (s: string) => s.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

export default function PayScreen() {
  const insets = useSafeAreaInsets();
  const close = useCloseSheet();
  const params = useLocalSearchParams<{ purpose?: string; collectionId?: string }>();
  const { data: w } = useWallet();
  const demo = useSession((s) => s.status === 'demo');

  const targets = useMemo(() => (w ? targetsFor(w) : []), [w]);
  const target = useMemo(() => {
    if (!targets.length) return null;
    if (params.purpose === 'fund') {
      return targets.find((t) => t.collectionId === params.collectionId)
        ?? targets.find((t) => t.purpose === 'fund' && w?.collections.find((c) => c.id === t.collectionId)?.topUp)
        ?? targets.find((t) => t.purpose === 'fund') ?? targets[0];
    }
    return targets.find((t) => t.purpose === params.purpose) ?? targets[0];
  }, [targets, params.purpose, params.collectionId, w]);

  const [amountInput, setAmountInput] = useState<string | null>(null);
  const amountStr = amountInput ?? (target && w ? amountToInput(suggested(target, w)) : '');
  const amount = parseAmount(amountStr);

  const [phase, setPhase] = useState<Phase>('form');
  const [error, setError] = useState<string | null>(null);
  const [payment, setPayment] = useState<CreatedPayment | null>(null);
  const [kick, setKick] = useState(0);
  const startedAt = useRef(0);
  const checking = useRef(false);

  const surcharge = w?.pay.surchargePercent ?? 8;
  const charged = Math.round(amount * (100 + surcharge)) / 100;
  const canPay = !!target && amount >= 1 && phase === 'form';

  async function openBank(url: string) {
    if (demo) return;
    await WebBrowser.openBrowserAsync(url, {
      toolbarColor: colors.background,
      controlsColor: colors.violetLight,
      presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
      showTitle: true,
    }).catch(() => {});
    // Клиент закрыл страницу банка — сразу проверяем статус (через эффект ниже).
    setKick((k) => k + 1);
  }

  async function pay() {
    if (!target || !canPay) return;
    setError(null);
    setPhase('creating');
    try {
      const p = await createPayment({ purpose: target.purpose, amount, ...(target.collectionId ? { collectionId: target.collectionId } : {}) });
      setPayment(p);
      startedAt.current = Date.now();
      setPhase('waiting');
      void openBank(p.paymentUrl);
    } catch (e) {
      haptic.error();
      setError(errorText(e));
      setPhase('form');
    }
  }

  const check = useEffectEvent(async () => {
    if (phase !== 'waiting' || !payment || checking.current) return;
    checking.current = true;
    try {
      const s = await paymentStatus(payment.paymentId);
      if (s === 'confirmed') {
        if (IS_IOS) void WebBrowser.dismissBrowser().catch(() => {});
        haptic.success();
        refreshMoney();
        setPhase('success');
      } else if (s === 'failed') {
        haptic.error();
        setPhase('failed');
      } else if (Date.now() - startedAt.current > WAIT_LIMIT_MS) {
        setPhase('timeout');
      }
    } catch { /* сеть моргнула — повторим */ } finally {
      checking.current = false;
    }
  });

  useEffect(() => {
    if (phase !== 'waiting') return;
    const t = setInterval(() => void check(), POLL_MS);
    return () => clearInterval(t);
  }, [phase]);

  useEffect(() => {
    if (kick === 0) return;
    const t = setTimeout(() => void check(), 300);
    return () => clearTimeout(t);
  }, [kick]);

  const suggestedAmount = target && w ? suggested(target, w) : 0;

  return (
    <View style={[styles.root, { paddingBottom: Math.max(insets.bottom, space.lg) }]}>
      <SheetHeader title={target?.title ?? 'Оплата'} onClose={close} />

      {!w ? (
        <ActivityIndicator color={colors.lavender} style={styles.loader} />
      ) : !w.pay.online ? (
        <EmptyState icon="wallet" title="Онлайн-оплата временно недоступна"
          text="Пополнить депозит, погасить долг или внести взнос можно на кассе клуба.">
          <GlassButton title="Понятно" variant="secondary" onPress={close} />
        </EmptyState>
      ) : phase === 'success' && payment ? (
        <Success payment={payment} target={target} onDone={close} />
      ) : (phase === 'waiting' || phase === 'timeout' || phase === 'failed') && payment ? (
        <Waiting phase={phase} payment={payment} demo={demo} onReopen={() => void openBank(payment.paymentUrl)}
          onRetry={() => { setPhase('form'); setPayment(null); }} onClose={close} />
      ) : (
        <View style={styles.form}>
          {/* Сумма — по центру свободного места, клавиатура и кнопка — у нижнего края. */}
          <View style={[styles.column, styles.amountArea]}>
            <Text style={styles.hint}>{target?.hint}</Text>
            <View style={styles.amountBox}>
              <Text style={[styles.amount, !amountStr && styles.amountEmpty]} numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={1.1}>
                {amountStr ? `${groupDigits(amountStr)} ₽` : '0 ₽'}
              </Text>
            </View>

            <View style={styles.quickRow}>
              {target?.purpose === 'deposit'
                ? QUICK.map((q) => (
                    <GlassChip key={q} flat label={q.toLocaleString('ru')} selected={parseAmount(amountStr) === q}
                      onPress={() => setAmountInput(String(q))} />
                  ))
                : suggestedAmount > 0 ? (
                    <GlassChip flat label={`${target?.purpose === 'debt' ? 'Весь долг' : 'Вся сумма'} · ${money(suggestedAmount)}`}
                      selected={amount === suggestedAmount} onPress={() => setAmountInput(amountToInput(suggestedAmount))} />
                  ) : null}
            </View>

            <Breakdown target={target} amount={amount} charged={charged} surcharge={surcharge} wallet={w} />
          </View>

          <View style={styles.column}>
            <Keypad value={amountStr} onChange={(v) => { setAmountInput(v); setError(null); }} />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <GlassButton
              title={amount >= 1 ? `Оплатить ${money(charged)}` : 'Введите сумму'}
              icon="bolt"
              loading={phase === 'creating'}
              disabled={!canPay}
              onPress={() => void pay()}
              style={styles.payButton}
            />
            <Text style={styles.sbp}>Оплата через СБП · откроется страница банка</Text>
          </View>
        </View>
      )}
    </View>
  );
}

function Breakdown({ target, amount, charged, surcharge, wallet }: { target: Target | null | undefined; amount: number; charged: number; surcharge: number; wallet: Wallet }) {
  if (!target || amount < 1) return <View style={styles.breakdown} />;
  let note: string | null = null;
  if (target.purpose === 'debt' && amount > wallet.debt && wallet.debt > 0) note = `Сверх долга ${money(amount - wallet.debt)} уйдёт на депозит`;
  if (target.purpose === 'fund') {
    const c = wallet.collections.find((x) => x.id === target.collectionId);
    if (c && c.topUp > 0 && amount < c.topUp) note = `Частичный взнос: останется ${money(c.topUp - amount)}`;
    if (c && c.kind === 'recurring' && c.due > 0 && amount > Math.max(c.topUp, 0) + 0.005) {
      const ahead = Math.floor((amount - Math.max(c.topUp, 0)) / c.due);
      if (ahead > 0) note = `Хватит ещё на ${ahead} мес. вперёд`;
    }
  }
  return (
    <View style={styles.breakdown}>
      <Text style={styles.breakdownText}>
        Зачислим <Text style={styles.strong}>{money(amount)}</Text> · банк +{surcharge}% · к оплате{' '}
        <Text style={styles.total}>{money(charged)}</Text>
      </Text>
      {note ? <Text style={[styles.breakdownText, styles.note]}>{note}</Text> : null}
    </View>
  );
}

function StatusLens({ icon, color, spinning }: { icon?: IconName; color: string; spinning?: boolean }) {
  return (
    <Surface tone={color} style={styles.statusCircle}>
      {spinning ? <ActivityIndicator size="large" color={color} /> : icon ? <Icon name={icon} size={40} color={color} weight="bold" /> : null}
    </Surface>
  );
}

function Waiting({
  phase, payment, demo, onReopen, onRetry, onClose,
}: { phase: Phase; payment: CreatedPayment; demo: boolean; onReopen: () => void; onRetry: () => void; onClose: () => void }) {
  if (phase === 'failed') {
    return (
      <Animated.View entering={FadeInDown.duration(300)} style={[styles.column, styles.center]}>
        <StatusLens icon="close" color={colors.red} />
        <Text style={styles.statusTitle}>Платёж не прошёл</Text>
        <Text style={styles.centerText}>Деньги не списаны. Попробуйте ещё раз или выберите другой банк.</Text>
        <GlassButton title="Попробовать снова" onPress={onRetry} style={styles.wide} />
        <GlassButton title="Закрыть" variant="ghost" onPress={onClose} />
      </Animated.View>
    );
  }
  return (
    <Animated.View entering={FadeInDown.duration(300)} style={[styles.column, styles.center]}>
      <StatusLens icon={phase === 'timeout' ? 'pending' : undefined} spinning={phase !== 'timeout'} color={colors.lavender} />
      <Text style={styles.statusTitle}>{phase === 'timeout' ? 'Ждём подтверждение банка' : 'Ожидаем оплату'}</Text>
      <Text style={styles.centerText}>
        {demo
          ? 'Демо-режим: платёж подтвердится сам через пару секунд.'
          : phase === 'timeout'
            ? 'Если вы оплатили — деньги зачислятся автоматически, мы пришлём уведомление. Шторку можно закрыть.'
            : `Подтвердите платёж ${money(payment.charged)} в приложении банка. Как только банк ответит, баланс обновится.`}
      </Text>
      {!demo ? <GlassButton title="Открыть страницу оплаты" variant="secondary" icon="external" onPress={onReopen} style={styles.wide} /> : null}
      <GlassButton title="Закрыть" variant="ghost" onPress={onClose} />
    </Animated.View>
  );
}

function Success({ payment, target, onDone }: { payment: CreatedPayment; target: Target | null | undefined; onDone: () => void }) {
  const title = target?.purpose === 'debt' ? 'Долг погашен' : target?.purpose === 'fund' ? 'Взнос получен' : 'Депозит пополнен';
  return (
    <View style={[styles.column, styles.center]}>
      <Animated.View entering={ZoomIn.springify().damping(12)} style={[styles.statusCircle, styles.successCircle]}>
        <Icon name="check" size={48} color="#fff" weight="heavy" />
      </Animated.View>
      <Animated.Text entering={FadeInDown.delay(150).duration(350)} style={[type.title, styles.successTitle]}>
        {title}
      </Animated.Text>
      <Animated.Text entering={FadeInDown.delay(230).duration(350)} style={styles.successAmount}>
        +{money(payment.base)}
      </Animated.Text>
      <Animated.View entering={FadeIn.delay(400)} style={styles.stretch}>
        <Text style={styles.centerText}>{target?.label ?? ''} · оплачено {money(payment.charged)} с учётом комиссии банка</Text>
        <GlassButton title="Готово" onPress={onDone} style={styles.wide} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  loader: { marginTop: 60 },
  form: { flex: 1 },
  column: { width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center', paddingHorizontal: GUTTER },
  amountArea: { flex: 1, justifyContent: 'center', minHeight: 200 },
  hint: { ...StyleSheet.flatten(type.caption), textAlign: 'center' },
  amountBox: { alignItems: 'center', justifyContent: 'center', minHeight: 80, marginTop: space.xs },
  amount: { color: colors.text, fontSize: 56, fontWeight: '900', fontStyle: 'italic', letterSpacing: -1.5, fontVariant: ['tabular-nums'] },
  amountEmpty: { color: colors.textMuted },
  quickRow: { flexDirection: 'row', justifyContent: 'center', gap: space.sm, minHeight: 40, flexWrap: 'wrap', marginTop: space.xs },
  breakdown: { minHeight: 48, justifyContent: 'center', marginTop: space.sm },
  breakdownText: { color: colors.textSecondary, fontSize: 13, textAlign: 'center', lineHeight: 18 },
  strong: { color: colors.text, fontWeight: '700' },
  total: { color: colors.lavender, fontWeight: '800' },
  note: { color: colors.amber, marginTop: 2 },
  error: { color: colors.red, fontSize: 13, textAlign: 'center', marginTop: space.sm },
  payButton: { marginTop: space.md },
  sbp: { color: colors.textMuted, fontSize: 11.5, textAlign: 'center', marginTop: space.sm },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 40 },
  centerText: { ...StyleSheet.flatten(type.callout), color: colors.textSecondary, textAlign: 'center', marginTop: space.sm, paddingHorizontal: space.md },
  statusTitle: { ...StyleSheet.flatten(type.heading), textAlign: 'center', marginTop: space.xl },
  statusCircle: { width: 96, height: 96, borderRadius: 48, alignItems: 'center', justifyContent: 'center' },
  successCircle: { experimental_backgroundImage: 'linear-gradient(135deg, #34D399 0%, #059669 100%)', boxShadow: '0 14px 36px rgba(16,185,129,0.4)' },
  successTitle: { textAlign: 'center', marginTop: space.xl },
  successAmount: { color: colors.greenBright, fontSize: 34, fontWeight: '900', fontStyle: 'italic', textAlign: 'center', marginTop: space.sm, fontVariant: ['tabular-nums'] },
  stretch: { alignSelf: 'stretch' },
  wide: { alignSelf: 'stretch', marginTop: space.xl },
});
