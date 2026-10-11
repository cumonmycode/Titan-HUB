import { Image } from 'expo-image';
import { useKeepAwake } from 'expo-keep-awake';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { SymbolView } from 'expo-symbols';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Share, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, ZoomIn } from 'react-native-reanimated';

import { Text } from '@/components/text';
import { GlassView } from '@/components/glass';
import { PrimaryButton, sheetStyles } from '@/components/new-check-parts';
import { PaymentSuccess } from '@/components/payment-success';
import { formatMoney, toNumber } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import {
  createQrPayment,
  invalidateAfterPayment,
  qrPaymentStatus,
  round2,
  usePaymentDraft,
  waitForCheckClosed,
  type QrPayment,
} from '@/lib/payment';
import { usePosSelection } from '@/lib/pos-selection';
import { useCheck } from '@/lib/queries';
import { isSplitLayout } from '@/lib/layout';
import { colors, space, type } from '@/lib/theme';

const SHEET_DISMISS_MS = 420;
const POLL_MS = 3000;

type Phase = 'creating' | 'waiting' | 'confirming' | 'paid' | 'failed' | 'error';

/**
 * СБП: QR на весь чек и ожидание оплаты. Каждый QR — живая транзакция у эквайера,
 * отменить её нельзя, поэтому новый создаётся только по кнопке, а уход с живым QR
 * требует подтверждения.
 */
export default function SbpScreen() {
  const params = useLocalSearchParams<{ checkId: string; surcharge?: string; base?: string }>();
  const checkId = params.checkId;
  const surcharge8 = params.surcharge === '1';
  const estimatedBase = toNumber(params.base);
  const router = useRouter();
  const navigation = useNavigation();
  const check = useCheck(checkId);
  const [phase, setPhase] = useState<Phase>('creating');
  const [qr, setQr] = useState<QrPayment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  // Гость сканирует экран кассира — не даём экрану погаснуть.
  useKeepAwake();

  const start = async () => {
    setPhase('creating');
    setError(null);
    setQr(null);
    try {
      const created = await createQrPayment(checkId, surcharge8);
      setQr(created);
      setPhase('waiting');
    } catch (e) {
      haptic.error();
      setError(e instanceof Error ? e.message : String(e));
      setPhase('error');
    }
  };

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Вебхук мог закрыть чек раньше, чем статус дошёл до нас, — это тоже оплата.
  const checkClosed = check.data?.status === 'closed';
  const paid = phase === 'paid' || (checkClosed && (phase === 'waiting' || phase === 'confirming'));

  useEffect(() => {
    if (!paid) return;
    invalidateAfterPayment(checkId);
    usePaymentDraft.getState().clear();
    haptic.success();
  }, [paid, checkId]);

  const markPaid = () => setPhase('paid');

  // Опрос статуса. Без номера транзакции статус не узнать — следим за самим чеком.
  useEffect(() => {
    if (phase !== 'waiting' || paid) return;
    let stopped = false;
    const transactionId = qr?.transactionId;

    const onConfirmed = async () => {
      setPhase('confirming');
      if (await waitForCheckClosed(checkId)) return markPaid();
      // Банк подтвердил, а вебхук чек не закрыл — проводим переводом на сумму без комиссии.
      usePaymentDraft.getState().confirmQr(checkId, qr?.baseAmount ?? estimatedBase);
      haptic.success();
      router.back();
    };

    const timer = setInterval(async () => {
      if (!transactionId) {
        void check.refetch();
        return;
      }
      const status = await qrPaymentStatus(checkId, transactionId).catch(() => 'pending' as const);
      if (stopped) return;
      if (status === 'confirmed') {
        stopped = true;
        clearInterval(timer);
        void onConfirmed();
      } else if (status === 'failed') {
        stopped = true;
        clearInterval(timer);
        haptic.warning();
        setPhase('failed');
      }
    }, POLL_MS);

    return () => {
      stopped = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, paid, qr, checkId]);

  usePreventRemove(!paid && (phase === 'waiting' || phase === 'creating'), ({ data }) => {
    Alert.alert(
      'QR ещё действует',
      'Если гость оплатит по нему после того, как чек закроют другим способом, деньги придётся возвращать вручную.',
      [
        { text: 'Остаться', style: 'cancel' },
        { text: 'Уйти', style: 'destructive', onPress: () => navigation.dispatch(data.action) },
      ],
    );
  });

  const finish = () => {
    const split = isSplitLayout();
    if (split) usePosSelection.getState().select(null);
    // Закрываем всю шторку оплаты (родительский стек), затем — экран чека, если он был.
    navigation.getParent()?.goBack();
    if (!split) setTimeout(() => router.dismissTo('/pos'), SHEET_DISMISS_MS);
  };

  const charged = qr?.chargedAmount ?? (surcharge8 ? round2(estimatedBase * 1.08) : estimatedBase);
  const base = qr?.baseAmount ?? estimatedBase;

  if (paid) {
    return <PaymentSuccess title="Оплачено по СБП" amount={charged} change={0} onDone={finish} />;
  }

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>
      {(phase === 'creating' || phase === 'waiting' || phase === 'confirming') && (
        <>
          <View style={styles.qrCard}>
            {phase === 'creating' ? (
              <ActivityIndicator color="#6B7280" />
            ) : qr?.qrDataUrl ? (
              <Animated.View entering={ZoomIn.springify().damping(16)}>
                <Image source={{ uri: qr.qrDataUrl }} style={styles.qrImage} contentFit="contain" accessibilityLabel="QR-код для оплаты" />
              </Animated.View>
            ) : (
              <View style={styles.noQr}>
                <SymbolView name="link" size={34} tintColor="#6B7280" />
                <Text style={[type.footnote, styles.noQrText]}>QR пока недоступен — отправьте гостю ссылку на оплату</Text>
              </View>
            )}
            {phase === 'confirming' && (
              <Animated.View entering={FadeIn} style={styles.confirmedOverlay}>
                <SymbolView name="checkmark.circle.fill" size={64} tintColor={colors.green} animationSpec={{ effect: { type: 'bounce' } }} />
              </Animated.View>
            )}
          </View>

          <View style={styles.amountBlock}>
            <Text style={[type.subhead, sheetStyles.secondary]}>
              {phase === 'confirming' ? 'Банк подтвердил оплату' : 'Отсканируйте в приложении банка'}
            </Text>
            <Text style={[styles.amount, type.amount]}>{formatMoney(charged, { kopecks: 'auto' })}</Text>
            {surcharge8 && (
              <Text style={[type.footnote, sheetStyles.secondary]}>{`С комиссией 8% · чек ${formatMoney(base, { kopecks: 'auto' })}`}</Text>
            )}
          </View>

          <View style={styles.status}>
            <ActivityIndicator />
            <Text style={[type.subhead, sheetStyles.secondary]}>
              {phase === 'creating' ? 'Создаём QR…' : phase === 'confirming' ? 'Закрываем чек…' : 'Ждём оплату'}
            </Text>
          </View>

          {qr?.warning && <Text style={[type.footnote, styles.warning]}>{qr.warning}</Text>}

          {qr?.redirectUrl && phase === 'waiting' && (
            <Pressable onPress={() => void Share.share({ url: qr.redirectUrl!, message: `Оплата чека: ${qr.redirectUrl}` })} accessibilityRole="button">
              <GlassView isInteractive style={styles.linkButton}>
                <SymbolView name="square.and.arrow.up" size={16} weight="semibold" tintColor={colors.accent} />
                <Text style={[type.subhead, styles.linkText]}>Ссылка на оплату</Text>
              </GlassView>
            </Pressable>
          )}
        </>
      )}

      {(phase === 'failed' || phase === 'error') && (
        <View style={styles.problem}>
          <SymbolView
            name={phase === 'failed' ? 'xmark.octagon.fill' : 'exclamationmark.triangle.fill'}
            size={52}
            tintColor={phase === 'failed' ? colors.red : colors.orange}
          />
          <Text style={[type.title3, sheetStyles.label]}>{phase === 'failed' ? 'Платёж отменён или истёк' : 'QR не создан'}</Text>
          <Text style={[type.body, sheetStyles.secondary, styles.problemText]}>
            {phase === 'failed' ? 'Можно выставить новый QR или выбрать другой способ оплаты.' : error}
          </Text>
          <View style={styles.problemActions}>
            <PrimaryButton title={phase === 'failed' ? 'Новый QR' : 'Попробовать снова'} onPress={() => void start()} />
            <Pressable style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]} onPress={() => router.back()} accessibilityRole="button">
              <Text style={[type.headline, styles.linkText]}>Другой способ оплаты</Text>
            </Pressable>
          </View>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.xl, gap: space.lg, alignItems: 'center' },
  pressed: { opacity: 0.6 },
  // По ширине экрана, но не больше 288: на «Увеличенном» виде (320 pt) места только 280.
  qrCard: {
    width: '100%',
    maxWidth: 288,
    aspectRatio: 1,
    borderRadius: 28,
    borderCurve: 'continuous',
    backgroundColor: 'white',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
  },
  qrImage: { width: '86%', aspectRatio: 1 },
  noQr: { alignItems: 'center', gap: space.md, paddingHorizontal: space.xxl },
  noQrText: { color: '#4B5563', textAlign: 'center' },
  confirmedOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 28,
    backgroundColor: 'rgba(255,255,255,0.88)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  amountBlock: { alignItems: 'center', gap: 2 },
  amount: { fontSize: 40, lineHeight: 48, color: colors.label },
  status: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  warning: { color: colors.orange, textAlign: 'center' },
  linkButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: 24,
  },
  linkText: { color: colors.accent, fontWeight: '600' },
  problem: { alignSelf: 'stretch', alignItems: 'center', gap: space.md, paddingTop: space.xxxl },
  problemText: { textAlign: 'center' },
  problemActions: { alignSelf: 'stretch', gap: space.sm, marginTop: space.lg },
  secondaryButton: { minHeight: 48, paddingVertical: space.sm, alignItems: 'center', justifyContent: 'center' },
});
