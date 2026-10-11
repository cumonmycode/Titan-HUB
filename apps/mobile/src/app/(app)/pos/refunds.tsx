import { Host, Picker, Text as SwiftText } from '@expo/ui/swift-ui';
import { pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import { Stack, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, LayoutAnimationConfig } from 'react-native-reanimated';

import { Text } from '@/components/text';
import { AppRefreshControl } from '@/components/refresh-control';
import { AmbientBackdrop } from '@/components/ambient-backdrop';
import { GlassCard, sheetStyles } from '@/components/new-check-parts';
import { formatMoney, plural, toNumber } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { usePageGutter } from '@/lib/layout';
import { METHODS, type TenderMethod } from '@/lib/payment';
import { REFUND_REASONS, useClosedChecks, useRefunds } from '@/lib/refunds-api';
import { colors, space, type } from '@/lib/theme';

type Tab = 'checks' | 'history';

const when = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' });
const money = (n: number) => formatMoney(n, { kopecks: 'auto' });
const methodTitle = (method: string | null) => (method && method in METHODS ? METHODS[method as TenderMethod].title : method === 'split' ? 'Раздельная' : '—');

/**
 * Возвраты: последние закрытые чеки — тап открывает оформление возврата; история — последние 50
 * возвратов с причиной, способами и суммой.
 */
export default function RefundsScreen() {
  const gutter = usePageGutter();
  const router = useRouter();
  const checks = useClosedChecks();
  const refunds = useRefunds();
  const [tab, setTab] = useState<Tab>('checks');
  const [pulling, setPulling] = useState(false);

  const refresh = async () => {
    setPulling(true);
    await Promise.allSettled([checks.refetch(), refunds.refetch()]);
    setPulling(false);
  };

  const refundedChecks = new Set((refunds.data ?? []).map((r) => r.checkId));
  const historyTotal = (refunds.data ?? []).reduce((sum, r) => sum + toNumber(r.totalAmount), 0);

  return (
    <AmbientBackdrop style={styles.screen}>
      <Stack.Title>Возвраты</Stack.Title>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[styles.content, gutter]}
        refreshControl={<AppRefreshControl tintColor={colors.accent} refreshing={pulling} onRefresh={refresh} />}>
        <Host matchContents={{ vertical: true }} style={styles.segment}>
          <Picker
            selection={tab}
            onSelectionChange={(value) => {
              haptic.selection();
              setTab(value as Tab);
            }}
            modifiers={[pickerStyle('segmented')]}>
            <SwiftText modifiers={[tag('checks')]}>Оформить</SwiftText>
            <SwiftText modifiers={[tag('history')]}>История</SwiftText>
          </Picker>
        </Host>

        <LayoutAnimationConfig skipEntering>
          <Animated.View key={tab} entering={FadeIn.duration(180)} style={styles.tab}>
            {tab === 'checks' ? (
              <>
                <Text style={[type.footnote, styles.caption]}>Последние закрытые чеки всех смен. Выберите чек — суммы и товары укажете на следующем шаге.</Text>
                <GlassCard>
                  {checks.isLoading ? (
                    <ActivityIndicator style={styles.state} />
                  ) : !checks.data?.length ? (
                    <Text style={[type.subhead, styles.secondary, styles.centered, styles.state]}>Закрытых чеков нет</Text>
                  ) : (
                    checks.data.map((check, index) => (
                      <View key={check.id}>
                        {index > 0 && <View style={[sheetStyles.separator, styles.separator]} />}
                        <Pressable
                          onPress={() => {
                            haptic.selection();
                            router.push({ pathname: '/pos/refund', params: { checkId: check.id } });
                          }}
                          style={({ pressed }) => [styles.row, pressed && sheetStyles.pressedRow]}
                          accessibilityRole="button">
                          <View style={styles.icon}>
                            <SymbolView name="receipt" size={17} tintColor={colors.accent} />
                          </View>
                          <View style={styles.flex}>
                            <View style={styles.titleRow}>
                              <Text style={[type.body, styles.label, styles.shrink]} numberOfLines={1}>
                                {check.guestName || 'Гость'}
                              </Text>
                              {refundedChecks.has(check.id) && (
                                <View style={styles.badge}>
                                  <Text style={[type.caption2, styles.badgeText]}>был возврат</Text>
                                </View>
                              )}
                            </View>
                            <Text style={[type.footnote, styles.secondary]} numberOfLines={1}>
                              {[
                                `${check.itemCount} ${plural(check.itemCount, ['позиция', 'позиции', 'позиций'])}`,
                                check.closedAt ? when.format(new Date(check.closedAt)) : null,
                                methodTitle(check.paymentMethod),
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                            </Text>
                          </View>
                          <Text style={[type.body, type.amount, styles.label]}>{money(toNumber(check.totalAmount))}</Text>
                          <SymbolView name="chevron.right" size={13} weight="semibold" tintColor={colors.tertiaryLabel} />
                        </Pressable>
                      </View>
                    ))
                  )}
                </GlassCard>
              </>
            ) : (
              <>
                {refunds.data && refunds.data.length > 0 && (
                  <Text style={[type.footnote, styles.caption]}>{`${refunds.data.length} ${plural(refunds.data.length, ['возврат', 'возврата', 'возвратов'])} на ${money(historyTotal)} — последние 50`}</Text>
                )}
                <GlassCard>
                  {refunds.isLoading ? (
                    <ActivityIndicator style={styles.state} />
                  ) : !refunds.data?.length ? (
                    <Text style={[type.subhead, styles.secondary, styles.centered, styles.state]}>Возвратов не было</Text>
                  ) : (
                    refunds.data.map((refund, index) => (
                      <View key={refund.id}>
                        {index > 0 && <View style={[sheetStyles.separator, styles.separator]} />}
                        <Pressable
                          onPress={() => {
                            haptic.selection();
                            router.push({ pathname: '/pos/[checkId]', params: { checkId: refund.checkId } });
                          }}
                          style={({ pressed }) => [styles.row, pressed && sheetStyles.pressedRow]}
                          accessibilityRole="button"
                          accessibilityHint="Открывает чек">
                          <View style={[styles.icon, styles.refundIcon]}>
                            <SymbolView name="arrow.uturn.backward" size={16} tintColor={colors.red} />
                          </View>
                          <View style={styles.flex}>
                            <Text style={[type.body, styles.label]} numberOfLines={1}>
                              {`${REFUND_REASONS[refund.reason] ?? refund.reason} · ${refund.refundType === 'full' ? 'полный' : 'частичный'}`}
                            </Text>
                            <Text style={[type.footnote, styles.secondary]} numberOfLines={2}>
                              {[
                                when.format(new Date(refund.createdAt)),
                                refund.tenders?.map((t) => `${methodTitle(t.method)} ${money(t.amount)}`).join(', '),
                                refund.restoredItems?.length ? `на склад ${refund.restoredItems.reduce((s, i) => s + i.quantity, 0)} шт` : null,
                                refund.note,
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                            </Text>
                          </View>
                          <Text style={[type.body, type.amount, styles.red]}>{money(-toNumber(refund.totalAmount))}</Text>
                        </Pressable>
                      </View>
                    ))
                  )}
                </GlassCard>
              </>
            )}
          </Animated.View>
        </LayoutAnimationConfig>
      </ScrollView>
    </AmbientBackdrop>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.groupedBackground },
  flex: { flex: 1 },
  shrink: { flexShrink: 1 },
  content: { paddingHorizontal: space.lg, paddingBottom: 140, gap: space.md },
  label: { color: colors.label },
  secondary: { color: colors.secondaryLabel },
  red: { color: colors.red },
  centered: { textAlign: 'center' },
  segment: { alignSelf: 'stretch' },
  tab: { gap: space.sm },
  caption: { color: colors.secondaryLabel, paddingHorizontal: space.xs },
  state: { paddingVertical: space.xl },
  separator: { marginLeft: 64 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, minHeight: 62 },
  icon: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(139,92,246,0.14)' },
  refundIcon: { backgroundColor: 'rgba(244,63,94,0.14)' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  badge: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 999, backgroundColor: 'rgba(244,63,94,0.14)' },
  badgeText: { color: colors.red, fontWeight: '700' },
});
