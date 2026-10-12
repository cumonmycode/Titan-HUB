import { useLocalSearchParams, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import Animated, { FadeIn, FadeOut, useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { SFSymbol } from 'sf-symbols-typescript';

import { CircleButton, GlassCard } from '@/components/new-check-parts';
import { TaiHistoryDrawer } from '@/components/tai/history-drawer';
import { TaiMessageView } from '@/components/tai/message';
import { Text, TextInput, type TextInputRef } from '@/components/text';
import { haptic } from '@/lib/haptics';
import { KEYBOARD_DISMISS } from '@/lib/layout';
import { useSession } from '@/lib/session';
import type { TaiContext } from '@/lib/tai-api';
import { useTaiStore, type TaiReply } from '@/lib/tai-store';
import { useTaiVoice } from '@/lib/tai-voice';
import { colors, space, springs, type, useAccentHex } from '@/lib/theme';

type Screen = NonNullable<TaiContext['screen']>;
type Starter = { icon: SFSymbol; text: string; /** Только подставить в поле — дальше допишет человек. */ draft?: boolean };

const STARTERS: Record<Screen, Starter[]> = {
  pos: [
    { icon: 'plus.rectangle.on.rectangle', text: 'Открой чек на ', draft: true },
    { icon: 'clock', text: 'Как идёт смена?' },
    { icon: 'list.bullet.rectangle', text: 'Открытые чеки' },
    { icon: 'shippingbox', text: 'Пришла поставка: ', draft: true },
  ],
  check: [
    { icon: 'cart.badge.plus', text: 'Добавь ', draft: true },
    { icon: 'percent', text: 'Скидка 10%' },
    { icon: 'person.crop.circle', text: 'Что этот гость обычно берёт?' },
    { icon: 'list.bullet', text: 'Что уже в чеке?' },
  ],
  analytics: [
    { icon: 'arrow.left.arrow.right', text: 'Сравни эту неделю с прошлой' },
    { icon: 'clock.badge', text: 'Часы пик за месяц' },
    { icon: 'cup.and.saucer', text: 'Топ товаров за неделю' },
    { icon: 'person.2', text: 'Кто тратит больше всех?' },
  ],
  other: [
    { icon: 'rublesign.circle', text: 'Выручка за сегодня' },
    { icon: 'clock', text: 'Как идёт смена?' },
    { icon: 'shippingbox', text: 'Что заканчивается на складе?' },
    { icon: 'plus.rectangle.on.rectangle', text: 'Открой чек на ', draft: true },
  ],
};

/** Откуда открыт Tai — подпись в поле ввода, чтобы было понятно, о чём «этот чек». */
const CONTEXT_LABEL: Record<Screen, { icon: SFSymbol; text: string } | null> = {
  pos: { icon: 'rublesign.circle', text: 'Касса' },
  check: { icon: 'doc.text', text: 'Этот чек' },
  analytics: { icon: 'chart.bar', text: 'Отчёт за период' },
  other: null,
};

/**
 * Tai на весь экран — как Gemini на iPhone: история чатов слева (☰), приветствие и
 * подсказки в новом чате, ответы потоком с карточками, большое поле ввода и голос.
 * Помнит, откуда открыт: в чеке «добавь колу» — в этот чек. Чаты хранит сервер.
 */
export default function TaiScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const accent = useAccentHex();
  const params = useLocalSearchParams<{ screen?: string; checkId?: string; from?: string; to?: string }>();
  const scroller = useRef<ScrollView>(null);
  const input = useRef<TextInputRef>(null);
  const [draft, setDraft] = useState('');
  const [drawer, setDrawer] = useState(false);
  const nickname = useSession((s) => s.user?.nickname ?? '');
  const isOwner = useSession((s) => s.user?.role === 'owner');

  const messages = useTaiStore((s) => s.messages);
  const busy = useTaiStore((s) => s.busy);
  const locked = useTaiStore((s) => s.locked);
  const opening = useTaiStore((s) => s.opening);
  const chatId = useTaiStore((s) => s.chatId);
  const title = useTaiStore((s) => s.title);
  const send = useTaiStore((s) => s.send);
  const stop = useTaiStore((s) => s.stop);
  const reset = useTaiStore((s) => s.reset);
  const openChat = useTaiStore((s) => s.openChat);
  const setContext = useTaiStore((s) => s.setContext);

  const screen = (['pos', 'check', 'analytics'].includes(params.screen ?? '') ? params.screen : 'other') as Screen;
  useEffect(() => {
    setContext({
      screen,
      checkId: params.checkId || undefined,
      period: params.from && params.to ? { from: params.from, to: params.to } : undefined,
    });
  }, [screen, params.checkId, params.from, params.to, setContext]);

  const voice = useTaiVoice(async (text) => {
    await send(text, { voice: true });
    // Голосовое «да» на карточку — ответа модели нет, озвучиваем итог карточки.
    const last = useTaiStore.getState().messages.at(-1);
    if (last?.role !== 'user') return null;
    const reply = [...useTaiStore.getState().messages].reverse().find((m): m is TaiReply => m.role === 'tai');
    const card = reply?.blocks.find((b) => b.type === 'action');
    return card?.type === 'action' ? (card.action.status === 'cancelled' ? 'Отменил.' : (card.action.result ?? 'Готово.')) : 'Готово.';
  });

  const last = messages.at(-1);
  const lastReply = last?.role === 'tai' ? last : null;
  const empty = messages.length === 0 && !opening;
  const suggestions = !busy && lastReply && !lastReply.streaming ? lastReply.suggestions : [];
  const context = CONTEXT_LABEL[screen];

  const submit = (text: string) => {
    if (!text.trim() || busy || opening) return;
    setDraft('');
    void send(text);
  };
  const pickStarter = (item: Starter) => {
    haptic.light();
    if (item.draft) {
      setDraft(item.text);
      input.current?.focus();
    } else submit(item.text);
  };
  const newChat = () => {
    voice.end();
    reset();
    setDrawer(false);
  };

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + space.xs }]}>
        <CircleButton
          icon="line.3.horizontal"
          label="История чатов"
          onPress={() => {
            haptic.light();
            input.current?.blur();
            setDrawer(true);
          }}
        />
        <View style={styles.title}>
          <Text style={[type.headline, styles.label]} numberOfLines={1}>
            {title ?? 'Tai'}
          </Text>
        </View>
        <View style={styles.headerRight}>
          {chatId || messages.length > 0 ? <CircleButton icon="square.and.pencil" label="Новый чат" onPress={newChat} /> : null}
          <CircleButton
            icon="xmark"
            label="Закрыть"
            onPress={() => {
              voice.end();
              router.back();
            }}
          />
        </View>
      </View>

      <KeyboardAvoidingView behavior="padding" style={styles.flex} keyboardVerticalOffset={0}>
        {opening ? (
          <View style={styles.center}>
            <ActivityIndicator />
          </View>
        ) : empty ? (
          <Animated.View entering={FadeIn.duration(240)} style={styles.welcome}>
            <Text style={[type.largeTitle, { color: accent }]}>{nickname ? `Привет, ${nickname}` : 'Привет'}</Text>
            <Text style={[type.largeTitle, styles.tertiary]}>Чем помочь?</Text>
          </Animated.View>
        ) : (
          <ScrollView
            ref={scroller}
            style={styles.flex}
            contentContainerStyle={styles.messages}
            keyboardDismissMode={KEYBOARD_DISMISS}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: true })}
          >
            {messages.map((message) => (
              <TaiMessageView key={message.id} message={message} />
            ))}
          </ScrollView>
        )}

        {empty && !voice.active ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
            {STARTERS[screen].map((item) => (
              <Pressable key={item.text} onPress={() => pickStarter(item)} accessibilityRole="button">
                <GlassCard interactive style={styles.chip}>
                  <SymbolView name={item.icon} size={16} tintColor={accent} />
                  <Text style={[type.subhead, styles.label]} numberOfLines={1}>
                    {item.draft ? `${item.text.trim()}…` : item.text}
                  </Text>
                </GlassCard>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}

        {suggestions.length > 0 && !voice.active ? (
          <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(120)}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
              {suggestions.map((item) => (
                <Pressable
                  key={item}
                  onPress={() => (item.endsWith('…') ? (setDraft(item.replace(/…$/, '')), input.current?.focus()) : submit(item))}
                  accessibilityRole="button"
                >
                  <GlassCard interactive style={styles.chip}>
                    <Text style={[type.subhead, styles.label]} numberOfLines={1}>
                      {item}
                    </Text>
                  </GlassCard>
                </Pressable>
              ))}
            </ScrollView>
          </Animated.View>
        ) : null}

        <View style={[styles.bottom, { paddingBottom: Math.max(insets.bottom, space.md) }]}>
          {locked ? (
            <GlassCard style={styles.locked}>
              <SymbolView name="lock.fill" size={16} tintColor={colors.secondaryLabel} />
              <Text style={[type.subhead, styles.secondary, styles.flex]}>Tai не подключён для этого клуба. Подключить можно в «О системе».</Text>
            </GlassCard>
          ) : voice.active ? (
            <VoiceBar phase={voice.phase} transcript={voice.transcript} level={voice.level} onDone={voice.finishListening} onStop={voice.end} />
          ) : (
            <GlassCard style={styles.composer}>
              <TextInput
                ref={input}
                value={draft}
                onChangeText={setDraft}
                placeholder="Спросите Tai"
                placeholderTextColor={colors.tertiaryLabel}
                selectionColor={colors.accent}
                multiline
                editable={!opening}
                style={[type.body, styles.input]}
                accessibilityLabel="Сообщение для Tai"
                submitBehavior="submit"
                onSubmitEditing={() => submit(draft)}
                returnKeyType="send"
              />
              <View style={styles.composerRow}>
                {context ? (
                  <View style={styles.context}>
                    <SymbolView name={context.icon} size={13} tintColor={colors.secondaryLabel} />
                    <Text style={[type.footnote, styles.secondary]} numberOfLines={1}>
                      {context.text}
                    </Text>
                  </View>
                ) : null}
                <View style={styles.flex} />
                {busy ? (
                  <Pressable onPress={stop} hitSlop={8} accessibilityRole="button" accessibilityLabel="Остановить">
                    <SymbolView name="stop.circle.fill" size={34} tintColor={colors.label} />
                  </Pressable>
                ) : draft.trim() ? (
                  <Pressable onPress={() => submit(draft)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Отправить">
                    <SymbolView name="arrow.up.circle.fill" size={34} tintColor={accent} />
                  </Pressable>
                ) : (
                  <Pressable
                    onPress={() => void voice.listen()}
                    style={({ pressed }) => [styles.voiceButton, { backgroundColor: accent }, pressed && styles.pressed]}
                    accessibilityRole="button"
                    accessibilityLabel="Говорить с Tai голосом"
                  >
                    <SymbolView name="waveform" size={16} weight="semibold" tintColor="white" />
                    <Text style={[type.subhead, styles.voiceText]}>Голос</Text>
                  </Pressable>
                )}
              </View>
            </GlassCard>
          )}
        </View>
      </KeyboardAvoidingView>

      <TaiHistoryDrawer
        open={drawer}
        activeId={chatId}
        onClose={() => setDrawer(false)}
        onNewChat={newChat}
        onOpenChat={(id) => {
          voice.end();
          setDrawer(false);
          void openChat(id);
        }}
        onSettings={
          isOwner
            ? () => {
                setDrawer(false);
                router.push('/manage/tai');
              }
            : undefined
        }
      />
    </View>
  );
}

/** Голосовой режим: живой текст, «дыхание» под громкость голоса и кнопки «Готово»/«Стоп». */
function VoiceBar({ phase, transcript, level, onDone, onStop }: { phase: string; transcript: string; level: number; onDone: () => void; onStop: () => void }) {
  const accent = useAccentHex();
  const orb = useAnimatedStyle(() => ({
    transform: [{ scale: withSpring(phase === 'listening' ? 1 + level * 0.6 : phase === 'speaking' ? 1.15 : 0.9, springs.snappy) }],
    opacity: withSpring(phase === 'thinking' ? 0.5 : 1, springs.smooth),
  }));
  const caption = phase === 'listening' ? transcript || 'Говорите…' : phase === 'thinking' ? 'Tai думает…' : 'Tai отвечает…';
  return (
    <GlassCard style={styles.voice}>
      <View style={styles.orbBox}>
        <Animated.View style={[styles.orb, { backgroundColor: accent }, orb]} />
        <SymbolView name={phase === 'speaking' ? 'speaker.wave.2.fill' : 'mic.fill'} size={16} tintColor="white" style={styles.orbIcon} />
      </View>
      <Text style={[type.body, transcript && phase === 'listening' ? styles.label : styles.secondary, styles.flex]} numberOfLines={3}>
        {caption}
      </Text>
      {phase === 'listening' && transcript ? (
        <Pressable onPress={onDone} hitSlop={8} accessibilityRole="button" accessibilityLabel="Готово">
          <SymbolView name="arrow.up.circle.fill" size={32} tintColor={accent} />
        </Pressable>
      ) : null}
      <Pressable onPress={onStop} hitSlop={8} accessibilityRole="button" accessibilityLabel="Выйти из голосового режима">
        <SymbolView name="xmark.circle.fill" size={32} tintColor={colors.tertiaryLabel} />
      </Pressable>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1, minWidth: 0 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg, paddingBottom: space.sm },
  title: { flex: 1, alignItems: 'center', paddingHorizontal: space.xs },
  headerRight: { flexDirection: 'row', gap: space.sm },
  label: { color: colors.label },
  secondary: { color: colors.secondaryLabel },
  tertiary: { color: colors.tertiaryLabel },
  messages: { paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.xl, gap: space.xxl },
  welcome: { flex: 1, justifyContent: 'center', paddingHorizontal: space.xxl, gap: 2 },
  chips: { gap: space.sm, paddingHorizontal: space.lg, paddingBottom: space.sm },
  chip: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg, paddingVertical: 10, borderRadius: 20 },
  bottom: { paddingHorizontal: space.md, paddingTop: space.xs },
  composer: { paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.sm, borderRadius: 28, gap: space.xs },
  input: { color: colors.label, maxHeight: 150, minHeight: 28, paddingTop: 0, paddingBottom: 0 },
  composerRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 36 },
  context: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: colors.fill, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 5, flexShrink: 1 },
  voiceButton: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 34, paddingHorizontal: 14, borderRadius: 17 },
  voiceText: { color: 'white', fontWeight: '600' },
  pressed: { opacity: 0.7 },
  locked: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.lg },
  voice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingLeft: space.md,
    paddingRight: 6,
    paddingVertical: 8,
    borderRadius: 28,
    minHeight: 56,
  },
  orbBox: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  orb: { position: 'absolute', width: 30, height: 30, borderRadius: 15 },
  orbIcon: { width: 16, height: 16 },
});
