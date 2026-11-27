import { ContentUnavailableView, HStack, Image, List, ProgressView, Section, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import {
  background,
  font,
  foregroundStyle,
  frame,
  listStyle,
  refreshable,
  shapes,
} from '@expo/ui/swift-ui/modifiers';
import { Stack, useRouter, type Href } from 'expo-router';
import { useEffect } from 'react';

import { FormHost } from '@/components/native-form';
import { notificationLook, relativeTime } from '@/lib/notifications';
import { markAllNotificationsRead, useNotifications } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { useNow } from '@/lib/use-now';
import { ToolbarButton } from '@/components/toolbar';
import { colors } from '@/lib/theme';

const secondary = foregroundStyle({ type: 'hierarchical', style: 'secondary' });

/** Уведомления персонала: вызовы из кабинок, заказы, оплаты, смены. */
export default function NotificationsSheet() {
  const router = useRouter();
  const notifications = useNotifications();
  const now = useNow(60_000);
  const items = notifications.data ?? [];
  const unread = items.filter((n) => !n.isRead);
  const read = items.filter((n) => n.isRead);
  const host = useSession((s) => s.club?.host);

  // Как в вебе: центр уведомлений открыт чуть дольше секунды — всё прочитано.
  useEffect(() => {
    if (!host) return;
    const timer = setTimeout(() => void markAllNotificationsRead(host), 1200);
    return () => clearTimeout(timer);
  }, [host]);

  const openTarget = (meta: Record<string, unknown> | null | undefined) => {
    const url = meta?.['url'];
    // Диалог Tai с клиентом — прямо в переписку.
    if (typeof url === 'string' && url.startsWith('/tai-dialog')) {
      router.back();
      router.push(url as Href);
      return;
    }
    const checkId = meta?.['checkId'];
    if (typeof checkId !== 'string') return;
    router.back();
    router.push({ pathname: '/pos/[checkId]', params: { checkId } });
  };

  const renderRow = (n: (typeof items)[number]) => {
    const look = notificationLook(n.type);
    const count = typeof n.meta?.count === 'number' && n.meta.count > 1 ? ` ×${n.meta.count}` : '';
    return (
      <HStack key={n.id} spacing={12} alignment="top">
        <Image
          systemName={look.icon}
          size={15}
          color="white"
          modifiers={[frame({ width: 32, height: 32 }), background(look.color, shapes.circle())]}
          onPress={() => openTarget(n.meta)}
        />
        <VStack alignment="leading" spacing={2}>
          <HStack spacing={6}>
            <Text modifiers={[font({ textStyle: 'headline' })]}>{`${n.title}${count}`}</Text>
            <Spacer />
            <Text modifiers={[font({ textStyle: 'footnote' }), secondary]}>{relativeTime(n.createdAt, now)}</Text>
          </HStack>
          {!!n.body && <Text modifiers={[font({ textStyle: 'subheadline' }), secondary]}>{n.body}</Text>}
        </VStack>
      </HStack>
    );
  };

  return (
    <>
      <Stack.Toolbar placement="right">
        <ToolbarButton variant="done" tintColor={colors.accent} onPress={() => router.back()}>
          Готово
        </ToolbarButton>
      </Stack.Toolbar>
      <FormHost>
        {notifications.isLoading ? (
          <ProgressView />
        ) : items.length === 0 ? (
          <ContentUnavailableView
            title={notifications.isError ? 'Нет связи' : 'Уведомлений нет'}
            systemImage={notifications.isError ? 'wifi.exclamationmark' : 'bell.slash'}
            description={notifications.isError ? notifications.error.message : 'Здесь появятся вызовы из кабинок, заказы и оплаты.'}
          />
        ) : (
          <List
            modifiers={[
              listStyle('insetGrouped'),
              refreshable(async () => {
                await notifications.refetch();
              }),
            ]}>
            {unread.length > 0 && <Section title="Новые">{unread.map(renderRow)}</Section>}
            {read.length > 0 && <Section title="Прочитанные">{read.map(renderRow)}</Section>}
          </List>
        )}
      </FormHost>
    </>
  );
}
