import { useLocalSearchParams, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import Animated, { FadeIn, FadeOut, useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { SFSymbol } from 'sf-symbols-typescript';

import { CircleButton, GlassCard } from '@/components/new-check-parts';
import { TaiMessageView } from '@/components/tai/message';
import { Text, TextInput, type TextInputRef } from '@/components/text';
import { haptic } from '@/lib/haptics';
import { KEYBOARD_DISMISS } from '@/lib/layout';
import type { TaiContext } from '@/lib/tai-api';
import { useTaiStore, type TaiReply } from '@/lib/tai-store';
import { useTaiVoice } from '@/lib/tai-voice';
import { colors, space, springs, type, useAccentHex } from '@/lib/theme';

type Starter = { icon: SFSymbol; text: string; /** Только подставить в поле — дальше допишет человек. */ draft?: boolean };

const STARTERS: Record<NonNullable<TaiContext['screen']>, { hint: string; items: Starter[] }> = {
  pos: {
    hint: 'Открою чек, добавлю позиции, расскажу, как идёт смена.',
    items: [
      { icon: 'plus.rectangle.on.rectangle', text: 'Открой чек на ', draft: true },
      { icon: 'clock', text: 'Как идёт смена?' },
      { icon: 'list.bullet.rectangle', text: 'Открытые чеки' },
      { icon: 'shippingbox', text: 'Что заканчивается на складе?' },
    ],
  },
  check: {
    hint: 'Добавлю позиции в этот чек, сделаю скидку, подскажу про гостя.',
    items: [
      { icon: 'cart.badge.plus', text: 'Добавь ', draft: true },
      { icon: 'percent', text: 'Скидка 10%' },
      { icon: 'person.crop.circle', text: 'Что этот гость обычно берёт?' },
      { icon: 'list.bullet', text: 'Что уже в чеке?' },
    ],
  },
  analytics: {
    hint: 'Объясню цифры, сравню периоды, найду чеки.',
    items: [
      { icon: 'arrow.left.arrow.right', text: 'Сравни эту неделю с прошлой' },
      { icon: 'clock.badge', text: 'Часы пик за месяц' },
      { icon: 'cup.and.saucer', text: 'Топ товаров за неделю' },
      { icon: 'person.2', text: 'Кто тратит больше всех?' },
    ],
  },
  other: {
    hint: 'Спросите о клубе или попросите действие в кассе.',
    items: [
      { icon: 'rublesign.circle', text: 'Выручка за сегодня' },
      { icon: 'clock', text: 'Как идёт смена?' },
      { icon: 'shippingbox', text: 'Что заканчивается на складе?' },
      { icon: 'plus.rectangle.on.rectangle', text: 'Открой чек на ', draft: true },
    ],
  },
};

/** Фраза для голоса, если ответ — только блоки без текста. */
function voiceSummary(reply: TaiReply): string {
  const action = reply.blocks.find((b) => b.type === 'action');
  if (action?.type === 'action' && action.action.status === 'pending')
    return `${action.action.title}${action.action.total ? `, итого ${action.action.total}` : ''}. Подтверждаете?`;
  const choice = reply.blocks.find((b) => b.type === 'choice');
  if (choice?.type === 'choice') return choice.question;
  return reply.blocks.length ? 'Показал на экране.' : '';
}

/**
 * Tai — шторка поверх кассы, чека или аналитики. Помнит, откуда открыт: в чеке «добавь
 * колу» — в этот чек. Отвечает потоком: статус, текст, интерактивные блоки и карточки
 * действий; можно говорить голосом — ответ озвучивается, после него Tai снова слушает.
 */
export default function TaiScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const accent = useAccentHex();
  const params = useLocalSearchParams<{ screen?: string; checkId?: string; from?: string; to?: string }>();
  const scroller = useRef<ScrollView>(null);
  const input = useRef<TextInputRef>(null);
  const [draft, setDraft] = useState('');

  const messages = useTaiStore((s) => s.messages);
  const busy = useTaiStore((s) => s.busy);
  const locked = useTaiStore((s) => s.locked);
  const send = useTaiStore((s) => s.send);
  const stop = useTaiStore((s) => s.stop);
  const reset = useTaiStore((s) => s.reset);
  const setContext = useTaiStore((s) => s.setContext);

  const screen = (['pos', 'check', 'analytics'].includes(params.screen ?? '') ? params.screen : 'other') as NonNullable<TaiContext['screen']>;
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

  // Озвучка ответа, пока он печатается.
  const last = messages.at(-1);
  const lastReply = last?.role === 'tai' ? last : null;
  useEffect(() => {
    if (!lastReply?.voice) return;
    if (!lastReply.streaming && !lastReply.text) {
      voice.say(lastReply.error ?? voiceSummary(lastReply));
      return;
    }
    voice.feed(lastReply.id, lastReply.text, !lastReply.streaming);
    // voice — стабильные колбэки; следим только за ответом.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastReply?.id, lastReply?.text, lastReply?.streaming]);

  const submit = (text: string) => {
    if (!text.trim() || busy) return;
    setDraft('');
    void send(text);
  };

  const empty = messages.length === 0;
  const starters = STARTERS[screen];
  const suggestions = !busy && lastReply && !lastReply.streaming ? lastReply.suggestions : [];

  return (
    <View style={[styles.screen, Platform.OS === 'android' && styles.androidSheet]}>
      <View style={styles.header}>
        <View style={styles.side}>
          {!empty && (
            <CircleButton
              icon="square.and.pencil"
              label="Новый диалог"
              onPress={() => {
                haptic.light();
                voice.end();
                reset();
              }}
            />
          )}
        </View>
        <View style={styles.title}>
          <SymbolView name="sparkles" size={16} weight="semibold" tintColor={accent} />
          <Text style={[type.headline, styles.label]}>Tai</Text>
        </View>
        <View style={[styles.side, styles.right]}>
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
        <ScrollView
          ref={scroller}
          contentContainerStyle={styles.messages}
          keyboardDismissMode={KEYBOARD_DISMISS}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: true })}
        >
          {empty ? (
            <Animated.View entering={FadeIn.duration(220)} style={styles.welcome}>
              <SymbolView name="sparkles" size={40} tintColor={accent} />
              <Text style={[type.title2, styles.label]}>Чем помочь?</Text>
              <Text style={[type.subhead, styles.secondary, styles.centered]}>{starters.hint}</Text>
              <GlassCard style={styles.starters}>
                {starters.items.map((item, index) => (
                  <Pressable
                    key={item.text}
                    onPress={() => {
                      if (item.draft) {
                        setDraft(item.text);
                        input.current?.focus();
                      } else submit(item.text);
                    }}
                    style={({ pressed }) => [styles.starter, index > 0 && styles.starterBorder, pressed && styles.pressed]}
                    accessibilityRole="button"
                  >
                    <SymbolView name={item.icon} size={18} tintColor={colors.accent} />
                    <Text style={[type.body, styles.label, styles.flex]}>{item.draft ? `${item.text.trim()}…` : item.text}</Text>
                  </Pressable>
                ))}
              </GlassCard>
            </Animated.View>
          ) : (
            messages.map((message) => <TaiMessageView key={message.id} message={message} />)
          )}
        </ScrollView>

        {suggestions.length > 0 && !voice.active && (
          <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(120)}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.suggestions} keyboardShouldPersistTaps="handled">
              {suggestions.map((item) => (
                <Pressable
                  key={item}
                  onPress={() => (item.endsWith('…') ? (setDraft(item.replace(/…$/, '')), input.current?.focus()) : submit(item))}
                  accessibilityRole="button"
                >
                  <GlassCard interactive style={styles.suggestion}>
                    <Text style={[type.subhead, styles.label]} numberOfLines={1}>
                      {item}
                    </Text>
                  </GlassCard>
                </Pressable>
              ))}
            </ScrollView>
          </Animated.View>
        )}

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
                placeholder="Спросите или попросите действие"
                placeholderTextColor={colors.tertiaryLabel}
                selectionColor={colors.accent}
                multiline
                style={[type.body, styles.input]}
                accessibilityLabel="Сообщение для Tai"
                submitBehavior="submit"
                onSubmitEditing={() => submit(draft)}
                returnKeyType="send"
              />
              {busy ? (
                <Pressable onPress={stop} hitSlop={8} accessibilityRole="button" accessibilityLabel="Остановить">
                  <SymbolView name="stop.circle.fill" size={32} tintColor={colors.label} />
                </Pressable>
              ) : draft.trim() ? (
                <Pressable onPress={() => submit(draft)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Отправить">
                  <SymbolView name="arrow.up.circle.fill" size={32} tintColor={accent} />
                </Pressable>
              ) : (
                <Pressable onPress={() => void voice.listen()} hitSlop={8} accessibilityRole="button" accessibilityLabel="Говорить с Tai голосом">
                  <SymbolView name="mic.circle.fill" size={32} tintColor={accent} />
                </Pressable>
              )}
            </GlassCard>
          )}
        </View>
      </KeyboardAvoidingView>
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
  screen: { flex: 1 },
  androidSheet: { backgroundColor: colors.sheetBackground },
  flex: { flex: 1, minWidth: 0 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.sm },
  side: { width: 44 },
  right: { alignItems: 'flex-end' },
  title: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  label: { color: colors.label },
  secondary: { color: colors.secondaryLabel },
  centered: { textAlign: 'center' },
  messages: { paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.lg, gap: space.xl },
  welcome: { alignItems: 'center', gap: space.sm, paddingTop: space.xxl },
  starters: { alignSelf: 'stretch', marginTop: space.lg, paddingHorizontal: space.lg },
  starter: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: 13 },
  starterBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator },
  pressed: { opacity: 0.6 },
  suggestions: { gap: space.sm, paddingHorizontal: space.lg, paddingBottom: space.sm },
  suggestion: { paddingHorizontal: space.lg, paddingVertical: 9 },
  bottom: { paddingHorizontal: space.lg, paddingTop: space.xs },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm, paddingLeft: space.lg, paddingRight: 6, paddingVertical: 6, borderRadius: 26 },
  input: { flex: 1, color: colors.label, maxHeight: 132, minHeight: 36, paddingTop: 7, paddingBottom: 7 },
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
