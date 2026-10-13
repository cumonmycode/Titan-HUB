import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, type ColorValue, type StyleProp, type ViewStyle } from 'react-native';
import type { SFSymbol } from 'sf-symbols-typescript';

import { Text, TextInput } from '@/components/text';
import { haptic } from '@/lib/haptics';
import {
  FORMAT_ICON,
  FORMAT_LABEL,
  PLATFORM_LOOK,
  msk,
  progressLeft,
  progressPercent,
  selectedMedia,
  statusLook,
  type SmmComment,
  type SmmPost,
  type SmmProgress,
} from '@/lib/smm-api';
import { colors, radius, space, type, useAccentHex } from '@/lib/theme';

/**
 * Общие куски раздела «СММ»: карточки публикаций, статусы, кнопки, поле замечания и
 * переписка с Tai. Оформление — системное, акцент один; цвета площадок — только у значков.
 */

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function SectionTitle({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  const accent = useAccentHex();
  return (
    <View style={styles.sectionTitle}>
      <Text style={[type.title3, styles.label]} accessibilityRole="header">
        {title}
      </Text>
      {action && onAction ? (
        <Pressable
          onPress={() => {
            haptic.selection();
            onAction();
          }}
          hitSlop={10}
          accessibilityRole="button">
          <Text style={[type.subhead, { color: accent }]}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function StatusPill({ post }: { post: Pick<SmmPost, 'status' | 'platform' | 'format' | 'handoffAt' | 'publishedUrl' | 'busy'> }) {
  const look = statusLook(post);
  return (
    <View style={[styles.pill, { backgroundColor: `${look.color}22` }]}>
      {post.busy && post.busy !== 'video' ? <ActivityIndicator size="small" color={look.color} style={styles.pillSpinner} /> : null}
      <Text style={[type.caption1, styles.pillText, { color: look.color }]} numberOfLines={1}>
        {look.label}
      </Text>
    </View>
  );
}

/** Значок площадки в цвете сети. */
export function PlatformBadge({ platform, size = 22 }: { platform: keyof typeof PLATFORM_LOOK; size?: number }) {
  const look = PLATFORM_LOOK[platform];
  return (
    <View style={[styles.badge, { width: size, height: size, borderRadius: size / 2, backgroundColor: look.color }]}>
      <SymbolView name={look.icon} size={size * 0.52} tintColor="white" />
    </View>
  );
}

/** Миниатюра: первая картинка публикации, видео — со значком, без визуала — значок формата. */
export function PostThumb({ post, size, width, height }: { post: SmmPost; size?: number; width?: number; height?: number }) {
  const media = selectedMedia(post);
  const image = media.find((m) => m.kind === 'image' && m.url);
  const hasVideo = media.some((m) => m.kind === 'video');
  const pending = media.some((m) => m.status === 'pending') || post.busy === 'image' || post.busy === 'text';
  const w = width ?? size ?? 64;
  const h = height ?? size ?? 64;
  return (
    <View style={[styles.thumb, { width: w, height: h }]}>
      {image?.url ? (
        <Image source={{ uri: image.url }} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} recyclingKey={image.id} />
      ) : (
        <SymbolView name={FORMAT_ICON[post.format]} size={Math.min(w, h) * 0.36} tintColor={colors.tertiaryLabel} />
      )}
      {hasVideo ? (
        <View style={styles.play}>
          <SymbolView name="play.fill" size={12} tintColor="white" />
        </View>
      ) : null}
      {pending ? (
        <View style={styles.thumbBusy}>
          <ActivityIndicator color="white" />
        </View>
      ) : null}
    </View>
  );
}

const fmt = (n: number) => n.toLocaleString('ru-RU');

/** Прогноз и факт одной строкой: «👁 310 · прогноз 220» или «Прогноз ~220 просмотров». */
export function forecastLine(post: Pick<SmmPost, 'status' | 'stats' | 'forecast'>): { text: string; color: ColorValue } | null {
  const views = post.stats.views;
  const f = post.forecast;
  if (post.status === 'published' && typeof views === 'number') {
    if (!f) return { text: `👁 ${fmt(views)}`, color: colors.secondaryLabel };
    const color = views > f.high ? colors.green : views < f.low ? colors.orange : colors.secondaryLabel;
    return { text: `👁 ${fmt(views)} · прогноз ${fmt(f.expected)}`, color };
  }
  if (post.status === 'skipped' || !f) return null;
  return { text: `Прогноз ~${fmt(f.expected)} просмотров`, color: colors.secondaryLabel };
}

/** Строка ленты: картинка, тема, площадка/формат/время, статус, прогноз и шкала работы Tai. */
export function PostRow({ post, onPress, showDay, trailing }: { post: SmmPost; onPress: () => void; showDay?: boolean; trailing?: ReactNode }) {
  const when = msk(post.publishAt);
  const meta = [PLATFORM_LOOK[post.platform].label, FORMAT_LABEL[post.format], when ? (showDay ? `${when.day}.${String(when.month + 1).padStart(2, '0')} ${when.time}` : when.time) : null]
    .filter(Boolean)
    .join(' · ');
  const result = forecastLine(post);
  return (
    <Pressable
      onPress={() => {
        haptic.selection();
        onPress();
      }}
      style={({ pressed }) => [styles.row, post.status === 'skipped' && styles.skipped, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`${post.topic}. ${meta}. ${statusLook(post).label}${result ? `. ${result.text}` : ''}`}>
      <PostThumb post={post} size={64} />
      <View style={styles.rowText}>
        <View style={styles.rowMeta}>
          <PlatformBadge platform={post.platform} size={18} />
          <Text style={[type.footnote, styles.secondary]} numberOfLines={1}>
            {meta}
          </Text>
        </View>
        <Text style={[type.headline, styles.label, post.status === 'skipped' && styles.struck]} numberOfLines={2}>
          {post.topic}
        </Text>
        <View style={styles.rowMeta}>
          <StatusPill post={post} />
          {result ? (
            <Text style={[type.caption1, { color: result.color }]} numberOfLines={1}>
              {result.text}
            </Text>
          ) : null}
        </View>
        {post.busy && post.progress ? <MiniProgress progress={post.progress} /> : null}
      </View>
      {trailing}
    </Pressable>
  );
}

/** Текущее время, пока идёт работа (шкала двигается между опросами сервера). */
function useNow(active: boolean, every = 250): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(id);
  }, [active, every]);
  return now;
}

/** Шкала без подписей — в строке ленты. */
function MiniProgress({ progress }: { progress: SmmProgress }) {
  const now = useNow(true, 500);
  return <ProgressBar value={progressPercent(progress, now)} thin />;
}

export function ProgressBar({ value, thin }: { value: number; thin?: boolean }) {
  const accent = useAccentHex();
  return (
    <View style={[styles.track, thin && styles.trackThin]}>
      <View style={[styles.fill, { width: `${Math.max(2, Math.min(100, value))}%`, backgroundColor: accent }]} />
    </View>
  );
}

const leftText = (sec: number) => (sec >= 90 ? `${Math.round(sec / 60)} мин` : `${sec} с`);

/**
 * Шкала готовности: что делает Tai, процент и сколько примерно осталось. Без шкалы
 * (старая задача) — просто строка с крутилкой.
 */
export function ProgressBanner({ progress, text }: { progress: SmmProgress | null; text?: string }) {
  const accent = useAccentHex();
  const now = useNow(!!progress);
  if (!progress) return text ? <BusyBanner text={text} /> : null;
  const pct = progressPercent(progress, now);
  const left = progressLeft(progress, now);
  return (
    <View style={[styles.progressBox, { backgroundColor: `${accent}14` }]} accessibilityLiveRegion="polite" accessibilityLabel={`${progress.label}, ${Math.round(pct)} процентов`}>
      <View style={styles.progressHead}>
        <ActivityIndicator size="small" color={accent} />
        <Text style={[type.subhead, styles.label, styles.flex]} numberOfLines={2}>
          {progress.label}
        </Text>
        <Text style={[type.subhead, styles.bold, { color: accent }]}>{`${Math.round(pct)}%`}</Text>
      </View>
      <ProgressBar value={pct} />
      <Text style={[type.caption1, styles.secondary]}>{left > 3 ? `Осталось около ${leftText(left)}` : 'Почти готово…'}</Text>
    </View>
  );
}

/** Шкала для запроса, который приложение ждёт само (идеи, отчёт): этап начинается сейчас. */
export const estimate = (label: string, eta: number): SmmProgress => ({ label, pct: 2, next: 96, eta, at: new Date().toISOString() });

export function BusyBanner({ text }: { text: string }) {
  const accent = useAccentHex();
  return (
    <View style={[styles.banner, { backgroundColor: `${accent}1A` }]} accessibilityLiveRegion="polite">
      <ActivityIndicator color={accent} />
      <Text style={[type.subhead, styles.label, styles.flex]}>{text}</Text>
    </View>
  );
}

export function ErrorBanner({ text }: { text: string }) {
  return (
    <View style={[styles.banner, styles.errorBanner]}>
      <SymbolView name="exclamationmark.triangle.fill" size={18} tintColor={colors.red} />
      <Text style={[type.subhead, styles.label, styles.flex]}>{text}</Text>
    </View>
  );
}

type ButtonTone = 'accent' | 'plain' | 'destructive';

/** Крупная кнопка-капсула: главное действие экрана или вторичное рядом. */
export function BigButton({ title, icon, tone = 'accent', busy, disabled, onPress, style }: { title: string; icon?: SFSymbol; tone?: ButtonTone; busy?: boolean; disabled?: boolean; onPress: () => void; style?: StyleProp<ViewStyle> }) {
  const accent = useAccentHex();
  const bg = tone === 'accent' ? accent : colors.fill;
  const fg = tone === 'accent' ? 'white' : tone === 'destructive' ? colors.red : accent;
  return (
    <Pressable
      onPress={() => {
        if (busy || disabled) return;
        haptic.light();
        onPress();
      }}
      style={({ pressed }) => [styles.bigButton, { backgroundColor: bg }, (pressed || disabled) && styles.pressed, style]}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled, busy: !!busy }}>
      {busy ? <ActivityIndicator color={fg as string} /> : icon ? <SymbolView name={icon} size={17} tintColor={fg} /> : null}
      <Text style={[type.headline, { color: fg }]} numberOfLines={1}>
        {title}
      </Text>
    </Pressable>
  );
}

/** Маленькая кнопка-чип с значком: «Новая картинка», «Скопировать». */
export function ChipButton({ title, icon, onPress, disabled }: { title: string; icon: SFSymbol; onPress: () => void; disabled?: boolean }) {
  const accent = useAccentHex();
  return (
    <Pressable
      onPress={() => {
        if (disabled) return;
        haptic.selection();
        onPress();
      }}
      style={({ pressed }) => [styles.chip, (pressed || disabled) && styles.pressed]}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}>
      <SymbolView name={icon} size={15} tintColor={accent} />
      <Text style={[type.subhead, { color: accent }]} numberOfLines={1}>
        {title}
      </Text>
    </Pressable>
  );
}

/** Поле замечания для Tai: пишешь, что поправить, — Tai переделывает и отвечает. */
export function Composer({ placeholder, onSend, disabled }: { placeholder: string; onSend: (text: string) => Promise<void> | void; disabled?: boolean }) {
  const accent = useAccentHex();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const canSend = text.trim().length >= 2 && !sending && !disabled;
  const send = async () => {
    if (!canSend) return;
    setSending(true);
    try {
      await onSend(text.trim());
      setText('');
    } finally {
      setSending(false);
    }
  };
  return (
    <View style={styles.composer}>
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder={placeholder}
        placeholderTextColor={colors.tertiaryLabel}
        selectionColor={colors.accent}
        multiline
        maxLength={1500}
        style={[type.body, styles.composerInput]}
        accessibilityLabel={placeholder}
      />
      <Pressable onPress={() => void send()} disabled={!canSend} hitSlop={8} accessibilityRole="button" accessibilityLabel="Отправить Tai">
        {sending ? <ActivityIndicator color={accent} /> : <SymbolView name="arrow.up.circle.fill" size={32} tintColor={canSend ? accent : colors.tertiaryLabel} />}
      </Pressable>
    </View>
  );
}

/** Переписка по публикации или плану: замечания сотрудников и ответы Tai. */
export function Thread({ comments }: { comments: SmmComment[] }) {
  const accent = useAccentHex();
  if (!comments.length) return null;
  return (
    <View style={styles.thread}>
      {comments.map((c) => (
        <View key={c.id} style={[styles.bubble, c.role === 'tai' ? styles.bubbleTai : styles.bubbleStaff]}>
          <View style={styles.bubbleHead}>
            {c.role === 'tai' ? <SymbolView name="sparkles" size={13} tintColor={accent} /> : null}
            <Text style={[type.caption1, { color: c.role === 'tai' ? accent : colors.secondaryLabel }]}>{c.role === 'tai' ? 'Tai' : (c.authorName ?? 'Сотрудник')}</Text>
          </View>
          <Text style={[type.subhead, styles.label]} selectable>
            {c.text}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** Пустое место с пояснением и действием. */
export function EmptyNote({ icon, title, text, action, onAction }: { icon: SFSymbol; title: string; text: string; action?: string; onAction?: () => void }) {
  return (
    <View style={styles.empty}>
      <SymbolView name={icon} size={40} tintColor={colors.tertiaryLabel} />
      <Text style={[type.headline, styles.label, styles.center]}>{title}</Text>
      <Text style={[type.subhead, styles.secondary, styles.center]}>{text}</Text>
      {action && onAction ? <BigButton title={action} onPress={onAction} style={styles.emptyButton} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  label: { color: colors.label },
  secondary: { color: colors.secondaryLabel },
  center: { textAlign: 'center' },
  pressed: { opacity: 0.6 },
  skipped: { opacity: 0.5 },
  struck: { textDecorationLine: 'line-through' },
  bold: { fontWeight: '600' },
  track: { height: 6, borderRadius: 3, overflow: 'hidden', backgroundColor: colors.fill },
  trackThin: { height: 3, borderRadius: 1.5, marginTop: 2 },
  fill: { height: '100%', borderRadius: 3 },
  progressBox: { gap: space.sm, padding: space.md, borderRadius: 14, borderCurve: 'continuous' },
  progressHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  card: { backgroundColor: colors.card, borderRadius: radius.card, borderCurve: 'continuous', padding: space.lg, gap: space.md },
  sectionTitle: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: space.md },
  pill: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  pillText: { fontWeight: '600' },
  pillSpinner: { transform: [{ scale: 0.6 }], marginVertical: -6, marginLeft: -4, marginRight: -2 },
  badge: { alignItems: 'center', justifyContent: 'center' },
  thumb: { borderRadius: 12, borderCurve: 'continuous', overflow: 'hidden', backgroundColor: colors.fill, alignItems: 'center', justifyContent: 'center' },
  play: { position: 'absolute', right: 5, bottom: 5, width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  thumbBusy: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', gap: space.md, padding: space.md, borderRadius: 18, borderCurve: 'continuous', backgroundColor: colors.card, alignItems: 'center' },
  rowText: { flex: 1, minWidth: 0, gap: 4 },
  rowMeta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: 14, borderCurve: 'continuous' },
  errorBanner: { backgroundColor: 'rgba(255,59,48,0.12)' },
  bigButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm, height: 50, borderRadius: 25, paddingHorizontal: space.xl },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.md, height: 36, borderRadius: 18, backgroundColor: colors.fill },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm, paddingLeft: space.md, paddingRight: 6, paddingVertical: 6, borderRadius: 22, borderCurve: 'continuous', backgroundColor: colors.card },
  composerInput: { flex: 1, color: colors.label, maxHeight: 140, paddingVertical: 6 },
  thread: { gap: space.sm },
  bubble: { padding: space.md, borderRadius: 16, borderCurve: 'continuous', gap: 4, maxWidth: '92%' },
  bubbleTai: { alignSelf: 'flex-start', backgroundColor: colors.card },
  bubbleStaff: { alignSelf: 'flex-end', backgroundColor: colors.fill },
  bubbleHead: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  empty: { alignItems: 'center', gap: space.sm, paddingVertical: space.xxl, paddingHorizontal: space.lg },
  emptyButton: { marginTop: space.md, alignSelf: 'stretch' },
});
