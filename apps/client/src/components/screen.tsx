// Каркас экранов вкладок.
//
// iOS: заголовок — системная шапка стека (крупный заголовок сворачивается при прокрутке,
// край контента под шапкой и над таб-баром размывается сам — scroll edge effect iOS 26),
// поэтому ScrollView идёт с contentInsetAdjustmentBehavior="automatic" и без своих отступов.
// Android: шапки нет — крупный заголовок рисуется в начале контента, снизу запас под
// плавающую капсулу вкладок.
import { type ReactNode, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { haptic } from '@/lib/haptics';
import { colors, GUTTER, IS_IOS, MAX_WIDTH, space, type } from '@/lib/theme';

import { useTabClearance } from './tab-bar';

/** Pull-to-refresh: крутится только от ручного жеста, фоновые обновления его не дёргают. */
export function useManualRefresh(refresh: () => Promise<unknown>) {
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = async () => {
    haptic.soft();
    setRefreshing(true);
    try { await refresh(); } finally { setRefreshing(false); }
  };
  return { refreshing, onRefresh };
}

/** Общие свойства прокрутки экрана вкладки (ScrollView, FlatList, SectionList). */
export function useTabScrollProps(onRefresh?: () => Promise<unknown>) {
  const insets = useSafeAreaInsets();
  const clearance = useTabClearance();
  const refresh = useManualRefresh(onRefresh ?? (async () => {}));
  return {
    contentInsetAdjustmentBehavior: 'automatic' as const,
    style: styles.fill,
    contentContainerStyle: IS_IOS
      ? { paddingTop: space.sm, paddingBottom: space.xxxl, paddingHorizontal: GUTTER }
      : { paddingTop: insets.top + space.md, paddingBottom: clearance, paddingHorizontal: GUTTER },
    refreshControl: onRefresh ? (
      <RefreshControl
        refreshing={refresh.refreshing}
        onRefresh={refresh.onRefresh}
        tintColor={colors.lavender}
        colors={[colors.violet]}
        progressBackgroundColor={colors.surface}
        progressViewOffset={IS_IOS ? undefined : insets.top}
      />
    ) : undefined,
  };
}

/** Крупный заголовок в контенте — только Android (на iOS его рисует системная шапка). */
export function ScreenTitle({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  if (IS_IOS) return null;
  return (
    <View style={styles.title}>
      <View style={styles.titleText}>
        <Text style={type.title} accessibilityRole="header" numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

/** Колонка по центру — на планшетах контент не растягивается на всю ширину. */
export function Column({ children }: { children: ReactNode }) {
  return <View style={styles.column}>{children}</View>;
}

export function TabScroll({
  title, subtitle, right, onRefresh, children,
}: { title: string; subtitle?: string; right?: ReactNode; onRefresh?: () => Promise<unknown>; children: ReactNode }) {
  const scroll = useTabScrollProps(onRefresh);
  return (
    <ScrollView {...scroll}>
      <View style={styles.column}>
        <ScreenTitle title={title} subtitle={subtitle} right={right} />
        {children}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: 'transparent' },
  column: { width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center' },
  title: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginBottom: space.lg, minHeight: 44 },
  titleText: { flex: 1 },
  subtitle: { ...StyleSheet.flatten(type.caption), marginTop: 2 },
});
