import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';

import { AppRefreshControl } from '@/components/refresh-control';
import { BigButton, Card, Composer, EmptyNote, ErrorBanner, PostRow, ProgressBanner, SectionTitle, Thread } from '@/components/smm/parts';
import { Text } from '@/components/text';
import { ApiError } from '@/lib/api';
import { promptText } from '@/lib/dialog';
import { haptic } from '@/lib/haptics';
import { usePageGutter } from '@/lib/layout';
import { useClubKey } from '@/lib/queries';
import { FORMAT_LABEL, busyText, monthTitle, msk, planAction, shiftMonth, swapPosts, todayMsk, useSmmPlan, type SmmPost } from '@/lib/smm-api';
import { colors, space, type, useAccentHex } from '@/lib/theme';

const PILLAR_COLORS = ['#8B5CF6', '#30B0C7', '#FF9F0A', '#34C759', '#FF375F', '#5E5CE6', '#A2845E'];

/**
 * План месяца: стратегия, цели, рубрики и календарь публикаций по неделям. План
 * утверждают — после этого Tai начинает готовить посты. Замечание к плану (перенеси,
 * добавь, убери, больше рилс) Tai применяет сам и отвечает, что поменял. «Порядок» —
 * поменять публикации местами (время выхода). Невыкладываемые остаются серыми.
 */
export default function SmmPlanScreen() {
  const params = useLocalSearchParams<{ month?: string }>();
  const router = useRouter();
  const club = useClubKey();
  const gutter = usePageGutter();
  const accent = useAccentHex();
  const [month, setMonth] = useState(params.month ?? todayMsk().slice(0, 7));
  const query = useSmmPlan(month);
  const [pulling, setPulling] = useState(false);
  const [acting, setActing] = useState<string | null>(null);
  const [ordering, setOrdering] = useState(false);
  const [swapping, setSwapping] = useState<string | null>(null);
  const plan = query.data?.plan;
  const posts = query.data?.posts ?? [];
  const live = posts.filter((p) => p.status !== 'skipped');
  const busy = plan?.busy ?? null;
  const pastMonth = month < todayMsk().slice(0, 7);

  const act = async (name: 'generate' | 'approve' | 'remark', body?: unknown) => {
    setActing(name);
    try {
      await planAction(club, month, name, body);
      haptic.success();
    } catch (error) {
      Alert.alert('Не получилось', error instanceof ApiError ? error.message : String(error));
    } finally {
      setActing(null);
    }
  };

  const generate = () =>
    promptText(
      plan?.summary ? 'Пересоставить план?' : 'Составить план',
      `${plan?.summary ? 'Темы, которые ещё не написаны, Tai заменит. Одобренные и вышедшие останутся. ' : ''}Есть пожелания на месяц? (необязательно)`,
      [
        { text: 'Отмена', style: 'cancel' },
        { text: plan?.summary ? 'Пересоставить' : 'Составить', onPress: (wishes?: string) => void act('generate', { wishes: wishes?.trim() || undefined }) },
      ],
    );

  const counts = countBy(live);

  /** Поменять с соседней невышедшей публикацией (выше или ниже по времени). */
  const movable = posts.filter((p) => p.status !== 'published' && p.publishAt);
  const move = async (post: SmmPost, delta: -1 | 1) => {
    const i = movable.findIndex((p) => p.id === post.id);
    const other = movable[i + delta];
    if (!other) return;
    haptic.selection();
    setSwapping(post.id);
    try {
      await swapPosts(club, post.id, other.id);
    } catch (error) {
      Alert.alert('Не поменялось', error instanceof ApiError ? error.message : String(error));
    } finally {
      setSwapping(null);
    }
  };
  const arrows = (post: SmmPost) => {
    if (!ordering || post.status === 'published' || !post.publishAt) return null;
    const i = movable.findIndex((p) => p.id === post.id);
    return (
      <View style={styles.arrows}>
        <Pressable onPress={() => void move(post, -1)} disabled={i <= 0 || !!swapping} hitSlop={4} style={[styles.arrow, (i <= 0 || !!swapping) && styles.off]} accessibilityRole="button" accessibilityLabel="Раньше">
          <SymbolView name="chevron.up" size={16} tintColor={accent} />
        </Pressable>
        <Pressable onPress={() => void move(post, 1)} disabled={i >= movable.length - 1 || !!swapping} hitSlop={4} style={[styles.arrow, (i >= movable.length - 1 || !!swapping) && styles.off]} accessibilityRole="button" accessibilityLabel="Позже">
          <SymbolView name="chevron.down" size={16} tintColor={accent} />
        </Pressable>
      </View>
    );
  };

  return (
    <View style={styles.screen}>
      <Stack.Title>План</Stack.Title>
      <KeyboardAvoidingView behavior="padding" style={styles.flex}>
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={[styles.content, gutter]}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <AppRefreshControl
              tintColor={colors.accent}
              refreshing={pulling}
              onRefresh={() => {
                setPulling(true);
                void query.refetch().finally(() => setPulling(false));
              }}
            />
          }>
          <View style={styles.monthNav}>
            <Pressable onPress={() => setMonth(shiftMonth(month, -1))} hitSlop={12} accessibilityRole="button" accessibilityLabel="Прошлый месяц">
              <SymbolView name="chevron.left" size={18} tintColor={accent} />
            </Pressable>
            <Text style={[type.title2, styles.label]}>{monthTitle(month)}</Text>
            <Pressable onPress={() => setMonth(shiftMonth(month, 1))} hitSlop={12} accessibilityRole="button" accessibilityLabel="Следующий месяц">
              <SymbolView name="chevron.right" size={18} tintColor={accent} />
            </Pressable>
          </View>

          {busy ? <ProgressBanner progress={plan?.progress ?? null} text={busyText[busy]} /> : null}
          {plan?.error && !busy ? <ErrorBanner text={plan.error} /> : null}

          {query.isLoading ? (
            <ActivityIndicator style={styles.loading} />
          ) : !plan?.summary ? (
            busy ? null : (
              <EmptyNote
                icon="calendar.badge.plus"
                title={pastMonth ? 'Плана на этот месяц не было' : 'Плана пока нет'}
                text="Tai изучит клуб — вечера, турниры, мероприятия, бар, что заходило в соцсетях — и распишет месяц: стратегию, рубрики и темы по дням для Telegram и Instagram."
                action={pastMonth ? undefined : 'Составить план'}
                onAction={generate}
              />
            )
          ) : (
            <>
              <Card>
                <View style={styles.statusRow}>
                  <SymbolView name={plan.status === 'active' ? 'checkmark.seal.fill' : 'pencil.circle'} size={18} tintColor={plan.status === 'active' ? colors.green : colors.orange} />
                  <Text style={[type.subhead, styles.label, styles.flex]}>{plan.status === 'active' ? 'Утверждён — Tai готовит посты заранее' : 'Черновик — утверди, и Tai начнёт готовить посты'}</Text>
                </View>
                <Text style={[type.headline, styles.label]}>Стратегия</Text>
                <Text style={[type.body, styles.label]} selectable>
                  {plan.summary}
                </Text>
                {plan.goals.length ? (
                  <View style={styles.goals}>
                    <Text style={[type.headline, styles.label]}>Цели</Text>
                    {plan.goals.map((g) => (
                      <View key={g} style={styles.goal}>
                        <SymbolView name="target" size={15} tintColor={accent} />
                        <Text style={[type.subhead, styles.label, styles.flex]}>{g}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}
              </Card>

              {plan.pillars.length ? (
                <Card>
                  <Text style={[type.headline, styles.label]}>Рубрики</Text>
                  <View style={styles.bar}>
                    {plan.pillars.map((p, i) => (
                      <View key={p.key} style={{ flex: Math.max(p.share, 3), backgroundColor: PILLAR_COLORS[i % PILLAR_COLORS.length] }} />
                    ))}
                  </View>
                  {plan.pillars.map((p, i) => (
                    <View key={p.key} style={styles.pillar}>
                      <View style={[styles.swatch, { backgroundColor: PILLAR_COLORS[i % PILLAR_COLORS.length] }]} />
                      <View style={styles.flex}>
                        <Text style={[type.subhead, styles.label, styles.bold]}>{`${p.title} · ${Math.round(p.share)}%`}</Text>
                        {p.about ? <Text style={[type.footnote, styles.secondary]}>{p.about}</Text> : null}
                      </View>
                    </View>
                  ))}
                </Card>
              ) : null}

              {plan.status === 'draft' && !pastMonth ? <BigButton title="Утвердить план" icon="checkmark.seal" busy={acting === 'approve'} disabled={!!busy} onPress={() => void act('approve')} /> : null}

              <SectionTitle title={`Публикации · ${live.length}`} action={pastMonth || busy || ordering ? undefined : 'Пересоставить'} onAction={generate} />
              <View style={styles.countsRow}>
                <Text style={[type.footnote, styles.secondary, styles.flex]}>{ordering ? 'Стрелки меняют публикацию местами с соседней: время выхода переходит к ней.' : counts}</Text>
                {!pastMonth && movable.length > 1 ? (
                  <Pressable
                    onPress={() => {
                      haptic.selection();
                      setOrdering((v) => !v);
                    }}
                    hitSlop={8}
                    accessibilityRole="button">
                    <Text style={[type.subhead, styles.bold, { color: accent }]}>{ordering ? 'Готово' : 'Порядок'}</Text>
                  </Pressable>
                ) : null}
              </View>
              {weeks(posts).map(([label, list]) => (
                <View key={label} style={styles.week}>
                  <Text style={[type.footnote, styles.weekTitle]}>{label.toUpperCase()}</Text>
                  {list.map((post) => (
                    <PostRow key={post.id} post={post} showDay trailing={arrows(post)} onPress={() => router.push({ pathname: '/manage/smm/post', params: { id: post.id } })} />
                  ))}
                </View>
              ))}

              <Text style={[type.title3, styles.label, styles.remarks]}>Замечания к плану</Text>
              <Thread comments={query.data?.comments ?? []} />
              <Composer placeholder="Перенеси, добавь, убери, больше рилс про школу…" disabled={!!busy} onSend={(text) => act('remark', { text })} />
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function countBy(posts: SmmPost[]): string {
  const tg = posts.filter((p) => p.platform === 'telegram' && p.format !== 'story').length;
  const ig = posts.filter((p) => p.platform === 'instagram' && (p.format === 'post' || p.format === 'carousel')).length;
  const reels = posts.filter((p) => p.format === 'reel').length;
  const stories = posts.filter((p) => p.format === 'story').length;
  return [`Telegram ${tg}`, `Instagram ${ig}`, `${FORMAT_LABEL.reel} ${reels}`, `${FORMAT_LABEL.story} ${stories}`].join(' · ');
}

/** Публикации по неделям месяца: «1–7 октября». */
function weeks(posts: SmmPost[]): [string, SmmPost[]][] {
  const out = new Map<string, SmmPost[]>();
  for (const post of posts) {
    const m = msk(post.publishAt);
    if (!m) continue;
    const day = Number(m.date.slice(8, 10));
    const start = Math.floor((day - 1) / 7) * 7 + 1;
    const end = Math.min(start + 6, 31);
    const label = `${start}–${end} ${['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'][m.month]}`;
    out.set(label, [...(out.get(label) ?? []), post]);
  }
  return [...out.entries()];
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.groupedBackground },
  flex: { flex: 1, minWidth: 0 },
  content: { gap: space.md, paddingTop: space.md, paddingBottom: space.xxxl },
  label: { color: colors.label },
  secondary: { color: colors.secondaryLabel },
  bold: { fontWeight: '600' },
  loading: { marginTop: space.xxl },
  monthNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.xs },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  goals: { gap: space.sm },
  goal: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  bar: { flexDirection: 'row', height: 10, borderRadius: 5, overflow: 'hidden', gap: 2 },
  pillar: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  swatch: { width: 10, height: 10, borderRadius: 5, marginTop: 5 },
  week: { gap: space.sm },
  weekTitle: { color: colors.secondaryLabel, fontWeight: '600', marginTop: space.xs, marginLeft: space.xs },
  remarks: { marginTop: space.md },
  countsRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  arrows: { gap: space.xs },
  arrow: { width: 36, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.fill },
  off: { opacity: 0.3 },
});
