import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Text } from '@/components/text';
import { AmbientBackdrop } from '@/components/ambient-backdrop';
import { CheckView } from '@/components/check-view';
import { ToolbarButton, ToolbarMenu, ToolbarMenuAction } from '@/components/toolbar';
import { checkTitle, checkTotals } from '@/lib/checks';
import { usePosPlayer } from '@/lib/payment';
import { markCheckNotificationsRead, useCheck } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { useHeaderClearance } from '@/lib/layout';
import { useTabBarClearance } from '@/lib/tab-bar';
import { colors, space, type } from '@/lib/theme';
import { useCheckActions } from '@/lib/use-check-actions';
import { useNow } from '@/lib/use-now';

/**
 * Экран чека на iPhone — стеклянные карточки на фирменном фоне, как сетка кассы.
 * «Добавить» и «Оплатить» — в плашке над таб-баром (components/check-accessory.tsx).
 * На iPad чек открывается в правой панели кассы.
 */
export default function CheckScreen() {
  const { checkId } = useLocalSearchParams<{ checkId: string }>();
  const router = useRouter();
  const check = useCheck(checkId);
  const now = useNow(5_000);
  const host = useSession((s) => s.club?.host);
  const data = check.data;
  const spaceId = data?.spaceId ?? null;
  const actions = useCheckActions(checkId, data?.guestNames ?? []);
  const player = usePosPlayer(data?.playerId ?? null);
  // Android: кнопки «Добавить / Оплатить» плывут над панелью вкладок — чек не должен под ними прятаться.
  const tabBarClearance = useTabBarClearance(true);
  const headerTop = useHeaderClearance();

  useEffect(() => {
    if (host && checkId) void markCheckNotificationsRead(host, { id: checkId, spaceId });
  }, [host, checkId, spaceId]);

  // В меню — только то, чего нет на экране: клиенты открываются тапом по карточке клиента,
  // позиции и возврат — кнопками в плашке над таб-баром.
  const isOpen = data?.status === 'open';
  const hasMenu = !!data && (isOpen || !!spaceId);

  return (
    <AmbientBackdrop style={styles.screen}>
      <Stack.Title>{data ? checkTitle(data) : 'Чек'}</Stack.Title>
      {(hasMenu || isOpen) && (
        <Stack.Toolbar placement="right">
          {/* Tai знает этот чек: «добавь колу» — сюда. */}
          {isOpen && (
            <ToolbarButton icon="sparkles" accessibilityLabel="Спросить Tai" onPress={() => router.push({ pathname: '/tai', params: { screen: 'check', checkId } })} />
          )}
          {hasMenu && (
          <ToolbarMenu icon="ellipsis" accessibilityLabel="Действия с чеком">
            {/* Чат идёт через планшет кабинки — у чека без зоны его нет. */}
            {spaceId && (
              <ToolbarMenuAction icon="bubble.left" onPress={() => router.push({ pathname: '/chat', params: { checkId } })}>
                Чат с кабинкой
              </ToolbarMenuAction>
            )}
            {/* Каждый пункт — прямым ребёнком, без фрагмента: на iOS expo-router берёт пункты
                через Children.toArray с фильтром по типу, и фрагмент выпадает целиком —
                меню оставалось пустым и не открывалось. */}
            {isOpen && (
              <ToolbarMenuAction icon="percent" onPress={actions.onAddDiscount}>
                Скидка
              </ToolbarMenuAction>
            )}
            {isOpen && (
              <ToolbarMenuAction icon="xmark.circle" destructive onPress={actions.onCancel}>
                Отменить чек
              </ToolbarMenuAction>
            )}
          </ToolbarMenu>
          )}
        </Stack.Toolbar>
      )}

      {data ? (
        <CheckView
          check={data}
          totals={checkTotals(data, now)}
          actions={actions}
          player={player.data}
          now={now}
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={[
            tabBarClearance > 0 && { paddingBottom: tabBarClearance + space.lg },
            headerTop > 0 && { paddingTop: headerTop },
          ]}
        />
      ) : (
        <View style={styles.state}>
          {check.isError ? (
            <>
              <SymbolView name="exclamationmark.triangle" size={40} tintColor={colors.secondaryLabel} />
              <Text style={[type.body, styles.stateText]}>{check.error.message}</Text>
            </>
          ) : (
            <ActivityIndicator />
          )}
        </View>
      )}
    </AmbientBackdrop>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.groupedBackground },
  state: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md, padding: space.xxl },
  stateText: { color: colors.secondaryLabel, textAlign: 'center' },
});
