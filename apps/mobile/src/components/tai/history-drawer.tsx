import { SymbolView } from 'expo-symbols';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useDebounced } from '@/components/player-picker';
import { Text, TextInput } from '@/components/text';
import { promptText } from '@/lib/dialog';
import { haptic } from '@/lib/haptics';
import { deleteTaiChat, renameTaiChat, useTaiChats, type TaiChatSummary } from '@/lib/tai-api';
import { refreshTaiChats } from '@/lib/tai-store';
import { colors, space, springs, type } from '@/lib/theme';

const PANEL_MAX = 340;
const PANEL_SHARE = 0.84;
const CLOSE_DRAG = 60;
const DAY_MS = 86_400_000;

type Group = { title: string; chats: TaiChatSummary[] };

/** Чаты по давности, как в Gemini: Сегодня, Вчера, 7 дней, 30 дней, Раньше. */
function groupByDate(chats: TaiChatSummary[]): Group[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = today.getTime();
  const buckets: Group[] = [
    { title: 'Сегодня', chats: [] },
    { title: 'Вчера', chats: [] },
    { title: 'Последние 7 дней', chats: [] },
    { title: 'Последние 30 дней', chats: [] },
    { title: 'Раньше', chats: [] },
  ];
  for (const chat of chats) {
    const at = new Date(chat.updatedAt).getTime();
    const index = at >= start ? 0 : at >= start - DAY_MS ? 1 : at >= start - 7 * DAY_MS ? 2 : at >= start - 30 * DAY_MS ? 3 : 4;
    buckets[index]!.chats.push(chat);
  }
  return buckets.filter((b) => b.chats.length > 0);
}

/**
 * Шторка истории слева: поиск, «Новый чат», чаты по давности. Долгое нажатие —
 * переименовать или удалить. Закрывается тапом по затемнению или свайпом влево.
 */
export function TaiHistoryDrawer({
  open,
  activeId,
  onClose,
  onOpenChat,
  onNewChat,
  onSettings,
}: {
  open: boolean;
  activeId: string | null;
  onClose: () => void;
  onOpenChat: (id: string) => void;
  onNewChat: () => void;
  /** Настройки Tai (владельцу) — внизу шторки. */
  onSettings?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { width: screen } = useWindowDimensions();
  const width = Math.min(PANEL_MAX, Math.round(screen * PANEL_SHARE));
  const [query, setQuery] = useState('');
  const search = useDebounced(query, 250);
  const chats = useTaiChats(search, open);
  const groups = useMemo(() => groupByDate(chats.data ?? []), [chats.data]);

  // Шторка всегда в дереве: закрытая уехала за левый край и не ловит касания.
  const shift = useSharedValue(-width);
  useEffect(() => {
    shift.set(open ? withSpring(0, springs.smooth) : withTiming(-width, { duration: 220 }));
  }, [open, shift, width]);

  const drag = Gesture.Pan()
    .activeOffsetX([-12, 12])
    .onUpdate((e) => {
      shift.set(Math.min(0, e.translationX));
    })
    .onEnd((e) => {
      if (e.translationX < -CLOSE_DRAG || e.velocityX < -600) runOnJS(onClose)();
      else shift.set(withSpring(0, springs.snappy));
    });

  const panel = useAnimatedStyle(() => ({ transform: [{ translateX: shift.get() }] }));
  const scrim = useAnimatedStyle(() => ({ opacity: Math.max(0, 1 + shift.get() / width) }));

  const rename = (chat: TaiChatSummary) =>
    promptText(
      'Название чата',
      undefined,
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Сохранить',
          onPress: (value) => {
            const title = value?.trim();
            if (title) void renameTaiChat(chat.id, title).then(refreshTaiChats, () => haptic.error());
          },
        },
      ],
      'plain-text',
      chat.title,
    );

  const remove = (chat: TaiChatSummary) =>
    Alert.alert('Удалить чат?', 'Переписка с Tai удалится со всех ваших устройств.', [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Удалить',
        style: 'destructive',
        onPress: () =>
          void deleteTaiChat(chat.id).then(
            () => {
              haptic.success();
              refreshTaiChats();
              if (chat.id === activeId) onNewChat();
            },
            () => haptic.error(),
          ),
      },
    ]);

  const manage = (chat: TaiChatSummary) => {
    haptic.medium();
    Alert.alert(chat.title, undefined, [
      { text: 'Переименовать', onPress: () => rename(chat) },
      { text: 'Удалить', style: 'destructive', onPress: () => remove(chat) },
      { text: 'Отмена', style: 'cancel' },
    ]);
  };

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents={open ? 'auto' : 'none'}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, scrim]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel="Закрыть историю" />
      </Animated.View>
      <GestureDetector gesture={drag}>
        <Animated.View style={[styles.panel, { width, paddingTop: insets.top + space.sm, paddingBottom: Math.max(insets.bottom, space.md) }, panel]}>
          <View style={styles.search}>
            <SymbolView name="magnifyingglass" size={16} tintColor={colors.secondaryLabel} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Поиск по чатам"
              placeholderTextColor={colors.tertiaryLabel}
              selectionColor={colors.accent}
              style={[type.body, styles.searchInput]}
              returnKeyType="search"
              accessibilityLabel="Поиск по чатам"
            />
          </View>

          <Pressable
            onPress={() => {
              haptic.light();
              onNewChat();
            }}
            style={({ pressed }) => [styles.row, styles.newChat, pressed && styles.pressed]}
            accessibilityRole="button"
          >
            <SymbolView name="square.and.pencil" size={18} tintColor={colors.label} />
            <Text style={[type.headline, styles.label]}>Новый чат</Text>
          </Pressable>

          <ScrollView style={styles.flex} contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {chats.isLoading ? (
              <ActivityIndicator style={styles.loading} />
            ) : groups.length === 0 ? (
              <Text style={[type.subhead, styles.secondary, styles.empty]}>{search ? 'Ничего не нашлось.' : 'Здесь появятся ваши чаты с Tai.'}</Text>
            ) : (
              groups.map((group) => (
                <View key={group.title} style={styles.group}>
                  <Text style={[type.footnote, styles.groupTitle]}>{group.title}</Text>
                  {group.chats.map((chat) => {
                    const active = chat.id === activeId;
                    return (
                      <Pressable
                        key={chat.id}
                        onPress={() => {
                          haptic.selection();
                          onOpenChat(chat.id);
                        }}
                        onLongPress={() => manage(chat)}
                        style={({ pressed }) => [styles.row, active && styles.active, pressed && styles.pressed]}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                        accessibilityHint="Долгое нажатие — переименовать или удалить"
                      >
                        <Text style={[type.body, styles.label, active && styles.bold]} numberOfLines={1}>
                          {chat.title}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              ))
            )}
          </ScrollView>

          {onSettings ? (
            <Pressable onPress={onSettings} style={({ pressed }) => [styles.row, styles.settings, pressed && styles.pressed]} accessibilityRole="button">
              <SymbolView name="gearshape" size={18} tintColor={colors.secondaryLabel} />
              <Text style={[type.body, styles.secondary]}>Настройки Tai</Text>
            </Pressable>
          ) : null}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: { backgroundColor: 'rgba(0,0,0,0.32)' },
  panel: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: colors.groupedBackground,
    paddingHorizontal: space.md,
    borderTopRightRadius: 28,
    borderBottomRightRadius: 28,
    borderCurve: 'continuous',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 24,
    shadowOffset: { width: 6, height: 0 },
  },
  flex: { flex: 1 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: colors.fill,
    borderRadius: 14,
    borderCurve: 'continuous',
    paddingHorizontal: space.md,
    minHeight: 40,
    marginHorizontal: space.xs,
  },
  searchInput: { flex: 1, color: colors.label, paddingVertical: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 44, paddingHorizontal: space.md, borderRadius: 12, borderCurve: 'continuous' },
  newChat: { marginTop: space.md, marginBottom: space.xs },
  list: { paddingBottom: space.lg },
  group: { marginTop: space.md },
  groupTitle: { color: colors.secondaryLabel, fontWeight: '600', paddingHorizontal: space.md, marginBottom: 2 },
  active: { backgroundColor: colors.fill },
  pressed: { opacity: 0.6 },
  settings: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator, borderRadius: 0, marginTop: space.xs },
  loading: { marginTop: space.xxl },
  empty: { paddingHorizontal: space.md, marginTop: space.xl },
  label: { color: colors.label, flexShrink: 1 },
  secondary: { color: colors.secondaryLabel },
  bold: { fontWeight: '600' },
});
