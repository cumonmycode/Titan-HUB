// Уведомления — шторка по колокольчику на главной: операции по балансу, оплаты, статус,
// новости клуба. Открыли — непрочитанные помечаются прочитанными на сервере, но
// подсветка «новое» остаётся, пока шторка открыта, чтобы было видно, что именно пришло.
import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlassButton } from '@/components/glass';
import type { IconName } from '@/components/icon';
import { SheetHeader, useCloseSheet } from '@/components/sheet';
import { Tap } from '@/components/tap';
import { EmptyState, IconTile, Skeleton, Surface } from '@/components/ui';
import { errorText } from '@/lib/api';
import { relative } from '@/lib/format';
import { openFromNotificationData, setBadge } from '@/lib/push';
import { useMarkRead, useNotifications } from '@/lib/queries';
import { colors, GUTTER, MAX_WIDTH, radius, space, type } from '@/lib/theme';
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

/** Шторка успевает уехать, прежде чем откроется экран, на который ведёт уведомление. */
const CLOSE_DELAY_MS = 350;

export default function NotificationsScreen() {
  const insets = useSafeAreaInsets();
  const close = useCloseSheet();
  const list = useNotifications();
  const markRead = useMarkRead();
  // id, которые были непрочитанными при открытии шторки (подсветка до закрытия).
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const marked = useRef(false);

  const items = useMemo(() => list.data?.pages.flatMap((p) => p.items) ?? [], [list.data]);
  const unread = list.data?.pages[0]?.unread ?? 0;

  // Лента загрузилась — отмечаем прочитанным (один раз за открытие).
  const markVisible = useEffectEvent(() => {
    if (marked.current) return;
    marked.current = true;
    setFresh(new Set(items.filter((n) => !n.isRead).map((n) => n.id)));
    markRead.mutate(undefined, { onSuccess: () => void setBadge(0) });
  });
  useEffect(() => {
    if (unread > 0) markVisible();
  }, [unread]);

  const open = (n: ClientNotification) => {
    close();
    setTimeout(() => openFromNotificationData(n.meta), CLOSE_DELAY_MS);
  };

  return (
    <View style={styles.root}>
      <SheetHeader title="Уведомления" onClose={close} />
      <FlatList
        data={items}
        keyExtractor={(n) => n.id}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space.xxl }]}
        ListHeaderComponent={list.isLoading ? (
          <View style={[styles.column, styles.loading]}>
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} height={88} rounded={radius.tile} />)}
          </View>
        ) : null}
        renderItem={({ item }) => (
          <View style={[styles.column, styles.item]}>
            <NotificationCard n={item} highlighted={!item.isRead || fresh.has(item.id)} onOpen={open} />
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
    </View>
  );
}

function NotificationCard({ n, highlighted, onOpen }: { n: ClientNotification; highlighted: boolean; onOpen: (n: ClientNotification) => void }) {
  const look = LOOK[n.kind] ?? LOOK.system;
  const screen = typeof n.meta.screen === 'string' ? n.meta.screen : null;
  const actionable = !!screen && screen !== 'notifications';
  const body = (
    <Surface tone={highlighted ? colors.violet : undefined} style={styles.card}>
      <IconTile name={look.icon} color={look.color} size={42} />
      <View style={styles.texts}>
        <View style={[styles.titleRow, highlighted && styles.titleRowNew]}>
          <Text style={[type.headline, styles.flex]} numberOfLines={2}>{n.title}</Text>
          <Text style={styles.time}>{relative(n.createdAt)}</Text>
        </View>
        <Text style={styles.body}>{n.body}</Text>
      </View>
      {highlighted ? <View style={styles.dot} /> : null}
    </Surface>
  );
  if (!actionable) return body;
  return (
    <Tap onPress={() => onOpen(n)} scaleTo={0.98} accessibilityRole="button" accessibilityLabel={`${n.title}. ${n.body}`}>
      {body}
    </Tap>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  content: { paddingHorizontal: GUTTER },
  column: { width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center' },
  loading: { gap: space.md },
  item: { marginBottom: space.md },
  card: { flexDirection: 'row', gap: space.md, padding: space.lg, borderRadius: radius.tile },
  texts: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  titleRowNew: { paddingRight: space.md },
  time: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  body: { ...StyleSheet.flatten(type.callout), color: colors.textSecondary, marginTop: 3 },
  dot: { position: 'absolute', top: 14, right: 14, width: 8, height: 8, borderRadius: 4, backgroundColor: colors.pink },
  more: { marginVertical: space.lg },
});
