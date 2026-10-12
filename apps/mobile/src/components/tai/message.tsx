import { SymbolView } from 'expo-symbols';
import { memo, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Share, StyleSheet, View } from 'react-native';
import type { SFSymbol } from 'sf-symbols-typescript';
import Animated, { FadeIn, FadeInDown, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

import { Text } from '@/components/text';
import { haptic } from '@/lib/haptics';
import { speakTai } from '@/lib/tai-api';
import { useTaiStore, type TaiMessage, type TaiReply } from '@/lib/tai-store';
import { playTaiSample } from '@/lib/tai-voice';
import { colors, space, type } from '@/lib/theme';

import { TaiBlockView } from './blocks';

const SPEAK_MAX = 600;

/** Сообщение диалога, как в Gemini: вопрос — серым пузырём справа, ответ Tai — со значком, текстом и блоками во всю ширину. */
export const TaiMessageView = memo(function TaiMessageView({ message }: { message: TaiMessage }) {
  if (message.role === 'user') {
    return (
      <Animated.View entering={FadeInDown.duration(180)} style={styles.mine}>
        <View style={styles.mineBubble}>
          <Text style={[type.body, styles.mineText]}>{message.text}</Text>
        </View>
      </Animated.View>
    );
  }
  return <Reply reply={message} />;
});

function Reply({ reply }: { reply: TaiReply }) {
  // Голосом — показываем только уже озвученное (как субтитры), остальное — когда дойдёт звук.
  const text = reply.gate ? reply.text.slice(0, reply.gate.chars).trim() : reply.text;
  const blocks = reply.gate ? reply.blocks.slice(0, reply.gate.blocks) : reply.blocks;
  const status = reply.gate && reply.streaming && !reply.status ? 'Tai отвечает…' : reply.status;
  const finished = !reply.streaming && !reply.gate;
  return (
    <Animated.View entering={FadeIn.duration(200)} style={styles.replyRow}>
      <View style={styles.mark}>
        <SymbolView name="sparkles" size={15} weight="semibold" tintColor={colors.accent} />
      </View>
      <View style={styles.reply}>
        {text ? <RichText text={text} selectable={finished} /> : null}
        {blocks.map((block, index) => (
          <Animated.View key={index} entering={FadeInDown.duration(220)}>
            <TaiBlockView block={block} />
          </Animated.View>
        ))}
        {(reply.streaming || reply.gate) && status ? <Status text={status} /> : null}
        {reply.error ? (
          <View style={styles.errorRow}>
            <SymbolView name="exclamationmark.triangle.fill" size={15} tintColor={colors.orange} />
            <Text style={[type.subhead, styles.secondary, styles.flex]}>{reply.error}</Text>
          </View>
        ) : null}
        {finished ? <ReplyActions reply={reply} /> : null}
      </View>
    </Animated.View>
  );
}

/** Под готовым ответом: озвучить и поделиться; ответ с ошибкой — повторить вопрос. */
function ReplyActions({ reply }: { reply: TaiReply }) {
  const retry = useTaiStore((s) => s.retry);
  const [speaking, setSpeaking] = useState(false);
  const text = reply.text.trim();
  if (reply.error) {
    return (
      <View style={styles.actions}>
        <Action icon="arrow.clockwise" label="Повторить" onPress={() => retry(reply.id)} />
      </View>
    );
  }
  if (!text) return null;
  const speak = async () => {
    setSpeaking(true);
    const audio = await speakTai(text.replace(/\*\*/g, '').slice(0, SPEAK_MAX));
    setSpeaking(false);
    if (audio) await playTaiSample(audio).catch(() => undefined);
    else haptic.error();
  };
  return (
    <View style={styles.actions}>
      <Action icon="speaker.wave.2" label="Озвучить" busy={speaking} onPress={() => void speak()} />
      <Action icon="square.and.arrow.up" label="Поделиться" onPress={() => void Share.share({ message: text.replace(/\*\*/g, '') })} />
    </View>
  );
}

function Action({ icon, label, busy, onPress }: { icon: SFSymbol; label: string; busy?: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={() => {
        haptic.light();
        onPress();
      }}
      disabled={busy}
      hitSlop={6}
      style={({ pressed }) => [styles.action, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {busy ? <ActivityIndicator size="small" /> : <SymbolView name={icon} size={17} tintColor={colors.secondaryLabel} />}
    </Pressable>
  );
}

/** Что Tai делает прямо сейчас — мерцающая строка с искрой. */
function Status({ text }: { text: string }) {
  const reduceMotion = useReducedMotion();
  const pulse = useSharedValue(1);
  useEffect(() => {
    if (!reduceMotion) pulse.value = withRepeat(withTiming(0.45, { duration: 700 }), -1, true);
  }, [pulse, reduceMotion]);
  const style = useAnimatedStyle(() => ({ opacity: pulse.value }));
  return (
    <Animated.View style={[styles.status, style]} accessibilityLiveRegion="polite">
      <SymbolView name="sparkles" size={14} tintColor={colors.accent} />
      <Text style={[type.subhead, styles.secondary]}>{text}</Text>
    </Animated.View>
  );
}

/** Ответ модели приходит лёгкой разметкой: **жирный**, заголовки и списки. */
export function RichText({ text, selectable }: { text: string; selectable?: boolean }) {
  const lines = text.split('\n');
  return (
    <View style={styles.rich}>
      {lines.map((line, index) => {
        const trimmed = line.trim();
        if (!trimmed) return <View key={index} style={styles.gap} />;
        const heading = /^#{1,6}\s+/.exec(trimmed);
        if (heading) {
          return (
            <Text key={index} selectable={selectable} style={[type.headline, styles.label]}>
              {inline(trimmed.slice(heading[0].length))}
            </Text>
          );
        }
        const bullet = /^([-*•]|\d+[.)])\s+/.exec(trimmed);
        if (bullet) {
          return (
            <View key={index} style={styles.bullet}>
              <Text style={[type.body, styles.secondary]}>{/^\d/.test(bullet[0]) ? bullet[0].trim() : '•'}</Text>
              <Text selectable={selectable} style={[type.body, styles.label, styles.flex]}>
                {inline(trimmed.slice(bullet[0].length))}
              </Text>
            </View>
          );
        }
        return (
          <Text key={index} selectable={selectable} style={[type.body, styles.label]}>
            {inline(trimmed)}
          </Text>
        );
      })}
    </View>
  );
}

function inline(line: string) {
  return line.split('**').map((part, index) =>
    index % 2 === 1 ? (
      <Text key={index} style={styles.bold}>
        {part}
      </Text>
    ) : (
      part
    ),
  );
}

const styles = StyleSheet.create({
  mine: { alignItems: 'flex-end', paddingLeft: space.xxxl + space.lg },
  mineBubble: { backgroundColor: colors.fill, paddingHorizontal: space.lg, paddingVertical: 11, borderRadius: 22, borderTopRightRadius: 8, borderCurve: 'continuous' },
  mineText: { color: colors.label },
  replyRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  mark: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.fill, marginTop: -3 },
  reply: { flex: 1, minWidth: 0, gap: space.md },
  actions: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginLeft: -8 },
  action: { width: 36, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 16 },
  pressed: { opacity: 0.5 },
  status: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  rich: { gap: 3 },
  gap: { height: space.xs },
  bullet: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
  flex: { flex: 1, minWidth: 0 },
  label: { color: colors.label },
  secondary: { color: colors.secondaryLabel },
  bold: { fontWeight: '700' },
});
