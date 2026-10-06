// «История» — все операции: деньги и бонусы, по дням, с догрузкой при прокрутке.
// Каждый день — своя стеклянная группа (как секции системных списков iOS 26).
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';

import { FEED_ROW_INSET, FeedRow } from '@/components/feed-row';
import { GlassButton } from '@/components/glass';
import { ScreenTitle, useTabScrollProps } from '@/components/screen';
import { Segmented } from '@/components/segmented';
import { Divider, EmptyState, Skeleton, Surface } from '@/components/ui';
import { errorText } from '@/lib/api';
import { dayKey, dayTitle } from '@/lib/format';
import { type FeedKind, useFeed } from '@/lib/queries';
import { colors, MAX_WIDTH, radius, space, type } from '@/lib/theme';
import type { FeedItem } from '@/lib/types';

const FILTERS: { key: FeedKind; label: string }[] = [
  { key: 'all', label: 'Все' },
  { key: 'money', label: 'Деньги' },
  { key: 'bonus', label: 'Бонусы' },
];

interface Day { key: string; title: string; items: FeedItem[] }

function groupByDay(pages: { items: FeedItem[] }[] | undefined): Day[] {
  const days: Day[] = [];
  for (const page of pages ?? []) {
    for (const item of page.items) {
      const k = dayKey(item.createdAt);
      const last = days[days.length - 1];
      if (last && last.key === k) days[days.length - 1] = { ...last, items: [...last.items, item] };
      else days.push({ key: k, title: dayTitle(item.createdAt), items: [item] });
    }
  }
  return days;
}

export default function HistoryScreen() {
  const router = useRouter();
  const [kind, setKind] = useState<FeedKind>('all');
  const feed = useFeed(kind);
  const scroll = useTabScrollProps(() => feed.refetch());
  const days = useMemo(() => groupByDay(feed.data?.pages), [feed.data]);
  const openCheck = (id: string) => router.push({ pathname: '/check/[id]', params: { id } });

  return (
    <FlatList
      {...scroll}
      data={days}
      keyExtractor={(d) => d.key}
      ListHeaderComponent={
        <View style={styles.column}>
          <ScreenTitle title="История" subtitle="Оплаты, пополнения и бонусы" />
          <Segmented options={FILTERS} value={kind} onChange={setKind} />
          {feed.isLoading ? (
            <View style={styles.loading}>
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} height={58} rounded={radius.row} />)}
            </View>
          ) : null}
        </View>
      }
      renderItem={({ item: day }) => (
        <View style={[styles.column, styles.day]}>
          <Text style={styles.dayTitle} accessibilityRole="header">{day.title}</Text>
          <Surface style={styles.group}>
            {day.items.map((it, i) => (
              <View key={it.id}>
                {i > 0 ? <Divider inset={FEED_ROW_INSET} /> : null}
                <FeedRow item={it} onOpenCheck={openCheck} />
              </View>
            ))}
          </Surface>
        </View>
      )}
      onEndReachedThreshold={0.4}
      onEndReached={() => { if (feed.hasNextPage && !feed.isFetchingNextPage) void feed.fetchNextPage(); }}
      ListEmptyComponent={
        feed.isLoading ? null : feed.isError ? (
          <EmptyState icon="offline" title="Не удалось загрузить" text={errorText(feed.error)}>
            <GlassButton title="Повторить" variant="secondary" onPress={() => void feed.refetch()} />
          </EmptyState>
        ) : (
          <EmptyState
            icon={kind === 'bonus' ? 'bonus' : 'receipt'}
            title={kind === 'bonus' ? 'Бонусов пока нет' : 'Операций пока нет'}
            text="Всё, что происходит с вашим балансом в клубе, появится здесь"
          />
        )
      }
      ListFooterComponent={feed.isFetchingNextPage ? <ActivityIndicator color={colors.lavender} style={styles.more} /> : null}
    />
  );
}

const styles = StyleSheet.create({
  column: { width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center' },
  loading: { gap: space.md, marginTop: space.xl },
  day: { marginTop: space.xl },
  dayTitle: { ...StyleSheet.flatten(type.overline), marginBottom: space.sm, marginLeft: space.lg },
  group: { borderRadius: radius.card, overflow: 'hidden' },
  more: { marginVertical: space.lg },
});
