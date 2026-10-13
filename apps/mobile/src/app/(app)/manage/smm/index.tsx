import { Stack, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import type { SFSymbol } from 'sf-symbols-typescript';

import { AppRefreshControl } from '@/components/refresh-control';
import { Appear, PressScale } from '@/components/smm/motion';
import { BigButton, Card, PlatformBadge, PostRow, ProgressBanner, SectionTitle } from '@/components/smm/parts';
import { Text } from '@/components/text';
import { ToolbarButton } from '@/components/toolbar';
import { usePageGutter } from '@/lib/layout';
import { useSession } from '@/lib/session';
import { PLATFORM_LOOK, busyText, dayTitle, monthTitle, msk, todayMsk, useSmmOverview, type SmmOverview, type SmmPost } from '@/lib/smm-api';
import { colors, space, type, useAccentHex } from '@/lib/theme';

/**
 * «СММ» — штаб соцсетей клуба. Сверху — что требует человека (одобрить, прислать
 * ссылку, не вышло), дальше лента на две недели по дням, план месяца, площадки с
 * цифрами, идеи и память Tai. Всю работу делает Tai; здесь — решения и правки.
 */
export default function SmmScreen() {
  const router = useRouter();
  const gutter = usePageGutter();
  const overview = useSmmOverview();
  const isOwner = useSession((s) => s.user?.role === 'owner');
  const [pulling, setPulling] = useState(false);
  const data = overview.data;

  const open = (post: SmmPost) => router.push({ pathname: '/manage/smm/post', params: { id: post.id } });

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
              <Hero data={data} isOwner={isOwner} onSetup={() => router.push('/manage/smm/settings')} />
            </Appear>
            <Attention data={data} onOpen={open} />
            <Appear index={2} style={styles.section}>
              <Feed posts={data.upcoming} onOpen={open} onNew={() => router.push('/manage/smm/new')} />
            </Appear>
            <Appear index={3} style={styles.section}>
              <PlanCard data={data} onOpen={(month) => router.push({ pathname: '/manage/smm/plan', params: { month } })} />
            </Appear>
            <Appear index={4} style={styles.section}>
              <SectionTitle title="Инструменты" />
              <View style={styles.tiles}>
                <Tile icon="chart.xyaxis.line" color="#30B0C7" title="Аналитика" text={data.lastReport ? 'Есть свежий отчёт' : 'Цифры, прогноз и факт'} onPress={() => router.push('/manage/smm/analytics')} />
                <Tile icon="lightbulb.fill" color="#FF9F0A" title="Идеи" text="По всем направлениям и праздникам" onPress={() => router.push('/manage/smm/ideas')} />
              </View>
              <View style={styles.tiles}>
                <Tile icon="photo.stack.fill" color="#34A853" title="Фотоархив" text="Фото клуба для постов" onPress={() => router.push('/manage/smm/library')} />
                <Tile icon="books.vertical.fill" color="#AF52DE" title="База знаний" text="Клуб, интерьер, даты, память" onPress={() => router.push('/manage/smm/knowledge')} />
              </View>
            </Appear>
            <Footer data={data} />
          </>
        )}
      </ScrollView>
    </View>
  );
}

/** Шапка: кто ведёт соцсети и всё ли подключено. */
function Hero({ data, isOwner, onSetup }: { data: SmmOverview; isOwner: boolean; onSetup: () => void }) {
  const accent = useAccentHex();
  const channel = data.accounts.find((a) => a.platform === 'telegram' && a.isActive);
  const insta = data.accounts.find((a) => a.platform === 'instagram' && a.isActive);
  const missing = [!data.ready.channel && 'канал Telegram', !data.ready.instagram && 'Instagram', !data.ready.publisher && 'кто выкладывает Instagram'].filter(Boolean) as string[];
  return (
    <Card style={styles.hero}>
      <View style={styles.heroTop}>
        <View style={[styles.heroLogo, { backgroundColor: accent }]}>
          <SymbolView name="sparkles" size={24} weight="semibold" tintColor="white" />
        </View>
        <View style={styles.flex}>
          <Text style={[type.title3, styles.label]}>Tai ведёт соцсети</Text>
          <Text style={[type.footnote, styles.secondary]}>
            {data.autopilot ? 'Автопилот: Telegram выходит сам, ты можешь остановить' : 'Готовит посты, ты одобряешь — дальше сам'}
          </Text>
        </View>
      </View>
      <View style={styles.accounts}>
        <AccountChip platform="telegram" title={channel?.title ?? 'Канал не подключён'} value={channel?.followers} ok={data.ready.channel} />
        <AccountChip platform="instagram" title={insta?.title ?? 'Не подключён'} value={insta?.followers} ok={data.ready.instagram} />
      </View>
      {missing.length && isOwner ? (
        <Pressable onPress={onSetup} style={({ pressed }) => [styles.setup, pressed && styles.pressed]} accessibilityRole="button">
          <SymbolView name="exclamationmark.circle.fill" size={18} tintColor={colors.orange} />
          <Text style={[type.subhead, styles.label, styles.flex]}>{`Подключите: ${missing.join(', ')}`}</Text>
          <SymbolView name="chevron.right" size={13} tintColor={colors.tertiaryLabel} />
        </Pressable>
      ) : null}
    </Card>
  );
}

function AccountChip({ platform, title, value, ok }: { platform: 'telegram' | 'instagram'; title: string; value?: number | null; ok: boolean }) {
  return (
    <View style={[styles.account, !ok && styles.muted]}>
      <PlatformBadge platform={platform} size={26} />
      <View style={styles.flex}>
        <Text style={[type.caption1, styles.secondary]} numberOfLines={1}>
          {PLATFORM_LOOK[platform].label}
        </Text>
        <Text style={[type.subhead, styles.label, styles.bold]} numberOfLines={1}>
          {value != null ? `${value.toLocaleString('ru-RU')} подписч.` : title}
        </Text>
      </View>
    </View>
  );
}

/** Что ждёт человека: одобрить, прислать ссылку, разобраться с невышедшим. */
function Attention({ data, onOpen }: { data: SmmOverview; onOpen: (post: SmmPost) => void }) {
  const review = data.upcoming.filter((p) => p.status === 'review' && !p.busy);
  const link = data.upcoming.filter((p) => p.status === 'approved' && p.handoffAt && !p.publishedUrl);
  const failed = data.upcoming.filter((p) => p.status === 'failed');
  const busy = data.upcoming.find((p) => p.busy && p.busy !== 'video');
  const items = [...failed, ...link, ...review];
  if (!items.length && !busy) return null;
  return (
    <Appear index={1} style={styles.section}>
      <SectionTitle title="Нужно твоё внимание" />
      {busy ? <ProgressBanner progress={busy.progress ? { ...busy.progress, label: `«${busy.topic}»: ${busy.progress.label.toLowerCase()}` } : null} text={`«${busy.topic}»: ${busyText[busy.busy!].toLowerCase()}`} /> : null}
      {items.map((post) => (
        <PostRow key={post.id} post={post} onPress={() => onOpen(post)} showDay />
      ))}
    </Appear>
  );
}

/** Лента на две недели вперёд по дням (вчерашние вышедшие — тоже, чтобы видеть результат). */
function Feed({ posts, onOpen, onNew }: { posts: SmmPost[]; onOpen: (post: SmmPost) => void; onNew: () => void }) {
  const today = todayMsk();
  const upcoming = posts.filter((p) => (msk(p.publishAt)?.date ?? '') >= today && p.status !== 'failed');
  const days = new Map<string, SmmPost[]>();
  for (const post of upcoming) {
    const day = msk(post.publishAt)?.date ?? 'none';
    days.set(day, [...(days.get(day) ?? []), post]);
  }
  return (
    <>
      <SectionTitle title="Ближайшие публикации" action="Добавить" onAction={onNew} />
      {!upcoming.length ? (
        <Card>
          <Text style={[type.subhead, styles.secondary]}>На ближайшие две недели публикаций нет. Составьте план месяца — Tai распишет темы по дням и сам будет готовить посты.</Text>
        </Card>
      ) : (
        [...days.entries()].map(([day, list]) => (
          <View key={day} style={styles.day}>
            <Text style={[type.footnote, styles.dayTitle]}>{day === 'none' ? 'Без даты' : dayTitle(day).toUpperCase()}</Text>
            {list.map((post) => (
              <PostRow key={post.id} post={post} onPress={() => onOpen(post)} />
            ))}
          </View>
        ))
      )}
    </>
  );
}

function PlanCard({ data, onOpen }: { data: SmmOverview; onOpen: (month: string) => void }) {
  const plan = data.plan;
  const status = !plan?.summary ? 'Плана ещё нет' : plan.status === 'active' ? 'Утверждён — Tai готовит посты' : 'Черновик — ждёт утверждения';
  return (
    <>
      <SectionTitle title="Стратегия" />
      <PressScale onPress={() => onOpen(data.month)} style={styles.planCard} accessibilityRole="button">
        <View style={styles.planHead}>
          <View style={styles.flex}>
            <Text style={[type.caption1, styles.secondary]}>ПЛАН НА МЕСЯЦ</Text>
            <Text style={[type.title3, styles.label]}>{monthTitle(data.month)}</Text>
          </View>
          <SymbolView name="calendar" size={26} tintColor={colors.accent} />
        </View>
        {plan?.busy ? <ProgressBanner progress={plan.progress} text={busyText[plan.busy]} /> : null}
        <Text style={[type.subhead, styles.label]} numberOfLines={4}>
          {plan?.summary || 'Tai составит стратегию на месяц: цели, рубрики и календарь публикаций по всем направлениям клуба — турниры, вечера, дни рождения, школа, бар.'}
        </Text>
        <Text style={[type.footnote, { color: plan?.status === 'active' ? colors.green : colors.orange }]}>{status}</Text>
      </PressScale>
      {data.nextPlan?.summary ? (
        <Pressable onPress={() => onOpen(data.nextMonth)} style={({ pressed }) => [styles.nextPlan, pressed && styles.pressed]} accessibilityRole="button">
          <SymbolView name="calendar.badge.clock" size={18} tintColor={colors.accent} />
          <Text style={[type.subhead, styles.label, styles.flex]}>{`План на ${monthTitle(data.nextMonth).toLowerCase()} готов${data.nextPlan.status === 'draft' ? ' — утверди' : ''}`}</Text>
          <SymbolView name="chevron.right" size={13} tintColor={colors.tertiaryLabel} />
        </Pressable>
      ) : null}
      {!plan?.summary ? <BigButton title="Открыть план" icon="wand.and.stars" onPress={() => onOpen(data.month)} /> : null}
    </>
  );
}

function Tile({ icon, color, title, text, onPress }: { icon: SFSymbol; color: string; title: string; text: string; onPress: () => void }) {
  return (
    <PressScale onPress={onPress} style={styles.tile} accessibilityRole="button" accessibilityLabel={title}>
      <View style={[styles.tileIcon, { backgroundColor: color }]}>
        <SymbolView name={icon} size={17} tintColor="white" />
      </View>
      <Text style={[type.headline, styles.label]} numberOfLines={1}>
        {title}
      </Text>
      <Text style={[type.caption1, styles.secondary]} numberOfLines={2}>
        {text}
      </Text>
    </PressScale>
  );
}

function Footer({ data }: { data: SmmOverview }) {
  const budget = data.spend.budget ? ` из ${data.spend.budget.toLocaleString('ru-RU')} ₽` : '';
  const balance = data.balance != null ? ` · баланс Polza ${Math.floor(data.balance).toLocaleString('ru-RU')} ₽` : '';
  return (
    <Text style={[type.footnote, styles.secondary, styles.center, styles.footer]}>
      {`Нейросети в этом месяце: ${data.spend.month.toLocaleString('ru-RU')} ₽${budget}${balance}. За неделю вышло ${data.counts.publishedWeek}.`}
    </Text>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.groupedBackground },
  content: { gap: space.md, paddingTop: space.md, paddingBottom: space.xxxl },
  flex: { flex: 1, minWidth: 0 },
  label: { color: colors.label },
  secondary: { color: colors.secondaryLabel },
  bold: { fontWeight: '600' },
  center: { textAlign: 'center' },
  loading: { marginTop: space.xxl },
  pressed: { opacity: 0.7 },
  muted: { opacity: 0.55 },
  hero: { gap: space.md },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  heroLogo: { width: 48, height: 48, borderRadius: 14, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center' },
  accounts: { flexDirection: 'row', gap: space.sm },
  account: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.sm, borderRadius: 14, borderCurve: 'continuous', backgroundColor: colors.fill },
  setup: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingTop: space.xs },
  day: { gap: space.sm },
  dayTitle: { color: colors.secondaryLabel, fontWeight: '600', marginTop: space.xs, marginLeft: space.xs },
  planCard: { backgroundColor: colors.card, borderRadius: 22, borderCurve: 'continuous', padding: space.lg, gap: space.sm },
  planHead: { flexDirection: 'row', alignItems: 'center' },
  nextPlan: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, borderRadius: 16, borderCurve: 'continuous', backgroundColor: colors.card },
  tiles: { flexDirection: 'row', gap: space.sm },
  section: { gap: space.md },
  tile: { flex: 1, padding: space.md, gap: 4, borderRadius: 18, borderCurve: 'continuous', backgroundColor: colors.card },
  tileIcon: { width: 32, height: 32, borderRadius: 9, alignItems: 'center', justifyContent: 'center', marginBottom: space.xs },
  footer: { marginTop: space.md },
});
