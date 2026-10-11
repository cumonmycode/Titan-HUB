// Оплата: чаевые и QR СБП на одном экране. Сумму и чаевые (процент от итога)
// считает сервер; когда банк подтвердит оплату, визит сам перейдёт к «спасибо».
// Платят картой или наличными — «Принести счёт».
import { Image } from 'expo-image';
import { ReceiptText, X } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { createQr, type Qr, requestBill } from '@/data/actions';
import { errorText } from '@/data/api';
import { useSessionCheck, useVisit } from '@/features/visit/store';
import { amount, money } from '@/lib/format';
import { Button, IconButton } from '@/ui/button';
import { Layer } from '@/ui/layer';
import { useScreen } from '@/ui/screen';
import { Segmented } from '@/ui/segmented';
import { T } from '@/ui/text';
import { color } from '@/ui/tokens';

const TIPS = [0, 5, 10, 15] as const;
type Tip = `${(typeof TIPS)[number]}`;

export function PayLayer() {
  const open = useVisit((s) => s.layer === 'pay');
  const { width } = useScreen();
  return (
    <Layer visible={open} onClose={() => useVisit.getState().close()} variant="dialog" style={{ width: Math.min(960, width - 48) }}>
      <PayBody />
    </Layer>
  );
}

function PayBody() {
  const check = useSessionCheck();
  const { width, height } = useScreen();
  const portrait = width < height;
  const [tip, setTip] = useState<Tip>('0');
  const [qr, setQr] = useState<Qr | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyBill, setBusyBill] = useState(false);
  const checkId = check?.id ?? null;

  // Новый QR на каждый выбор чаевых: гость передумал — старый просто не оплатят.
  useEffect(() => {
    if (!checkId) return;
    let cancelled = false;
    const t = setTimeout(() => {
      setQr(null);
      setError(null);
      createQr(checkId, Number(tip))
        .then((res) => { if (!cancelled) setQr(res); })
        .catch((e: unknown) => { if (!cancelled) setError(errorText(e)); });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [checkId, tip]);

  if (!check) return null;
  const total = qr?.chargedAmount ?? check.totals.total;
  const base = qr?.baseAmount ?? check.totals.total;

  const bill = async () => {
    setBusyBill(true);
    const ok = await requestBill(check.id);
    setBusyBill(false);
    if (ok) useVisit.getState().close();
  };

  return (
    <>
      <View style={styles.head}>
        <T variant="title" style={{ flex: 1 }}>Оплата по СБП</T>
        <IconButton icon={X} label="Закрыть" onPress={() => useVisit.getState().close()} />
      </View>
      <View style={[styles.body, portrait && styles.bodyPortrait]}>
        <View style={styles.qrCard}>
          {qr?.qrDataUrl ? (
            <Image source={{ uri: qr.qrDataUrl }} style={styles.qr} contentFit="contain" transition={120} />
          ) : (
            <View style={[styles.qr, styles.qrWait]}>
              {error ? (
                <T variant="label" style={{ color: '#4a4552', textAlign: 'center' }}>QR сейчас недоступен — попросите принести счёт</T>
              ) : (
                <ActivityIndicator color="#6d28d9" size="large" />
              )}
            </View>
          )}
          <T variant="small" style={{ color: '#4a4552', textAlign: 'center' }}>Камера телефона или приложение банка</T>
        </View>

        <View style={styles.info}>
          <T variant="overline" tone="secondary">К оплате</T>
          <View style={styles.totalRow}>
            <T variant="display" numeric style={{ fontSize: 72, lineHeight: 78 }}>{amount(total)}</T>
            <T variant="title" tone="accent" style={styles.rub}>₽</T>
          </View>
          <T variant="body" tone="secondary" numeric>
            {qr?.tip ? `Счёт ${money(base)} + чаевые команде ${money(qr.tip)}` : 'Чаевые можно добавить ниже'}
          </T>
          <Segmented<Tip>
            height={54}
            value={tip}
            onChange={setTip}
            options={TIPS.map((p) => ({ key: `${p}` as Tip, label: p ? `${p} %` : 'Без чаевых' }))}
          />
          {qr?.qrDataUrl ? (
            <View style={styles.status}>
              <View style={[styles.dot, { backgroundColor: color.accentSoft }]} />
              <T variant="body" tone="secondary" style={{ flex: 1, fontSize: 16 }}>Ждём подтверждения банка — экран обновится сам</T>
            </View>
          ) : null}
          <View style={styles.altRow}>
            <T variant="caption" tone="secondary" style={{ flex: 1 }}>Удобнее картой или наличными?</T>
            <Button title="Принести счёт" icon={ReceiptText} onPress={() => void bill()} loading={busyBill} />
          </View>
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  body: { flexDirection: 'row', alignItems: 'center', gap: 32 },
  bodyPortrait: { flexDirection: 'column', alignItems: 'stretch', gap: 20 },
  qrCard: { alignSelf: 'center', width: 340, padding: 22, borderRadius: 36, backgroundColor: '#ffffff', alignItems: 'center', gap: 14 },
  qr: { width: 290, height: 290 },
  qrWait: { alignItems: 'center', justifyContent: 'center', padding: 24 },
  info: { flex: 1, minWidth: 0, gap: 14 },
  totalRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: -6 },
  rub: { fontSize: 32, lineHeight: 48, fontFamily: 'Inter_500Medium' },
  status: {
    flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingVertical: 14, borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)',
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  altRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: color.hairline },
});
