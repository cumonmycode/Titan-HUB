// Чек клиента: позиции, скидки, итог, способы оплаты — «бумажный» чек на стекле шторки.
import { useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Glass, GlassButton } from '@/components/glass';
import { SheetHeader, useCloseSheet } from '@/components/sheet';
import { EmptyState } from '@/components/ui';
import { errorText } from '@/lib/api';
import { clock, longDate, money } from '@/lib/format';
import { useCheck } from '@/lib/queries';
import { colors, GUTTER, MAX_WIDTH, radius, space, type } from '@/lib/theme';

const PAY_LABELS: Record<string, string> = {
  cash: 'Наличные', card: 'Карта', transfer: 'Перевод', sbp: 'СБП', bonus: 'Бонусы',
  deposit: 'Депозит', debt: 'В долг', certificate: 'Сертификат', split: 'Раздельная',
};

export default function CheckScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const close = useCloseSheet();
  const q = useCheck(id);
  const d = q.data;
  const when = d ? (d.check.closedAt ?? d.check.createdAt) : null;
  const subtotal = d ? d.items.reduce((s, i) => s + i.lineTotal, 0) : 0;

  return (
    <View style={styles.root}>
      <SheetHeader title="Чек" onClose={close} />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space.xxl }]}>
        <View style={styles.column}>
          {q.isLoading ? <ActivityIndicator color={colors.lavender} style={styles.loader} />
            : !d ? (
              <EmptyState icon="receipt" title="Чек не найден" text={q.error ? errorText(q.error) : undefined}>
                <GlassButton title="Закрыть" variant="secondary" onPress={close} />
              </EmptyState>
            ) : (
              <Glass style={styles.paper}>
                <View style={styles.paperHead}>
                  <Text style={styles.brand}>TITAN</Text>
                  {when ? <Text style={type.caption}>{longDate(when)} · {clock(when)}</Text> : null}
                </View>
                <Dashed />
                {d.items.map((it, i) => (
                  <View key={i} style={styles.line}>
                    <Text style={styles.itemName}>{it.name}</Text>
                    <Text style={styles.qty}>×{it.quantity}</Text>
                    <Text style={styles.itemSum}>{money(it.lineTotal)}</Text>
                  </View>
                ))}
                {d.discounts.length ? (
                  <>
                    <Dashed />
                    <View style={styles.line}>
                      <Text style={[styles.itemName, styles.muted]}>Сумма</Text>
                      <Text style={[styles.itemSum, styles.muted]}>{money(subtotal)}</Text>
                    </View>
                    {d.discounts.map((ds, i) => (
                      <View key={i} style={styles.line}>
                        <Text style={[styles.itemName, styles.discount]}>Скидка{ds.name ? ` · ${ds.name}` : ''}</Text>
                        <Text style={[styles.itemSum, styles.discount]}>−{money(ds.amount)}</Text>
                      </View>
                    ))}
                  </>
                ) : null}
                <Dashed />
                <View style={styles.totalRow}>
                  <Text style={type.headline}>Итого</Text>
                  <Text style={styles.total}>{money(d.check.totalAmount)}</Text>
                </View>
                {(d.check.tipAmount ?? 0) > 0 ? (
                  <View style={styles.line}>
                    <Text style={[styles.itemName, styles.tip]}>Чаевые</Text>
                    <Text style={[styles.itemSum, styles.tip]}>+{money(d.check.tipAmount ?? 0)}</Text>
                  </View>
                ) : null}
                <View style={styles.payRow}>
                  {d.payments.map((p, i) => (
                    <View key={i} style={styles.payChip}>
                      <Text style={styles.payText}>{PAY_LABELS[p.method] ?? p.method} · {money(p.amount)}</Text>
                    </View>
                  ))}
                </View>
              </Glass>
            )}
        </View>
      </ScrollView>
    </View>
  );
}

function Dashed() {
  return <View style={styles.dashed} />;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: GUTTER },
  column: { width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center' },
  loader: { marginTop: 60 },
  paper: { borderRadius: radius.card, padding: space.xl },
  paperHead: { alignItems: 'center', gap: 4, marginBottom: space.sm },
  brand: { color: colors.lavender, fontSize: 16, fontWeight: '900', letterSpacing: 4 },
  dashed: { borderBottomWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.16)', marginVertical: space.md },
  line: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm, paddingVertical: 5 },
  itemName: { flex: 1, color: colors.textBody, fontSize: 14.5 },
  qty: { color: colors.textSecondary, fontSize: 13, fontVariant: ['tabular-nums'] },
  itemSum: { color: colors.textBody, fontSize: 14.5, fontWeight: '600', fontVariant: ['tabular-nums'], minWidth: 72, textAlign: 'right' },
  muted: { color: colors.textSecondary },
  discount: { color: colors.amber },
  tip: { color: colors.green },
  totalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 },
  total: { color: colors.text, fontSize: 28, fontWeight: '900', fontStyle: 'italic', fontVariant: ['tabular-nums'] },
  payRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: space.md },
  payChip: { paddingHorizontal: 11, paddingVertical: 6, borderRadius: 10, backgroundColor: 'rgba(139,92,246,0.18)' },
  payText: { color: colors.lavender, fontSize: 12.5, fontWeight: '700' },
});
