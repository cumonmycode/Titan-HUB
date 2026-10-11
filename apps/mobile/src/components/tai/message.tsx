import { SymbolView } from 'expo-symbols';
import { memo, useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

import { Text } from '@/components/text';
import type { TaiMessage, TaiReply } from '@/lib/tai-store';
import { colors, space, type } from '@/lib/theme';

import { TaiBlockView } from './blocks';

/** Сообщение диалога: вопрос — пузырём справа, ответ Tai — текстом и блоками во всю ширину. */
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
  return (
    <Animated.View entering={FadeIn.duration(200)} style={styles.reply}>
      {text ? <RichText text={text} /> : null}
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
    </Animated.View>
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
export function RichText({ text }: { text: string }) {
  const lines = text.split('\n');
  return (
    <View style={styles.rich}>
      {lines.map((line, index) => {
        const trimmed = line.trim();
        if (!trimmed) return <View key={index} style={styles.gap} />;
        const heading = /^#{1,6}\s+/.exec(trimmed);
        if (heading) {
          return (
            <Text key={index} style={[type.headline, styles.label]}>
              {inline(trimmed.slice(heading[0].length))}
            </Text>
          );
        }
        const bullet = /^([-*•]|\d+[.)])\s+/.exec(trimmed);
        if (bullet) {
          return (
            <View key={index} style={styles.bullet}>
              <Text style={[type.body, styles.secondary]}>{/^\d/.test(bullet[0]) ? bullet[0].trim() : '•'}</Text>
              <Text style={[type.body, styles.label, styles.flex]}>{inline(trimmed.slice(bullet[0].length))}</Text>
            </View>
          );
        }
        return (
          <Text key={index} style={[type.body, styles.label]}>
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
  mine: { alignItems: 'flex-end', paddingLeft: space.xxxl },
  mineBubble: { backgroundColor: colors.accent, paddingHorizontal: space.lg, paddingVertical: 10, borderRadius: 20, borderCurve: 'continuous' },
  mineText: { color: 'white' },
  reply: { gap: space.md },
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
