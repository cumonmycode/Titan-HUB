import { Button, ContentUnavailableView, Host, Menu } from '@expo/ui/swift-ui';
import { buttonStyle, controlSize } from '@expo/ui/swift-ui/modifiers';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Animated, { withSpring, withTiming, type EntryExitAnimationFunction } from 'react-native-reanimated';

import { Text } from '@/components/text';
import { CheckView } from '@/components/check-view';
import { checkTitle, checkTotals } from '@/lib/checks';
import { formatMoney } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { payTotals, usePosPlayer } from '@/lib/payment';
import { markCheckNotificationsRead, useCheck } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { colors, space, type, useAccentHex } from '@/lib/theme';
import { useCheckActions } from '@/lib/use-check-actions';
import { useNow } from '@/lib/use-now';

/** Открытый чек появляется зумом, прежний уменьшается и растворяется — как зум-переход на iPhone. */
const panelEntering: EntryExitAnimationFunction = () => {
  'worklet';
  return {
    initialValues: { opacity: 0, transform: [{ scale: 0.9 }] },
    animations: {
      opacity: withTiming(1, { duration: 200 }),
      transform: [{ scale: withSpring(1, { damping: 20, stiffness: 230 }) }],
    },
  };
};

const panelExiting: EntryExitAnimationFunction = () => {
  'worklet';
  return {
    initialValues: { opacity: 1, transform: [{ scale: 1 }] },
    animations: {
      opacity: withTiming(0, { duration: 170 }),
      transform: [{ scale: withTiming(0.92, { duration: 170 }) }],
    },
  };
};

/**
 * Правая панель кассы на iPad: выбранный чек рядом с сеткой, как сплит в веб-кассе.
 * Карточки чека — то же стекло на общем фирменном фоне, что и сетка слева.
 */
export function CheckPanel({ checkId }: { checkId: string | null }) {
  return (
    <View style={styles.panel}>
      <Animated.View key={checkId ?? 'empty'} entering={panelEntering} exiting={panelExiting} style={styles.layer}>
        {checkId ? (
          <SelectedCheck checkId={checkId} />
        ) : (
          <Host style={styles.flex} useViewportSizeMeasurement>
            <ContentUnavailableView title="Выберите чек" systemImage="doc.text" description="Нажмите на карточку слева — чек откроется здесь." />
          </Host>
        )}
      </Animated.View>
    </View>
  );
}

function SelectedCheck({ checkId }: { checkId: string }) {
  const router = useRouter();
  const accent = useAccentHex();
  const check = useCheck(checkId);
  const now = useNow(5_000);
  const host = useSession((s) => s.club?.host);
  const data = check.data;
  const spaceId = data?.spaceId ?? null;
  const actions = useCheckActions(checkId, data?.guestNames ?? []);
  const player = usePosPlayer(data?.playerId ?? null);

  useEffect(() => {
    if (host) void markCheckNotificationsRead(host, { id: checkId, spaceId });
  }, [host, checkId, spaceId]);

  if (!data) {
    return (
      <View style={styles.state}>
        {check.isError ? (
          <Host style={styles.flex} useViewportSizeMeasurement>
            <ContentUnavailableView title="Чек не открылся" systemImage="exclamationmark.triangle" description={check.error.message} />
          </Host>
        ) : (
          <ActivityIndicator />
        )}
      </View>
    );
  }

  const due = payTotals(data, now).due;
  const isOpen = data.status === 'open';
  const isClosed = data.status === 'closed';
  // Как на iPhone: в меню — только то, чего нет на экране (клиенты — тап по карточке,
  // позиции, оплата и возврат — кнопками под чеком).
  const hasMenu = isOpen || !!data.spaceId;

  return (
    <View style={styles.flex}>
      <View style={styles.header}>
        <Text style={[type.title2, styles.title]} numberOfLines={1}>
          {checkTitle(data)}
        </Text>
        {hasMenu && (
          <Host matchContents>
            <Menu label="Действия" systemImage="ellipsis.circle">
              {/* Чат идёт через планшет кабинки — у чека без зоны его нет. */}
              {data.spaceId && <Button label="Чат с кабинкой" systemImage="bubble.left" onPress={() => router.push({ pathname: '/chat', params: { checkId } })} />}
              {isOpen && (
                <>
                  <Button label="Спросить Tai" systemImage="sparkles" onPress={() => router.push({ pathname: '/tai', params: { screen: 'check', checkId } })} />
                  <Button label="Скидка" systemImage="percent" onPress={actions.onAddDiscount} />
                  <Button label="Отменить чек" systemImage="xmark.circle" role="destructive" onPress={actions.onCancel} />
                </>
              )}
            </Menu>
          </Host>
        )}
      </View>

      <CheckView
        check={data}
        totals={checkTotals(data, now)}
        actions={actions}
        player={player.data}
        now={now}
        contentContainerStyle={styles.panelContent}
      />

      {isOpen && (
        <View style={styles.actions}>
          <Host matchContents>
            <Button label="Добавить" systemImage="plus" onPress={actions.onAddItems} modifiers={[buttonStyle('glass'), controlSize('large')]} />
          </Host>
          <View style={styles.flex} />
          <Host matchContents seedColor={accent}>
            <Button
              label={due > 0 ? `Оплатить ${formatMoney(due, { kopecks: 'auto' })}` : 'Закрыть чек'}
              onPress={() => {
                haptic.medium();
                router.push({ pathname: '/pay', params: { checkId } });
              }}
              modifiers={[buttonStyle('glassProminent'), controlSize('large')]}
            />
          </Host>
        </View>
      )}
      {isClosed && (
        <View style={styles.actions}>
          <View style={styles.flex} />
          <Host matchContents>
            <Button
              label="Возврат"
              systemImage="arrow.uturn.backward"
              role="destructive"
              onPress={() => {
                haptic.light();
                router.push({ pathname: '/pos/refund', params: { checkId } });
              }}
              modifiers={[buttonStyle('glass'), controlSize('large')]}
            />
          </Host>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { flex: 1 },
  layer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  flex: { flex: 1 },
  state: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    paddingBottom: space.xs,
  },
  title: { flex: 1, color: colors.label },
  panelContent: { paddingBottom: space.xl },
  actions: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.lg, paddingVertical: space.md, gap: space.md },
});
