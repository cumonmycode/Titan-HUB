import { SymbolView } from 'expo-symbols';
import { Fragment, memo, useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, Share, StyleSheet, View } from 'react-native';
import type { SFSymbol } from 'sf-symbols-typescript';
import Animated, { Easing, FadeIn, FadeInDown, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

import { Text } from '@/components/text';
import { haptic } from '@/lib/haptics';
import { mixColor, useAuraPalette, withAlpha, type TaiMarkState } from '@/lib/tai-aura';
import { speakTai } from '@/lib/tai-api';
import { REVEAL_MS, useTaiStore, type TaiMessage, type TaiReply } from '@/lib/tai-store';
import { playTaiSample } from '@/lib/tai-voice';
import { colors, space, type } from '@/lib/theme';

import { ShimmerText } from './aura';
import { TaiBlockView } from './blocks';
import { TaiMark } from './mark';

const SPEAK_MAX = 600;
/** Сколько знак светится «готово» после ответа, мс. */
const DONE_MS = 1200;
/** Доля «остывания», за которую слово проявляется из прозрачного в цвет. */
const APPEAR = 0.3;

/** Сообщение диалога, как в Gemini: вопрос — серым пузырём справа, ответ Tai — со знаком, текстом и блоками во всю ширину. */
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
  const pal = useAuraPalette();
  // Голосом — показываем только уже озвученное (как субтитры), остальное — когда дойдёт звук.
  const text = reply.gate ? reply.text.slice(0, reply.gate.chars).trim() : reply.text;
  const blocks = reply.gate ? reply.blocks.slice(0, reply.gate.blocks) : reply.blocks;
  const status = reply.gate && reply.streaming && !reply.status ? 'Tai отвечает…' : reply.status;
  const live = reply.streaming || !!reply.gate;
  const finished = !live;
  const mark = useReplyMark(reply, live, !!text);
  const now = useNowWhileFresh(reply.reveal, live);
  const reveal = reply.reveal?.length ? { chunks: reply.reveal, now, violet: pal.violet, label: pal.label } : null;

  return (
    <Animated.View entering={FadeIn.duration(200)} style={styles.replyRow}>
      <TaiMark size={28} state={mark} style={styles.mark} />
      <View style={styles.reply}>
        {text ? <RichText text={text} selectable={finished} reveal={reveal} tail={live && !status ? <Ember /> : null} /> : null}
        {blocks.map((block, index) => (
          <Animated.View key={index} entering={FadeInDown.duration(260).easing(Easing.out(Easing.cubic))}>
            <TaiBlockView block={block} />
          </Animated.View>
        ))}
        {live && status ? <ShimmerText text={status} style={type.subhead} /> : null}
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

/** Состояние знака у ответа: думает (статус), пишет (идёт текст), короткая вспышка «готово», покой. */
function useReplyMark(reply: TaiReply, live: boolean, hasText: boolean): TaiMarkState {
  const [justDone, setJustDone] = useState(false);
  const wasLive = useRef(live);
  useEffect(() => {
    const was = wasLive.current;
    wasLive.current = live;
    if (!was || live || reply.error) return;
    const on = setTimeout(() => setJustDone(true), 0);
    const off = setTimeout(() => setJustDone(false), DONE_MS);
    return () => {
      clearTimeout(on);
      clearTimeout(off);
    };
  }, [live, reply.error]);
  if (reply.error) return 'idle';
  if (live) return reply.status || !hasText ? 'think' : 'write';
  return justDone ? 'done' : 'idle';
}

/** Текущее время ~30 раз в секунду, пока есть «остывающие» слова; потом часы стоят. */
function useNowWhileFresh(chunks: TaiReply['reveal'], live: boolean) {
  const [now, setNow] = useState(0);
  const last = chunks?.at(-1)?.t ?? 0;
  const ticking = live || (last > 0 && now - last < REVEAL_MS);
  useEffect(() => {
    if (!ticking) return;
    let frame = 0;
    let prev = 0;
    const loop = (ts: number) => {
      if (ts - prev > 33) {
        prev = ts;
        setNow(Date.now());
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [ticking]);
  return now;
}

/** Огонёк за последним словом, пока Tai пишет. */
function Ember() {
  const pal = useAuraPalette();
  const reduce = useReducedMotion();
  const t = useSharedValue(0);
  useEffect(() => {
    if (!reduce) t.set(withRepeat(withTiming(1, { duration: 550, easing: Easing.inOut(Easing.sin) }), -1, true));
  }, [reduce, t]);
  const style = useAnimatedStyle(() => ({ opacity: 0.55 + 0.45 * t.get(), transform: [{ scale: 0.8 + 0.3 * t.get() }] }));
  return <Animated.View style={[styles.ember, { backgroundColor: pal.violet, boxShadow: `0 0 8px 2px ${withAlpha(pal.rose, 0.7)}` }, style]} />;
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

/** Свежие слова ответа: когда пришли и в какие цвета «остывают». */
type Reveal = { chunks: { at: number; t: number }[]; now: number; violet: string; label: string };

/** Цвет слова по возрасту: проявляется фиолетовым из прозрачного и остывает до цвета текста. */
function revealColor(reveal: Reveal, age: number) {
  const k = age / REVEAL_MS;
  return k < APPEAR ? withAlpha(reveal.violet, Math.max(0, k) / APPEAR) : mixColor(reveal.violet, reveal.label, (k - APPEAR) / (1 - APPEAR));
}

/** Кусок строки с «остывающими» словами: всё, что пришло раньше свежих кусков, — обычным цветом. */
function aged(str: string, start: number, reveal: Reveal | null | undefined): ReactNode {
  if (!reveal || !str) return str;
  const fresh = reveal.chunks.filter((chunk) => reveal.now - chunk.t < REVEAL_MS);
  const first = fresh[0];
  const end = start + str.length;
  if (!first || first.at >= end) return str;
  const pieces: ReactNode[] = [];
  let cursor = start;
  if (first.at > start) {
    pieces.push(str.slice(0, first.at - start));
    cursor = first.at;
  }
  fresh.forEach((chunk, i) => {
    const to = Math.min(end, fresh[i + 1]?.at ?? end);
    const from = Math.max(cursor, chunk.at);
    if (to <= from) return;
    pieces.push(
      <Text key={`${from}-${to}`} style={{ color: revealColor(reveal, reveal.now - chunk.t) }}>
        {str.slice(from - start, to - start)}
      </Text>,
    );
    cursor = to;
  });
  return pieces;
}

/**
 * Ответ модели приходит лёгкой разметкой: **жирный**, заголовки и списки. Пока Tai пишет,
 * новые слова проступают цветом (`reveal`), а за последним светится огонёк (`tail`).
 */
export function RichText({ text, selectable, reveal, tail }: { text: string; selectable?: boolean; reveal?: Reveal | null; tail?: ReactNode }) {
  const lines = text.split('\n');
  const lastLine = lines.reduce((last, line, index) => (line.trim() ? index : last), -1);
  const starts = lines.reduce<number[]>((acc, line, index) => [...acc, index === 0 ? 0 : acc[index - 1]! + lines[index - 1]!.length + 1], []);
  return (
    <View style={styles.rich}>
      {lines.map((line, index) => {
        const trimmed = line.trim();
        if (!trimmed) return <View key={index} style={styles.gap} />;
        const lineStart = starts[index]! + (line.length - line.trimStart().length);
        const end = index === lastLine ? tail : null;
        const heading = /^#{1,6}\s+/.exec(trimmed);
        if (heading) {
          return (
            <Text key={index} selectable={selectable} style={[type.headline, styles.label]}>
              {inline(trimmed.slice(heading[0].length), lineStart + heading[0].length, reveal)}
              {end}
            </Text>
          );
        }
        const bullet = /^([-*•]|\d+[.)])\s+/.exec(trimmed);
        if (bullet) {
          return (
            <View key={index} style={styles.bullet}>
              <Text style={[type.body, styles.secondary]}>{/^\d/.test(bullet[0]) ? bullet[0].trim() : '•'}</Text>
              <Text selectable={selectable} style={[type.body, styles.label, styles.flex]}>
                {inline(trimmed.slice(bullet[0].length), lineStart + bullet[0].length, reveal)}
                {end}
              </Text>
            </View>
          );
        }
        return (
          <Text key={index} selectable={selectable} style={[type.body, styles.label]}>
            {inline(trimmed, lineStart, reveal)}
            {end}
          </Text>
        );
      })}
    </View>
  );
}

function inline(line: string, start: number, reveal?: Reveal | null) {
  const parts = line.split('**');
  const offsets = parts.reduce<number[]>((acc, _part, index) => [...acc, index === 0 ? start : acc[index - 1]! + parts[index - 1]!.length + 2], []);
  return parts.map((part, index) =>
    index % 2 === 1 ? (
      <Text key={index} style={styles.bold}>
        {aged(part, offsets[index]!, reveal)}
      </Text>
    ) : (
      <Fragment key={index}>{aged(part, offsets[index]!, reveal)}</Fragment>
    ),
  );
}

const styles = StyleSheet.create({
  mine: { alignItems: 'flex-end', paddingLeft: space.xxxl + space.lg },
  mineBubble: { backgroundColor: colors.fill, paddingHorizontal: space.lg, paddingVertical: 11, borderRadius: 22, borderTopRightRadius: 8, borderCurve: 'continuous' },
  mineText: { color: colors.label },
  replyRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  mark: { marginTop: -4 },
  reply: { flex: 1, minWidth: 0, gap: space.md },
  actions: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginLeft: -8 },
  action: { width: 36, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 16 },
  pressed: { opacity: 0.5 },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  rich: { gap: 3 },
  gap: { height: space.xs },
  bullet: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
  flex: { flex: 1, minWidth: 0 },
  label: { color: colors.label },
  secondary: { color: colors.secondaryLabel },
  bold: { fontWeight: '700' },
  ember: { width: 9, height: 9, borderRadius: 5, marginLeft: 4 },
});
