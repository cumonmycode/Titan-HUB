import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { HeaderHeightContext } from 'expo-router/react-navigation';
import { SymbolView } from 'expo-symbols';
import { type ComponentRef, useContext, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { KeyboardChatScrollView, KeyboardStickyView } from 'react-native-keyboard-controller';
import Animated, { FadeIn, FadeInDown, FadeOut, ZoomIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AmbientBackdrop } from '@/components/ambient-backdrop';
import { GlassView } from '@/components/glass';
import { Text, TextInput } from '@/components/text';
import { ToolbarButton } from '@/components/toolbar';
import { formatTime } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { KEYBOARD_DISMISS, useHeaderClearance } from '@/lib/layout';
import { queryClient } from '@/lib/query';
import { useClubKey } from '@/lib/queries';
import { markTaiChatRead, sendTaiReply, setTaiPaused, taiMessagesKey, useTaiChat, useTaiMessages, type InboxMessage } from '@/lib/tai-inbox-api';
import { FONT_SCALE_MAX } from '@/lib/text-scale';
import { colors, space, type } from '@/lib/theme';

const TAI_COLOR = '#8B5CF6';
const TEXT_MAX = 3500;
const TITLE_MAX_WIDTH = 240;
const TITLE_SIDE_ROOM = 160;
const dayFormat = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: 'Europe/Moscow' });
const dayKey = (iso: string) => new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' });

let localSeq = 0;
const nextLocalId = () => `local-${Date.now().toString(36)}-${++localSeq}`;

type Row = { kind: 'day'; key: string; label: string } | { kind: 'message'; key: string; message: InboxMessage; first: boolean };

function rowsOf(messages: InboxMessage[]): Row[] {
  const out: Row[] = [];
  let lastDay = '';
  let lastSide = '';
  for (const m of messages) {
    const day = dayKey(m.createdAt);
    if (day !== lastDay) {
      out.push({ kind: 'day', key: `day-${day}`, label: dayFormat.format(new Date(m.createdAt)) });
      lastDay = day;
      lastSide = '';
    }
    const side = m.role === 'user' ? 'user' : m.role === 'staff' ? `staff-${m.staff?.id ?? ''}` : 'tai';
    out.push({ kind: 'message', key: String(m.id), message: m, first: side !== lastSide });
    lastSide = side;
  }
  return out;
}

/**
 * Диалог Tai с клиентом в личке бота клуба: вся переписка (клиент слева, Tai и
 * сотрудники справа), сверху — кто сейчас отвечает. Ответ сотрудника уходит клиенту
 * в Telegram от бота и ставит Tai на паузу; «Вернуть Tai» отдаёт разговор обратно.
 * Полный экран поверх вкладок — как чат кабинки (поле ввода не под панелью вкладок).
 */
export default function TaiDialogScreen() {
  const { tgId } = useLocalSearchParams<{ tgId: string }>();
  const router = useRouter();
  const club = useClubKey();
  const insets = useSafeAreaInsets();
  const headerHeight = useContext(HeaderHeightContext) ?? 0;
  const headerClearance = useHeaderClearance();
  const chat = useTaiChat(tgId);
  const messages = useTaiMessages(tgId);
  const [text, setText] = useState('');
  const [composerTop, setComposerTop] = useState(0);
  const scroller = useRef<ComponentRef<typeof KeyboardChatScrollView>>(null);
  const atEnd = useRef(true);

  const list = messages.data ?? [];
  const lastUserId = list.findLast((m) => m.role === 'user')?.id ?? null;

  // Открыли диалог — он прочитан, «ждёт ответа» гаснет.
  useEffect(() => {
    if (tgId) void markTaiChatRead(club, tgId);
  }, [club, tgId, lastUserId]);

  const data = chat.data;
  const paused = data?.aiPaused ?? false;
  const key = taiMessagesKey(club, tgId ?? '');

  const patchMessages = (fn: (old: InboxMessage[]) => InboxMessage[]) => queryClient.setQueryData<InboxMessage[]>(key, (old) => fn(old ?? []));

  const send = async (value: string, localId = nextLocalId()) => {
    const message = value.trim();
    if (!message || !tgId) return;
    haptic.light();
    setText('');
    atEnd.current = true;
    patchMessages((old) => [
      ...old.filter((m) => m.id !== localId),
      { id: localId, role: 'staff', text: message, voice: false, memo: null, staff: null, createdAt: new Date().toISOString(), local: 'sending' },
    ]);
    try {
      await sendTaiReply(club, tgId, message);
      haptic.success();
      patchMessages((old) => old.filter((m) => m.id !== localId));
      await messages.refetch();
    } catch (error) {
      haptic.error();
      patchMessages((old) => old.map((m) => (m.id === localId ? { ...m, local: 'failed' } : m)));
      Alert.alert('Сообщение не отправлено', error instanceof Error ? error.message : String(error));
    }
  };

  const togglePause = () => {
    if (!tgId) return;
    haptic.selection();
    setTaiPaused(club, tgId, !paused).catch((error: unknown) => {
      haptic.error();
      Alert.alert('Не получилось', error instanceof Error ? error.message : String(error));
    });
  };

  const scrollToEnd = (animated: boolean) => scroller.current?.scrollToEnd({ animated });
  const rows = rowsOf(list);
  const bottomPad = Math.max(insets.bottom, space.md);
  const keyboardLift = bottomPad - space.sm;
  const subtitle = !data ? '' : data.username ? `@${data.username}` : data.profile ? 'клиент клуба' : 'в Telegram';

  return (
    <AmbientBackdrop style={styles.screen}>
      <Stack.Screen options={{ headerTitle: () => <DialogTitle title={data?.name ?? 'Диалог'} subtitle={subtitle} /> }} />
      {data?.profile ? (
        <Stack.Toolbar placement="right">
          <ToolbarButton
            icon="person.crop.circle"
            accessibilityLabel="Карточка клиента"
            onPress={() => router.push({ pathname: '/manage/clients/[clientId]', params: { clientId: data.profile!.id } })}
          />
        </Stack.Toolbar>
      ) : null}

      <KeyboardChatScrollView
        ref={scroller}
        offset={keyboardLift}
        keyboardDismissMode={KEYBOARD_DISMISS}
        keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="never"
        scrollIndicatorInsets={{ top: headerHeight }}
        showsVerticalScrollIndicator={false}
        style={styles.flex}
        contentContainerStyle={[
          styles.list,
          {
            paddingTop: (Platform.OS === 'ios' ? headerHeight : headerClearance) + space.md,
            paddingBottom: composerTop + space.sm,
            paddingLeft: insets.left + space.md,
            paddingRight: insets.right + space.md,
          },
        ]}
        onContentSizeChange={() => {
          if (atEnd.current) scrollToEnd(false);
        }}
        onEndVisible={(visible) => {
          atEnd.current = visible;
        }}>
        {data ? <ModeCard paused={paused} waiting={data.needsAttention} blocked={!data.dmOpen} onToggle={togglePause} /> : null}
        {rows.map((row) =>
          row.kind === 'day' ? (
            <View key={row.key} style={styles.day}>
              <Text style={[type.caption1, styles.dayText]}>{row.label}</Text>
            </View>
          ) : (
            <Bubble key={row.key} message={row.message} first={row.first} onRetry={(m) => void send(m.text, String(m.id))} />
          ),
        )}
        {messages.isLoading ? <ActivityIndicator style={styles.loading} /> : null}
        {!messages.isLoading && rows.length === 0 ? <Text style={[type.subhead, styles.secondary, styles.centered]}>Сообщений пока нет</Text> : null}
      </KeyboardChatScrollView>

      <KeyboardStickyView offset={{ closed: 0, opened: keyboardLift }} style={styles.composerDock}>
        <View
          onLayout={(e) => setComposerTop(e.nativeEvent.layout.height)}
          style={[styles.composer, { paddingBottom: bottomPad, paddingLeft: insets.left + space.md, paddingRight: insets.right + space.md }]}>
          {!paused ? <Text style={[type.caption1, styles.secondary, styles.hint]}>Ваш ответ поставит Tai на паузу в этом чате</Text> : null}
          <GlassView style={styles.inputGlass}>
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder="Ответить клиенту"
              placeholderTextColor={colors.tertiaryLabel}
              selectionColor={colors.accent}
              style={[type.body, styles.input]}
              multiline
              maxLength={TEXT_MAX}
              accessibilityLabel="Ответ клиенту"
            />
            {text.trim() ? (
              <Animated.View entering={ZoomIn.duration(140)} exiting={FadeOut.duration(100)} style={styles.sendWrap}>
                <Pressable onPress={() => void send(text)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Отправить">
                  <View style={styles.send}>
                    <SymbolView name="arrow.up" size={16} weight="bold" tintColor="white" />
                  </View>
                </Pressable>
              </Animated.View>
            ) : null}
          </GlassView>
        </View>
      </KeyboardStickyView>
    </AmbientBackdrop>
  );
}

function DialogTitle({ title, subtitle }: { title: string; subtitle: string }) {
  const { width } = useWindowDimensions();
  return (
    <View style={[styles.title, { maxWidth: Math.min(TITLE_MAX_WIDTH, width - TITLE_SIDE_ROOM) }]}>
      <Text style={[type.headline, styles.label]} numberOfLines={1} maxFontSizeMultiplier={FONT_SCALE_MAX.compact}>
        {title}
      </Text>
      {subtitle ? (
        <Text style={[type.caption1, styles.secondary]} numberOfLines={1} maxFontSizeMultiplier={FONT_SCALE_MAX.compact}>
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}

/** Кто сейчас отвечает клиенту — и одна кнопка, чтобы это поменять. */
function ModeCard({ paused, waiting, blocked, onToggle }: { paused: boolean; waiting: boolean; blocked: boolean; onToggle: () => void }) {
  const title = blocked ? 'Клиент заблокировал бота' : paused ? (waiting ? 'Клиент ждёт вашего ответа' : 'Отвечаете вы — Tai на паузе') : 'Отвечает Tai';
  const about = blocked
    ? 'Сообщения не доставляются, пока клиент снова не откроет бота.'
    : paused
      ? 'Tai читает переписку, но молчит. Верните его, когда закончите.'
      : 'Можно вмешаться в любой момент — просто напишите ниже.';
  return (
    <Animated.View entering={FadeIn.duration(200)}>
      <GlassView style={styles.mode}>
        <View style={[styles.modeIcon, { backgroundColor: paused ? (waiting ? colors.orange : colors.accent) : TAI_COLOR }]}>
          <SymbolView name={paused ? 'person.fill' : 'sparkles'} size={15} weight="semibold" tintColor="white" />
        </View>
        <View style={styles.flex}>
          <Text style={[type.subhead, styles.label, styles.bold]}>{title}</Text>
          <Text style={[type.footnote, styles.secondary]}>{about}</Text>
        </View>
        {!blocked ? (
          <Pressable onPress={onToggle} style={({ pressed }) => [styles.modeButton, pressed && styles.pressed]} accessibilityRole="button">
            <Text style={[type.footnote, styles.modeButtonText]}>{paused ? 'Вернуть Tai' : 'Пауза'}</Text>
          </Pressable>
        ) : null}
      </GlassView>
    </Animated.View>
  );
}

function Bubble({ message, first, onRetry }: { message: InboxMessage; first: boolean; onRetry: (m: InboxMessage) => void }) {
  const ours = message.role !== 'user';
  const tai = message.role === 'assistant';
  const failed = message.local === 'failed';
  const who = tai ? 'Tai' : message.role === 'staff' ? (message.staff?.nickname ?? 'Вы') : null;
  const bubble = (
    <View style={[styles.bubble, ours ? (tai ? styles.tai : styles.staff) : styles.client, failed && styles.failed]}>
      {first && who ? (
        <View style={styles.who}>
          {tai ? <SymbolView name="sparkles" size={10} tintColor="rgba(255,255,255,0.85)" /> : null}
          <Text style={[type.caption2, styles.whoText]}>{who}</Text>
        </View>
      ) : null}
      <Text style={[type.body, ours ? styles.oursText : styles.label]}>{message.text}</Text>
      <Text style={[styles.time, ours ? styles.timeOurs : styles.timeTheirs]} allowFontScaling={false}>
        {message.local === 'sending' ? 'отправляется…' : `${message.voice ? '🎤 ' : ''}${formatTime(message.createdAt)}`}
      </Text>
    </View>
  );
  return (
    <Animated.View entering={FadeInDown.duration(200)} style={[styles.row, ours ? styles.rowOurs : styles.rowTheirs, first && styles.groupStart]}>
      {failed ? (
        <Pressable onPress={() => onRetry(message)} accessibilityRole="button" accessibilityLabel="Отправить ещё раз">
          {bubble}
          <Text style={[type.caption2, styles.failedText]}>Не отправлено. Нажмите, чтобы повторить</Text>
        </Pressable>
      ) : (
        bubble
      )}
      {message.memo && tai ? (
        <Text style={[type.caption2, styles.memo]} numberOfLines={2}>
          {message.memo}
        </Text>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1, minWidth: 0 },
  label: { color: colors.label },
  secondary: { color: colors.secondaryLabel },
  bold: { fontWeight: '600' },
  centered: { textAlign: 'center', marginTop: space.xl },
  title: { alignItems: 'center' },
  list: { flexGrow: 1, justifyContent: 'flex-end', gap: 2 },
  loading: { alignSelf: 'center', marginTop: space.xxxl },
  day: { alignSelf: 'center', marginTop: space.md, marginBottom: space.xs, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10, backgroundColor: colors.fill },
  dayText: { color: colors.secondaryLabel, fontWeight: '600' },
  mode: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: 20, borderCurve: 'continuous', overflow: 'hidden', marginBottom: space.sm },
  modeIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  modeButton: { paddingHorizontal: space.md, minHeight: 32, borderRadius: 16, backgroundColor: colors.fill, alignItems: 'center', justifyContent: 'center' },
  modeButtonText: { color: colors.accent, fontWeight: '600' },
  pressed: { opacity: 0.7 },
  row: { maxWidth: '82%' },
  rowOurs: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  rowTheirs: { alignSelf: 'flex-start', alignItems: 'flex-start' },
  groupStart: { marginTop: space.md },
  bubble: { borderRadius: 18, borderCurve: 'continuous', paddingHorizontal: 13, paddingVertical: 8, gap: 2 },
  client: { backgroundColor: colors.card },
  tai: { backgroundColor: TAI_COLOR },
  staff: { backgroundColor: colors.accent },
  failed: { opacity: 0.55 },
  who: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  whoText: { color: 'rgba(255,255,255,0.85)', fontWeight: '700' },
  oursText: { color: 'white' },
  time: { fontSize: 11, lineHeight: 13, alignSelf: 'flex-end', fontVariant: ['tabular-nums'] },
  timeOurs: { color: 'rgba(255,255,255,0.75)' },
  timeTheirs: { color: colors.tertiaryLabel },
  failedText: { color: colors.red, marginTop: 3 },
  memo: { color: colors.tertiaryLabel, marginTop: 2, maxWidth: 260 },
  composerDock: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  composer: { gap: space.xs, paddingTop: space.sm, backgroundColor: colors.groupedBackground },
  hint: { textAlign: 'center' },
  inputGlass: { flexDirection: 'row', alignItems: 'flex-end', borderRadius: 22, borderCurve: 'continuous', overflow: 'hidden', minHeight: 44 },
  input: { flex: 1, color: colors.label, paddingLeft: 16, paddingRight: 8, paddingTop: 11, paddingBottom: 11, maxHeight: 132 },
  sendWrap: { padding: 6 },
  send: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
});
