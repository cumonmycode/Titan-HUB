// «Входящие» — лента уведомлений: операции по балансу, оплаты, статус, новости клуба.
// Открыли экран — непрочитанные помечаются прочитанными на сервере, но подсветка
// «новое» остаётся до ухода с экрана, чтобы было видно, что именно пришло.
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';

import { Glass, GlassButton } from '@/components/glass';
import type { IconName } from '@/components/icon';
import { ScreenTitle, useTabScrollProps } from '@/components/screen';
import { Tap } from '@/components/tap';
import { EmptyState, IconTile, Skeleton } from '@/components/ui';
import { errorText } from '@/lib/api';
import { relative } from '@/lib/format';
import { openFromNotificationData, setBadge } from '@/lib/push';
import { useMarkRead, useNotifications } from '@/lib/queries';
import { colors, MAX_WIDTH, radius, space, type } from '@/lib/theme';
import type { ClientNotification, NotificationKind } from '@/lib/types';

const LOOK: Record<NotificationKind, { icon: IconName; color: string }> = {
  bonus: { icon: 'bonus', color: colors.gold },
  deposit: { icon: 'deposit', color: colors.green },
  debt: { icon: 'alert', color: colors.red },
  payment: { icon: 'paid', color: colors.greenBright },
  tier: { icon: 'trophy', color: colors.violetLight },
  fund: { icon: 'fund', color: colors.cyan },
  news: { icon: 'news', color: colors.pink },
  system: { icon: 'inbox', color: colors.violetLight },
};

export default function InboxScreen() {
  const list = useNotifications();
  const markRead = useMarkRead();
  const scroll = useTabScrollProps(() => list.refetch());
  // id, которые были непрочитанными при входе на экран (подсветка до ухода).
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [focused, setFocused] = useState(false);
  const marked = useRef(false);

  const items = useMemo(() => list.data?.pages.flatMap((p) => p.items) ?? [], [list.data]);
  const unread = list.data?.pages[0]?.unread ?? 0;

  useFocusEffect(useCallback(() => {
    setFocused(true);
    return () => {
      setFocused(false);
      setFresh(new Set());
      marked.current = false;
    };
  }, []));

  // Лента загрузилась на открытом экране — отмечаем прочитанным (один раз за визит).
  const markVisible = useEffectEvent(() => {
    if (marked.current) return;
    marked.current = true;
    setFresh(new Set(items.filter((n) => !n.isRead).map((n) => n.id)));
    markRead.mutate(undefined, { onSuccess: () => void setBadge(0) });
  });
  useEffect(() => {
    if (focused && unread > 0) markVisible();
  }, [focused, unread]);

  return (
    <FlatList
      {...scroll}
      data={items}
      keyExtractor={(n) => n.id}
      ListHeaderComponent={
        <View style={styles.column}>
          <ScreenTitle title="Входящие" subtitle="Операции, оплаты и новости клуба" />
          {list.isLoading ? (
            <View style={styles.loading}>{[0, 1, 2, 3].map((i) => <Skeleton key={i} height={88} rounded={radius.tile} />)}</View>
          ) : null}
        </View>
      }
      renderItem={({ item }) => (
        <View style={[styles.column, styles.item]}>
          <NotificationCard n={item} highlighted={!item.isRead || fresh.has(item.id)} />
        </View>
      )}
      onEndReachedThreshold={0.4}
      onEndReached={() => { if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage(); }}
      ListEmptyComponent={
        list.isLoading ? null : list.isError ? (
          <EmptyState icon="offline" title="Не удалось загрузить" text={errorText(list.error)}>
            <GlassButton title="Повторить" variant="secondary" onPress={() => void list.refetch()} />
          </EmptyState>
        ) : (
          <EmptyState icon="bell" title="Пока тихо" text="Здесь появятся начисления бонусов, оплаты и новости клуба" />
        )
      }
      ListFooterComponent={list.isFetchingNextPage ? <ActivityIndicator color={colors.lavender} style={styles.more} /> : null}
    />
  );
}

function NotificationCard({ n, highlighted }: { n: ClientNotification; highlighted: boolean }) {
  const look = LOOK[n.kind] ?? LOOK.system;
  const screen = typeof n.meta.screen === 'string' ? n.meta.screen : null;
  const actionable = !!screen && screen !== 'notifications';
  const body = (
    <Glass
      interactive={actionable}
      tint={highlighted ? 'rgba(139,92,246,0.22)' : undefined}
      fallback={highlighted ? styles.cardNewFallback : null}
      style={styles.card}
    >
      <IconTile name={look.icon} color={look.color} size={42} />
      <View style={styles.texts}>
        <View style={[styles.titleRow, highlighted && styles.titleRowNew]}>
          <Text style={[type.headline, styles.flex]} numberOfLines={2}>{n.title}</Text>
          <Text style={styles.time}>{relative(n.createdAt)}</Text>
        </View>
        <Text style={styles.body}>{n.body}</Text>
      </View>
      {highlighted ? <View style={styles.dot} /> : null}
    </Glass>
  );
  if (!actionable) return body;
  return (
    <Tap onPress={() => openFromNotificationData(n.meta)} scaleTo={0.98} accessibilityRole="button" accessibilityLabel={`${n.title}. ${n.body}`}>
      {body}
    </Tap>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  column: { width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center' },
  loading: { gap: space.md },
  item: { marginBottom: space.md },
  card: { flexDirection: 'row', gap: space.md, padding: space.lg, borderRadius: radius.tile },
  cardNewFallback: { borderColor: colors.borderViolet, backgroundColor: 'rgba(43,33,61,0.9)' },
  texts: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  titleRowNew: { paddingRight: space.md },
  time: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  body: { ...StyleSheet.flatten(type.callout), color: colors.textSecondary, marginTop: 3 },
  dot: { position: 'absolute', top: 14, right: 14, width: 8, height: 8, borderRadius: 4, backgroundColor: colors.pink },
  more: { marginVertical: space.lg },
});
