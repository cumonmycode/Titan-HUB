import { useMutation, useQuery } from '@tanstack/react-query';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { HeaderHeightContext } from 'expo-router/react-navigation';
import { SymbolView } from 'expo-symbols';
import { type ComponentRef, useCallback, useContext, useEffect, useEffectEvent, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, useColorScheme, useWindowDimensions, View } from 'react-native';
import { KeyboardChatScrollView, KeyboardStickyView } from 'react-native-keyboard-controller';
import Animated, { FadeIn, FadeInDown, FadeOut, ZoomIn, ZoomOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text, TextInput } from '@/components/text';
import { AmbientBackdrop } from '@/components/ambient-backdrop';
import { GlassView } from '@/components/glass';
import { ToolbarButton } from '@/components/toolbar';
import { api } from '@/lib/api';
import { type ChatMessage, chatRows, QUICK_REPLIES, useOpenChat } from '@/lib/chat';
import { checkTitle, checkTotals } from '@/lib/checks';
import { formatMoney, formatTime } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { KEYBOARD_DISMISS, useHeaderClearance } from '@/lib/layout';
import { useSpaces } from '@/lib/pos-api';
import { queryClient } from '@/lib/query';
import { markCheckNotificationsRead, useCheck, useClubKey } from '@/lib/queries';
import { FONT_SCALE_MAX } from '@/lib/text-scale';
import { colors, space, type } from '@/lib/theme';
import { useNow } from '@/lib/use-now';

/** Сервер присвоил отправленному свой id — пузырь сохраняет прежний ключ и не появляется заново. */
const aliases = new Map<string, string>();

/**
 * Id неотправленного пузыря — уникален на всё время работы приложения: неотправленные
 * («failed») живут в кэше и после повторного открытия чата, и счётчик экрана с нуля
 * совпадал бы с ними (дубли ключей, замена чужого пузыря).
 */
let localSeq = 0;
const nextLocalId = () => `local-${Date.now().toString(36)}-${++localSeq}`;

/**
 * Чат с гостем в кабинке — полный экран, как мессенджер. Гость пишет с планшета
 * Titan Home, ответ появляется у него на экране.
 *
 * Клавиатуру ведёт react-native-keyboard-controller: лента (KeyboardChatScrollView)
 * и поле ввода (KeyboardStickyView) двигаются вместе с ней кадр в кадр, без пересчёта
 * раскладки — раньше чат был шторкой с двумя высотами, и клавиатура её дёргала.
 */
export default function ChatScreen() {
  const { checkId } = useLocalSearchParams<{ checkId: string }>();
  const router = useRouter();
  const host = useClubKey();
  const insets = useSafeAreaInsets();
  const headerHeight = useContext(HeaderHeightContext) ?? 0;
  const headerClearance = useHeaderClearance();
  const now = useNow(30_000);
  const check = useCheck(checkId);
  const spaces = useSpaces();
  const [text, setText] = useState('');

  const queryKey = [host, 'pos', 'chat', checkId];
  const chat = useQuery({
    queryKey,
    queryFn: async () => {
      const { messages } = await api.get<{ messages: ChatMessage[] }>(`/pos/checks/${checkId}/chat`);
      // Неотправленные с телефона не теряем при перезапросе (SSE, возврат в приложение),
      // а уже дошедшие до сервера — не дублируем.
      const unclaimed = messages.filter((m) => m.sender === 'staff' && !aliases.has(m.id));
      const local = (queryClient.getQueryData<ChatMessage[]>(queryKey) ?? []).filter((m) => {
        if (!m.local) return false;
        if (m.local === 'failed') return true;
        const index = unclaimed.findIndex((s) => s.text === m.text && Date.parse(s.createdAt) >= Date.parse(m.createdAt) - 10_000);
        if (index === -1) return true;
        aliases.set(unclaimed[index]!.id, m.id);
        unclaimed.splice(index, 1);
        return false;
      });
      return [...messages, ...local];
    },
    refetchInterval: 20_000,
  });

  // Пока чат на экране, его сообщения не всплывают баннером и уведомлением.
  useFocusEffect(
    useCallback(() => {
      useOpenChat.setState({ checkId });
      return () => {
        if (useOpenChat.getState().checkId === checkId) useOpenChat.setState({ checkId: null });
      };
    }, [checkId]),
  );

  const messages = chat.data ?? [];
  const lastGuestId = messages.findLast((m) => m.sender === 'guest')?.id ?? null;
  const spaceId = check.data?.spaceId ?? null;

  // Гость видит «прочитано», колокольчик и вызовы гаснут — и «звонок» не уйдёт.
  useEffect(() => {
    if (!host || !checkId) return;
    void api.post(`/pos/checks/${checkId}/chat/read`, { as: 'staff' }).catch(() => {});
    void markCheckNotificationsRead(host, { id: checkId, spaceId });
  }, [host, checkId, spaceId, lastGuestId]);

  // Лента: держим конец переписки в кадре, пока сотрудник не ушёл читать старое.
  const scroller = useRef<ComponentRef<typeof KeyboardChatScrollView>>(null);
  const atEnd = useRef(true);
  const stickToEnd = useRef(false);
  const positioned = useRef(false);
  const [ready, setReady] = useState(false);
  const [away, setAway] = useState(false);
  const [composerTop, setComposerTop] = useState(0);
  // Android: scrollToEnd не знает про отступ клавиатуры (библиотека добавляет его «сбоку») — считаем сами.
  const metrics = useRef({ content: 0, layout: 0, inset: 0 });
  const scrollToBottom = (animated: boolean) => {
    if (Platform.OS === 'ios') {
      scroller.current?.scrollToEnd({ animated });
      return;
    }
    const { content, layout, inset } = metrics.current;
    scroller.current?.scrollTo({ y: Math.max(0, content - layout + inset), animated });
  };
  const dark = useColorScheme() === 'dark';

  const send = useMutation({
    mutationFn: ({ message }: { message: string; localId: string }) =>
      api.post<{ message: ChatMessage }>(`/pos/checks/${checkId}/chat`, { text: message, from: 'staff' }).then((r) => r.message),
    onMutate: ({ message, localId }) => {
      haptic.light();
      stickToEnd.current = true;
      queryClient.setQueryData<ChatMessage[]>(queryKey, (old) => [
        ...(old ?? []).filter((m) => m.id !== localId),
        { id: localId, checkId, sender: 'staff', text: message, readAt: null, createdAt: new Date().toISOString(), local: 'sending' },
      ]);
    },
    onSuccess: (message, { localId }) => {
      aliases.set(message.id, localId);
      queryClient.setQueryData<ChatMessage[]>(queryKey, (old) => {
        const rest = (old ?? []).filter((m) => m.id !== localId && m.id !== message.id);
        return [...rest, message].sort((a, b) => Number(!!a.local) - Number(!!b.local) || a.createdAt.localeCompare(b.createdAt));
      });
    },
    onError: (error, { localId }) => {
      haptic.error();
      queryClient.setQueryData<ChatMessage[]>(queryKey, (old) => (old ?? []).map((m) => (m.id === localId ? { ...m, local: 'failed' } : m)));
      if (error.message === 'Check not open') Alert.alert('Сообщение не отправлено', 'Чек уже закрыт.');
    },
  });

  const submit = (value: string) => {
    const message = value.trim();
    if (!message) return;
    setText('');
    send.mutate({ message, localId: nextLocalId() });
  };

  const retry = (message: ChatMessage) => {
    haptic.selection();
    send.mutate({ message: message.text, localId: message.id });
  };

  // Страховка: если размер ленты не изменился (пустой чат), всё равно показываем её.
  const onRevealTimeout = useEffectEvent(() => {
    positioned.current = true;
    scrollToBottom(false);
    setReady(true);
  });
  useEffect(() => {
    if (chat.data === undefined || ready) return;
    const timer = setTimeout(onRevealTimeout, 500);
    return () => clearTimeout(timer);
  }, [chat.data, ready]);

  const onContentSizeChange = (_width: number, height: number) => {
    metrics.current.content = height;
    if (!positioned.current) {
      // Ждём и данные, и высоту поля ввода: от неё зависит, где у ленты конец.
      if (chat.data === undefined || composerTop === 0) return;
      positioned.current = true;
      scrollToBottom(false);
      requestAnimationFrame(() => setReady(true));
      return;
    }
    if (atEnd.current || stickToEnd.current) {
      stickToEnd.current = false;
      scrollToBottom(true);
    }
  };

  const data = check.data;
  const closed = data ? data.status !== 'open' : false;
  const spaceName = (spaces.data ?? []).find((s) => s.id === data?.spaceId)?.name ?? null;
  const guest = data ? checkTitle(data) : null;
  const subtitle = !data ? '' : closed ? `${guest} · чек закрыт` : `${guest} · ${formatMoney(checkTotals(data, now).due)}`;
  const rows = chatRows(messages, now, aliases);
  const bottomPad = Math.max(insets.bottom, space.md);
  // Над клавиатурой поле стоит с небольшим зазором, а не на высоте «домашней полоски».
  const keyboardLift = bottomPad - space.sm;

  return (
    <AmbientBackdrop style={styles.screen}>
      <Stack.Screen options={{ headerTitle: () => <ChatTitle title={spaceName ?? guest ?? 'Чат с кабинкой'} subtitle={subtitle} /> }} />
      {data && (
        <Stack.Toolbar placement="right">
          <ToolbarButton icon="receipt" accessibilityLabel="Открыть чек" onPress={() => openCheck(router, checkId)} />
        </Stack.Toolbar>
      )}

      <KeyboardChatScrollView
        ref={scroller}
        offset={keyboardLift}
        keyboardDismissMode={KEYBOARD_DISMISS}
        keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="never"
        scrollIndicatorInsets={{ top: headerHeight }}
        showsVerticalScrollIndicator={false}
        style={[styles.flex, chat.data !== undefined && !ready && styles.hidden]}
        contentContainerStyle={[
          styles.list,
          {
            paddingTop: (Platform.OS === 'ios' ? headerHeight : headerClearance) + space.md,
            paddingBottom: composerTop + space.sm,
            paddingLeft: insets.left + space.md,
            paddingRight: insets.right + space.md,
          },
          rows.length === 0 && styles.listEmpty,
        ]}
        onContentSizeChange={onContentSizeChange}
        onLayout={(e) => {
          metrics.current.layout = e.nativeEvent.layout.height;
        }}
        onContentInsetChange={(inset) => {
          metrics.current.inset = inset.bottom;
        }}
        onEndVisible={(visible) => {
          atEnd.current = visible;
          setAway(!visible);
        }}>
        {rows.length > 0 && <Intro />}
        {rows.map((row) =>
          row.kind === 'day' ? (
            <View key={row.key} style={styles.day}>
              <Text style={[type.caption1, styles.dayText]}>{row.label}</Text>
            </View>
          ) : (
            <Bubble key={row.key} row={row} animate={ready} onRetry={retry} />
          ),
        )}
        {rows.length === 0 && (chat.isLoading ? <ActivityIndicator style={styles.loading} /> : <Empty closed={closed} />)}
      </KeyboardChatScrollView>

      {/* Подложка под стеклянную шапку iPhone: заголовок читается и над пузырями (на Android шапка размывает сама). */}
      {Platform.OS === 'ios' && (
        <View
          pointerEvents="none"
          style={[
            styles.topVeil,
            { height: headerHeight + space.lg, experimental_backgroundImage: `linear-gradient(to bottom, ${veil(dark, 0.85)} 0%, ${veil(dark, 0.6)} 60%, ${veil(dark, 0)} 100%)` },
          ]}
        />
      )}

      {away && (
        <KeyboardStickyView
          offset={{ closed: 0, opened: keyboardLift }}
          style={[styles.jumpDock, { bottom: composerTop + space.sm, right: insets.right + space.lg }]}>
          <Animated.View entering={ZoomIn.duration(160)} exiting={ZoomOut.duration(120)}>
            <GlassView isInteractive style={styles.jump}>
              <Pressable
                onPress={() => {
                  haptic.selection();
                  scrollToBottom(true);
                }}
                hitSlop={8}
                style={styles.jumpPress}
                accessibilityRole="button"
                accessibilityLabel="К последним сообщениям">
                <SymbolView name="chevron.down" size={16} weight="semibold" tintColor={colors.label} />
              </Pressable>
            </GlassView>
          </Animated.View>
        </KeyboardStickyView>
      )}

      <KeyboardStickyView offset={{ closed: 0, opened: keyboardLift }} style={styles.composerDock}>
        <Composer
          text={text}
          onChangeText={setText}
          onSend={submit}
          closed={closed}
          bottomPad={bottomPad}
          onHeight={setComposerTop}
          sides={{ left: insets.left, right: insets.right }}
        />
      </KeyboardStickyView>
    </AmbientBackdrop>
  );
}

/** Цвет фона экрана с прозрачностью — для растворения ленты у шапки и поля ввода. */
function veil(dark: boolean, alpha: number): string {
  return dark ? `rgba(0,0,0,${alpha})` : `rgba(242,242,247,${alpha})`;
}

/** Открытый чек: тот, с которого пришли, или новый экран. */
function openCheck(router: ReturnType<typeof useRouter>, checkId: string) {
  haptic.selection();
  router.navigate({ pathname: '/pos/[checkId]', params: { checkId } });
}

const TITLE_MAX_WIDTH = 240;
/** Кнопки шапки слева и справа с отступами. */
const TITLE_SIDE_ROOM = 160;

function ChatTitle({ title, subtitle }: { title: string; subtitle: string }) {
  // Шапка оставляет заголовку ширину между кнопками: на «Увеличенном» виде (320 pt) это ~160.
  const { width } = useWindowDimensions();
  return (
    <View style={[styles.title, { maxWidth: Math.min(TITLE_MAX_WIDTH, width - TITLE_SIDE_ROOM) }]}>
      <Text style={[type.headline, styles.label]} numberOfLines={1} maxFontSizeMultiplier={FONT_SCALE_MAX.compact}>
        {title}
      </Text>
      {!!subtitle && (
        <Text style={[type.caption1, styles.secondary]} numberOfLines={1} maxFontSizeMultiplier={FONT_SCALE_MAX.compact}>
          {subtitle}
        </Text>
      )}
    </View>
  );
}

/** Подсказка в начале переписки: откуда пишет гость. */
function Intro() {
  return (
    <View style={styles.intro}>
      <SymbolView name="ipad.landscape" size={15} tintColor={colors.secondaryLabel} />
      <Text style={[type.caption1, styles.secondary, styles.centered]}>Гость пишет с планшета в кабинке — ответ появится у него на экране</Text>
    </View>
  );
}

function Empty({ closed }: { closed: boolean }) {
  return (
    <Animated.View entering={FadeIn.duration(220)} style={styles.empty}>
      <GlassView style={styles.emptyIcon}>
        <SymbolView name="bubble.left.and.text.bubble.right.fill" size={34} tintColor={colors.accent} />
      </GlassView>
      <Text style={[type.title3, styles.label, styles.centered]}>{closed ? 'Переписки не было' : 'Напишите гостю'}</Text>
      <Text style={[type.subhead, styles.secondary, styles.centered]}>
        {closed ? 'Чек закрыт — чат с кабинкой больше недоступен.' : 'Сообщение сразу появится на планшете в кабинке. Можно начать с быстрого ответа ниже.'}
      </Text>
    </Animated.View>
  );
}

/** «  00:00» и «  00:00 ✓✓» шрифтом подписи. */
const META_SPACE = '\u00A0\u00A0\u2007\u2007\u00A0\u2007\u2007';
const META_SPACE_MINE = `${META_SPACE}\u00A0\u2007\u2007\u2007`;

const TIGHT = 6;
const ROUND = 20;

function Bubble({
  row,
  animate,
  onRetry,
}: {
  row: Extract<ReturnType<typeof chatRows>[number], { kind: 'message' }>;
  animate: boolean;
  onRetry: (message: ChatMessage) => void;
}) {
  const { message, first, last } = row;
  const mine = message.sender === 'staff';
  const failed = message.local === 'failed';
  const corners = mine
    ? { borderTopRightRadius: first ? ROUND : TIGHT, borderBottomRightRadius: last ? ROUND : TIGHT }
    : { borderTopLeftRadius: first ? ROUND : TIGHT, borderBottomLeftRadius: last ? ROUND : TIGHT };
  const time = formatTime(message.createdAt);
  const metaColor = mine ? styles.metaMine : styles.metaTheirs;

  const bubble = (
    <View style={[styles.bubble, mine ? styles.mine : styles.theirs, corners, failed && styles.failed]}>
      <Text style={[type.body, mine ? styles.mineText : styles.label]}>
        {message.text}
        {/* Место под подпись в последней строке, как в Telegram: пробелы шириной в цифру (U+2007)
            и неразрывные — они не «свисают» за край строки и видны не бывают. */}
        <Text style={styles.metaText} allowFontScaling={false}>
          {mine ? META_SPACE_MINE : META_SPACE}
        </Text>
      </Text>
      <View style={styles.meta}>
        {/* Время и место под него — одного кегля без роста: иначе с крупным текстом время наезжало на текст. */}
        <Text style={[styles.metaText, metaColor]} allowFontScaling={false}>
          {time}
        </Text>
        {mine && <Status message={message} />}
      </View>
    </View>
  );

  return (
    <Animated.View
      entering={animate ? FadeInDown.duration(220) : undefined}
      style={[styles.row, mine ? styles.rowMine : styles.rowTheirs, first && styles.groupStart]}>
      {failed ? (
        <Pressable onPress={() => onRetry(message)} style={styles.failedRow} accessibilityRole="button" accessibilityLabel="Отправить ещё раз">
          {bubble}
          <SymbolView name="exclamationmark.circle.fill" size={22} tintColor={colors.red} />
        </Pressable>
      ) : (
        bubble
      )}
      {failed && <Text style={[type.caption2, styles.failedText]}>Не отправлено. Нажмите, чтобы повторить</Text>}
    </Animated.View>
  );
}

/** ✓ — доставлено, ✓✓ — гость прочитал на планшете, часы — ещё отправляется. */
function Status({ message }: { message: ChatMessage }) {
  if (message.local === 'sending') return <SymbolView name="clock" size={11} tintColor="rgba(255,255,255,0.75)" />;
  if (message.local === 'failed') return null;
  return (
    <View style={styles.checks}>
      <SymbolView name="checkmark" size={10} weight="bold" tintColor="rgba(255,255,255,0.8)" />
      {message.readAt && <SymbolView name="checkmark" size={10} weight="bold" tintColor="rgba(255,255,255,0.8)" style={styles.secondCheck} />}
    </View>
  );
}

function Composer({
  text,
  onChangeText,
  onSend,
  closed,
  bottomPad,
  onHeight,
  sides,
}: {
  text: string;
  onChangeText: (value: string) => void;
  onSend: (value: string) => void;
  closed: boolean;
  bottomPad: number;
  onHeight: (height: number) => void;
  sides: { left: number; right: number };
}) {
  const dark = useColorScheme() === 'dark';
  const ready = text.trim().length > 0;

  return (
    <View
      onLayout={(e) => onHeight(e.nativeEvent.layout.height)}
      style={[
        styles.composer,
        // Лента уходит под поле ввода, растворяясь — как нижний край ленты в Сообщениях iOS 26.
        { paddingBottom: bottomPad, experimental_backgroundImage: `linear-gradient(to top, ${veil(dark, 0.92)} 0%, ${veil(dark, 0.78)} 55%, ${veil(dark, 0)} 100%)` },
      ]}>
      {closed ? (
        <GlassView style={[styles.closedNote, { marginLeft: sides.left + space.lg, marginRight: sides.right + space.lg }]}>
          <SymbolView name="lock.fill" size={14} tintColor={colors.secondaryLabel} />
          <Text style={[type.subhead, styles.secondary]}>Чек закрыт — ответить уже нельзя</Text>
        </GlassView>
      ) : (
        <>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="always"
            contentContainerStyle={[styles.replies, { paddingLeft: sides.left + space.lg, paddingRight: sides.right + space.lg }]}>
            {QUICK_REPLIES.map((reply) => (
              <GlassView key={reply} isInteractive style={styles.chip}>
                <Pressable onPress={() => onSend(reply)} style={styles.chipPress} accessibilityRole="button" accessibilityLabel={`Ответить: ${reply}`}>
                  <Text style={[type.subhead, styles.label]}>{reply}</Text>
                </Pressable>
              </GlassView>
            ))}
          </ScrollView>
          <View style={[styles.inputRow, { paddingLeft: sides.left + space.md, paddingRight: sides.right + space.md }]}>
            <GlassView style={styles.inputGlass}>
              <TextInput
                value={text}
                onChangeText={onChangeText}
                placeholder="Сообщение гостю"
                placeholderTextColor={colors.tertiaryLabel}
                selectionColor={colors.accent}
                style={[type.body, styles.input]}
                multiline
                maxLength={1000}
                accessibilityLabel="Сообщение гостю"
              />
              {ready && (
                <Animated.View entering={ZoomIn.duration(140)} exiting={FadeOut.duration(100)} style={styles.sendWrap}>
                  <Pressable onPress={() => onSend(text)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Отправить">
                    <View style={styles.send}>
                      <SymbolView name="arrow.up" size={16} weight="bold" tintColor="white" />
                    </View>
                  </Pressable>
                </Animated.View>
              )}
            </GlassView>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  hidden: { opacity: 0 },
  label: { color: colors.label },
  secondary: { color: colors.secondaryLabel },
  centered: { textAlign: 'center' },
  title: { alignItems: 'center' },
  list: { flexGrow: 1, justifyContent: 'flex-end' },
  listEmpty: { justifyContent: 'center' },
  loading: { alignSelf: 'center', marginTop: space.xxxl },
  intro: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xs, paddingHorizontal: space.xl, paddingBottom: space.sm },
  day: { alignSelf: 'center', marginTop: space.md, marginBottom: space.xs, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10, backgroundColor: colors.fill },
  dayText: { color: colors.secondaryLabel, fontWeight: '600' },
  empty: { alignItems: 'center', gap: space.sm, paddingHorizontal: space.xxl },
  emptyIcon: { width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center', marginBottom: space.sm },
  row: { maxWidth: '80%', marginTop: 2 },
  rowMine: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  rowTheirs: { alignSelf: 'flex-start', alignItems: 'flex-start' },
  groupStart: { marginTop: space.md },
  bubble: { borderRadius: ROUND, borderCurve: 'continuous', paddingLeft: 13, paddingRight: 11, paddingTop: 8, paddingBottom: 8 },
  mine: { backgroundColor: colors.accent },
  theirs: { backgroundColor: colors.card },
  failed: { opacity: 0.55 },
  mineText: { color: 'white' },
  meta: { position: 'absolute', right: 10, bottom: 6, flexDirection: 'row', alignItems: 'center', gap: 3 },
  metaText: { fontSize: 11, lineHeight: 13, fontVariant: ['tabular-nums'] },
  metaMine: { color: 'rgba(255,255,255,0.75)' },
  metaTheirs: { color: colors.tertiaryLabel },
  checks: { flexDirection: 'row' },
  secondCheck: { marginLeft: -5 },
  failedRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  failedText: { color: colors.red, marginTop: 3, marginRight: 28 },
  composerDock: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  composer: { gap: space.sm, paddingTop: space.lg },
  replies: { gap: space.sm },
  chip: { borderRadius: 18, overflow: 'hidden' },
  chipPress: { paddingHorizontal: 14, paddingVertical: 8 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end' },
  inputGlass: { flex: 1, flexDirection: 'row', alignItems: 'flex-end', borderRadius: 22, borderCurve: 'continuous', overflow: 'hidden', minHeight: 44 },
  input: { flex: 1, color: colors.label, paddingLeft: 16, paddingRight: 8, paddingTop: 11, paddingBottom: 11, maxHeight: 132 },
  sendWrap: { padding: 6 },
  send: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  closedNote: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm, borderRadius: 22, paddingVertical: 12 },
  jumpDock: { position: 'absolute' },
  topVeil: { position: 'absolute', top: 0, left: 0, right: 0 },
  jump: { width: 38, height: 38, borderRadius: 19, overflow: 'hidden' },
  jumpPress: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
