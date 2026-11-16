import { Stack, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import type { SFSymbol } from 'sf-symbols-typescript';

import { GlassView } from '@/components/glass';
import { AppRefreshControl } from '@/components/refresh-control';
import { Appear, PressScale } from '@/components/smm/motion';
import { PostThumb, ProgressBanner } from '@/components/smm/parts';
import { TaiMark } from '@/components/tai/mark';
import { Text } from '@/components/text';
import { ToolbarButton } from '@/components/toolbar';
import { haptic } from '@/lib/haptics';
import { usePageGutter } from '@/lib/layout';
import { useClubKey } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { busyText, dayTitle, monthTitle, msk, postAction, statusLook, todayMsk, useSmmOverview, type SmmOverview, type SmmPost } from '@/lib/smm-api';
import { colors, space, type } from '@/lib/theme';

/** Сколько дней показывает полоса недели: сегодня и шесть следующих (столько отдаёт сводка). */
const WEEK_DAYS = 7;
const DAY_MS = 86_400_000;
const WEEKDAY_SHORT = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'];
/** Ширина карточки «Ждёт тебя»: две помещаются в экран телефона, остальные — прокруткой. */
const ATTENTION_CARD_WIDTH = 172;

/**
 * «СММ» — штаб соцсетей клуба (макет «2 + 3»): сверху месяц и состояние плана, полоса
 * недели с цветными точками статусов, карточки «Ждёт тебя» с действием прямо на них,
 * посты выбранного дня и инструменты. Каждый пост — в одном месте: то, что ждёт
 * человека, не повторяется в списке дня; новая публикация — только кнопкой «+».
 */
export default function SmmScreen() {
  const router = useRouter();
  const gutter = usePageGutter();
  const overview = useSmmOverview();
  const isOwner = useSession((s) => s.user?.role === 'owner');
  const [pulling, setPulling] = useState(false);
  const [day, setDay] = useState(todayMsk);
  const data = overview.data;

  const open = (post: SmmPost) => router.push({ pathname: '/manage/smm/post', params: { id: post.id } });
  const openPlan = (month: string) => router.push({ pathname: '/manage/smm/plan', params: { month } });

  return (
    <View style={styles.screen}>
      <Stack.Title>СММ</Stack.Title>
      <Stack.Toolbar placement="right">
        <ToolbarButton icon="plus" accessibilityLabel="Новая публикация" onPress={() => router.push('/manage/smm/new')} />
        {isOwner ? <ToolbarButton icon="gearshape" accessibilityLabel="Настройки СММ" onPress={() => router.push('/manage/smm/settings')} /> : null}
      </Stack.Toolbar>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[styles.content, gutter]}
        refreshControl={
          <AppRefreshControl
            tintColor={colors.accent}
            refreshing={pulling}
            onRefresh={() => {
              setPulling(true);
              void overview.refetch().finally(() => setPulling(false));
            }}
          />
        }>
        {!data ? (
          overview.error ? (
            <Text style={[type.body, styles.secondary, styles.center]}>{`Не загрузилось. ${overview.error.message}`}</Text>
          ) : (
            <ActivityIndicator style={styles.loading} />
          )
        ) : (
          <>
            <Appear index={0}>
              <MonthHeader data={data} isOwner={isOwner} onPlan={() => openPlan(data.month)} onSetup={() => router.push('/manage/smm/settings')} />
            </Appear>
            <Appear index={1}>
              <WeekStrip posts={data.upcoming} day={day} onDay={setDay} />
            </Appear>
            <Attention data={data} onOpen={open} onDone={() => void overview.refetch()} />
            <Appear index={3} style={styles.section}>
              <DayPosts posts={data.upcoming} day={day} onOpen={open} />
            </Appear>
            {data.nextPlan?.summary ? (
              <Pressable onPress={() => openPlan(data.nextMonth)} style={({ pressed }) => [styles.nextPlan, pressed && styles.pressed]} accessibilityRole="button">
                <SymbolView name="calendar.badge.clock" size={18} tintColor={colors.accent} />
                <Text style={[type.subhead, styles.label, styles.flex]}>{`План на ${monthWord(data.nextMonth).toLowerCase()} готов${data.nextPlan.status === 'draft' ? ' — утверди' : ''}`}</Text>
                <SymbolView name="chevron.right" size={13} tintColor={colors.tertiaryLabel} />
              </Pressable>
            ) : null}
            <Appear index={4}>
              <View style={styles.tools}>
                <Tool icon="chart.xyaxis.line" color="#5AC8FA" title="Аналитика" onPress={() => router.push('/manage/smm/analytics')} />
                <Tool icon="lightbulb.fill" color="#FFB340" title="Идеи" onPress={() => router.push('/manage/smm/ideas')} />
                <Tool icon="photo.stack.fill" color="#34C759" title="Фото" onPress={() => router.push('/manage/smm/library')} />
                <Tool icon="books.vertical.fill" color="#BF5AF2" title="Знания" onPress={() => router.push('/manage/smm/knowledge')} />
              </View>
            </Appear>
            <Footer data={data} />
          </>
        )}
      </ScrollView>
    </View>
  );
}

const monthWord = (month: string) => monthTitle(month).split(' ')[0] ?? month;

/** Шапка: месяц, состояние плана и площадки одной строкой. Тап — план месяца. */
function MonthHeader({ data, isOwner, onPlan, onSetup }: { data: SmmOverview; isOwner: boolean; onPlan: () => void; onSetup: () => void }) {
  const plan = data.plan;
  const planText = !plan?.summary ? 'Плана нет — составь' : plan.status === 'active' ? 'План утверждён' : 'План ждёт утверждения';
  const followers = data.accounts
    .filter((a) => a.isActive && a.followers != null && (a.platform === 'telegram' || a.platform === 'instagram'))
    .map((a) => `${a.platform === 'telegram' ? 'TG' : 'IG'} ${a.followers!.toLocaleString('ru-RU')}`);
  const line = [planText, `за неделю вышло ${data.counts.publishedWeek}`, ...followers].join(' · ');
  const missing = [!data.ready.channel && 'канал Telegram', !data.ready.instagram && 'Instagram', !data.ready.publisher && 'кто выкладывает Instagram'].filter(Boolean) as string[];

  return (
    <View style={styles.header}>
      <PressScale onPress={onPlan} style={styles.headerPress} accessibilityRole="button" accessibilityLabel={`${monthTitle(data.month)}. ${line}`}>
        <View style={styles.headerRow}>
          <Text style={[styles.month, styles.label]}>{monthWord(data.month)}</Text>
          <TaiMark size={30} breathe />
        </View>
        <Text style={[type.footnote, styles.secondary]} numberOfLines={2}>
          {line}
        </Text>
        {plan?.busy ? <ProgressBanner progress={plan.progress} text={busyText[plan.busy]} /> : null}
      </PressScale>
      {missing.length && isOwner ? (
        <Pressable onPress={onSetup} style={({ pressed }) => [styles.setup, pressed && styles.pressed]} accessibilityRole="button">
          <SymbolView name="exclamationmark.circle.fill" size={18} tintColor={colors.orange} />
          <Text style={[type.subhead, styles.label, styles.flex]}>{`Подключите: ${missing.join(', ')}`}</Text>
          <SymbolView name="chevron.right" size={13} tintColor={colors.tertiaryLabel} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** Неделя от сегодня: под каждым днём точки статусов его публикаций. */
function WeekStrip({ posts, day, onDay }: { posts: SmmPost[]; day: string; onDay: (day: string) => void }) {
  const today = todayMsk();
  const start = Date.parse(`${today}T12:00:00Z`);
  const days = Array.from({ length: WEEK_DAYS }, (_, i) => new Date(start + i * DAY_MS).toISOString().slice(0, 10));
  const byDay = new Map<string, SmmPost[]>();
  for (const post of posts) {
    const date = msk(post.publishAt)?.date;
    if (date && post.status !== 'skipped') byDay.set(date, [...(byDay.get(date) ?? []), post]);
  }

  return (
    <View style={styles.week}>
      {days.map((date) => {
        const selected = date === day;
        const list = byDay.get(date) ?? [];
        const d = new Date(`${date}T12:00:00Z`);
        return (
          <Pressable
            key={date}
            onPress={() => {
              haptic.selection();
              onDay(date);
            }}
            style={[styles.weekDay, selected && styles.weekDaySelected]}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={`${dayTitle(date)}, публикаций: ${list.length}`}>
            <Text style={[type.caption2, styles.weekName, selected && styles.weekNameSelected]}>{WEEKDAY_SHORT[d.getUTCDay()]}</Text>
            <Text style={[type.headline, styles.label, selected && styles.white]}>{d.getUTCDate()}</Text>
            <View style={styles.dots}>
              {list.slice(0, 3).map((post) => (
                <View key={post.id} style={[styles.dot, { backgroundColor: selected ? 'white' : statusLook(post).color }]} />
              ))}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const needsHuman = (p: SmmPost) =>
  p.status === 'failed' || (p.status === 'approved' && !!p.handoffAt && !p.publishedUrl) || (p.status === 'review' && !p.busy);

/** Что ждёт человека: не вышло, ждём ссылку, одобрить. Действие — прямо на карточке. */
function Attention({ data, onOpen, onDone }: { data: SmmOverview; onOpen: (post: SmmPost) => void; onDone: () => void }) {
  const failed = data.upcoming.filter((p) => p.status === 'failed');
  const link = data.upcoming.filter((p) => p.status === 'approved' && p.handoffAt && !p.publishedUrl);
  const review = data.upcoming.filter((p) => p.status === 'review' && !p.busy);
  const items = [...failed, ...link, ...review];
  const busy = data.upcoming.find((p) => p.busy && p.busy !== 'video');
  if (!items.length && !busy) return null;

  return (
    <Appear index={2} style={styles.section}>
      {items.length ? <Text style={[styles.sectionTitle, styles.label]}>{`Ждёт тебя · ${items.length}`}</Text> : null}
      {busy ? <ProgressBanner progress={busy.progress ? { ...busy.progress, label: `«${busy.topic}»: ${busy.progress.label.toLowerCase()}` } : null} text={`«${busy.topic}»: ${busyText[busy.busy!].toLowerCase()}`} /> : null}
      {items.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.attentionRow} style={styles.attentionScroll}>
          {items.map((post) => (
            <AttentionCard key={post.id} post={post} onOpen={() => onOpen(post)} onDone={onDone} />
          ))}
        </ScrollView>
      ) : null}
    </Appear>
  );
}

function AttentionCard({ post, onOpen, onDone }: { post: SmmPost; onOpen: () => void; onDone: () => void }) {
  const club = useClubKey();
  const [busy, setBusy] = useState(false);
  const m = msk(post.publishAt);
  const when = m ? `${m.weekday.toUpperCase()} ${m.time}` : 'без даты';
  const platform = post.platform === 'telegram' ? 'TG' : post.platform === 'instagram' ? 'IG' : '';
  const review = post.status === 'review';
  const button = post.status === 'failed' ? 'Разобраться' : review ? 'Одобрить' : 'Дать ссылку';

  const approve = async () => {
    haptic.medium();
    setBusy(true);
    try {
      await postAction(club, post.id, 'approve');
      haptic.success();
      onDone();
    } catch (error) {
      haptic.error();
      Alert.alert('Не одобрилось', error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <PressScale onPress={onOpen} style={styles.attentionCard} accessibilityRole="button" accessibilityLabel={`${post.topic}, ${statusLook(post).label}`}>
      <View>
        <PostThumb post={post} width={ATTENTION_CARD_WIDTH} height={86} />
        <View style={styles.attentionTag}>
          <Text style={[type.caption2, styles.white, styles.bold]}>{[when, platform].filter(Boolean).join(' · ')}</Text>
        </View>
      </View>
      <View style={styles.attentionBody}>
        <Text style={[type.subhead, styles.label, styles.bold]} numberOfLines={2}>
          {post.topic}
        </Text>
        <Pressable
          disabled={busy}
          onPress={review ? () => void approve() : onOpen}
          style={({ pressed }) => [styles.attentionButton, review ? styles.attentionPrimary : styles.attentionSecondary, pressed && styles.pressed]}
          accessibilityRole="button">
          {busy ? <ActivityIndicator color="white" /> : <Text style={[type.subhead, styles.bold, review ? styles.white : styles.label]}>{button}</Text>}
        </Pressable>
      </View>
    </PressScale>
  );
}

/** Публикации выбранного дня; то, что ждёт человека, уже стоит в «Ждёт тебя». */
function DayPosts({ posts, day, onOpen }: { posts: SmmPost[]; day: string; onOpen: (post: SmmPost) => void }) {
  const list = posts.filter((p) => msk(p.publishAt)?.date === day && p.status !== 'skipped' && !needsHuman(p));
  return (
    <>
      <Text style={[styles.sectionTitle, styles.label]}>{dayTitle(day).split(' · ')[0]}</Text>
      {!list.length ? (
        <Text style={[type.subhead, styles.secondary]}>В этот день других публикаций нет.</Text>
      ) : (
        <GlassView style={styles.dayCard}>
          {list.map((post, i) => {
            const look = statusLook(post);
            const m = msk(post.publishAt);
            return (
              <View key={post.id}>
                {i > 0 ? <View style={styles.divider} /> : null}
                <Pressable onPress={() => onOpen(post)} style={({ pressed }) => [styles.dayRow, pressed && styles.pressed]} accessibilityRole="button">
                  <PostThumb post={post} size={44} />
                  <View style={styles.flex}>
                    <Text style={[type.body, styles.label]} numberOfLines={1}>
                      {post.topic}
                    </Text>
                    <Text style={[type.footnote, styles.secondary]} numberOfLines={1}>
                      {[m?.time, post.platform === 'telegram' ? 'Telegram' : post.platform === 'instagram' ? 'Instagram' : null].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                  <View style={[styles.pill, { backgroundColor: `${look.color}2E` }]}>
                    <Text style={[type.caption1, styles.bold, { color: look.color }]}>{look.label}</Text>
                  </View>
                </Pressable>
              </View>
            );
          })}
        </GlassView>
      )}
    </>
  );
}

function Tool({ icon, color, title, onPress }: { icon: SFSymbol; color: string; title: string; onPress: () => void }) {
  return (
    <PressScale onPress={onPress} style={styles.tool} accessibilityRole="button" accessibilityLabel={title}>
      <GlassView style={styles.toolIcon}>
        <SymbolView name={icon} size={22} tintColor={color} />
      </GlassView>
      <Text style={[type.caption1, styles.secondary]} numberOfLines={1}>
        {title}
      </Text>
    </PressScale>
  );
}

function Footer({ data }: { data: SmmOverview }) {
  const budget = data.spend.budget ? ` из ${data.spend.budget.toLocaleString('ru-RU')} ₽` : '';
  const balance = data.balance != null ? ` · баланс Polza ${Math.floor(data.balance).toLocaleString('ru-RU')} ₽` : '';
  return (
    <Text style={[type.caption1, styles.tertiary, styles.center, styles.footer]}>
      {`Нейросети в этом месяце: ${data.spend.month.toLocaleString('ru-RU')} ₽${budget}${balance}`}
    </Text>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.groupedBackground },
  content: { gap: space.lg, paddingTop: space.sm, paddingBottom: space.xxxl },
  flex: { flex: 1, minWidth: 0 },
  label: { color: colors.label },
  secondary: { color: colors.secondaryLabel },
  tertiary: { color: colors.tertiaryLabel },
  white: { color: 'white' },
  bold: { fontWeight: '600' },
  center: { textAlign: 'center' },
  loading: { marginTop: space.xxl },
  pressed: { opacity: 0.7 },
  section: { gap: space.md },
  sectionTitle: { fontSize: 20, lineHeight: 25, fontWeight: '700', letterSpacing: -0.4 },
  header: { gap: space.sm },
  headerPress: { gap: 6, paddingHorizontal: space.xs },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  month: { flex: 1, fontSize: 34, lineHeight: 41, fontWeight: '700', letterSpacing: -0.8 },
  setup: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, borderRadius: 16, borderCurve: 'continuous', backgroundColor: colors.card },
  week: { flexDirection: 'row', gap: 2 },
  weekDay: { flex: 1, minHeight: 66, borderRadius: 18, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center', gap: 3 },
  weekDaySelected: { backgroundColor: colors.accent },
  weekName: { color: colors.secondaryLabel, fontWeight: '600' },
  weekNameSelected: { color: 'rgba(255,255,255,0.85)' },
  dots: { flexDirection: 'row', gap: 3, height: 6 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  attentionScroll: { marginHorizontal: -space.lg },
  attentionRow: { gap: 10, paddingHorizontal: space.lg },
  attentionCard: { width: ATTENTION_CARD_WIDTH, borderRadius: 22, borderCurve: 'continuous', overflow: 'hidden', backgroundColor: colors.card },
  attentionTag: { position: 'absolute', left: 8, top: 8, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.5)' },
  attentionBody: { padding: space.md, gap: space.sm, flex: 1, justifyContent: 'space-between' },
  attentionButton: { minHeight: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.md },
  attentionPrimary: { backgroundColor: colors.accent },
  attentionSecondary: { backgroundColor: colors.fill },
  dayCard: { borderRadius: 22, borderCurve: 'continuous', paddingHorizontal: space.md, overflow: 'hidden' },
  dayRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 64, paddingVertical: space.sm },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.separator, marginLeft: 56 },
  pill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  nextPlan: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, borderRadius: 16, borderCurve: 'continuous', backgroundColor: colors.card },
  tools: { flexDirection: 'row' },
  tool: { flex: 1, alignItems: 'center', gap: 6 },
  toolIcon: { width: 54, height: 54, borderRadius: 17, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center' },
  footer: { marginTop: space.sm },
});
