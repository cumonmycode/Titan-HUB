import { Image } from 'expo-image';
import { Stack, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppRefreshControl } from '@/components/refresh-control';
import { Appear } from '@/components/smm/motion';
import { DayBars, HBar, MetricGrid } from '@/components/smm/charts';
import { BigButton, Card, ChipButton, PlatformBadge, PostRow, ProgressBanner, SectionTitle, estimate } from '@/components/smm/parts';
import { Text } from '@/components/text';
import { api, ApiError } from '@/lib/api';
import { haptic } from '@/lib/haptics';
import { usePageGutter } from '@/lib/layout';
import { queryClient } from '@/lib/query';
import { useClubKey } from '@/lib/queries';
import {
  FORMAT_LABEL,
  PLATFORM_LOOK,
  msk,
  useSmmAnalytics,
  type SmmAccount,
  type SmmAnalytics,
  type SmmPlatformInsight,
  type SmmProgress,
  type SmmReport,
  type SmmTopPost,
} from '@/lib/smm-api';
import { colors, space, type, useAccentHex } from '@/lib/theme';

const WEEKDAY = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const fmt = (n: number) => n.toLocaleString('ru-RU');

/**
 * Аналитика по API площадок — без скриншотов. По каждой площадке: подписчики и рост,
 * охват и вовлечённость за 7 или 30 дней, график по дням, какие форматы и дни заходят,
 * аудитория Instagram и лучшие публикации. Ниже — прогноз против факта по постам Tai
 * и отчёты с выводами. Цифры обновляются сами: свежие посты — каждый час.
 */
export default function SmmAnalyticsScreen() {
  const router = useRouter();
  const club = useClubKey();
  const gutter = usePageGutter();
  const query = useSmmAnalytics();
  const [pulling, setPulling] = useState(false);
  const [days, setDays] = useState<7 | 30>(7);
  const [progress, setProgress] = useState<SmmProgress | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const data = query.data;

  const store = (next: Partial<SmmAnalytics>) => queryClient.setQueryData<SmmAnalytics>([club, 'smm', 'analytics'], (prev) => (prev ? { ...prev, ...next } : prev));
  const run = async (name: string, label: string, eta: number, job: () => Promise<void>, title: string) => {
    setActing(name);
    setProgress(estimate(label, eta));
    try {
      await job();
      haptic.success();
    } catch (error) {
      Alert.alert(title, error instanceof ApiError ? error.message : String(error));
    } finally {
      setActing(null);
      setProgress(null);
    }
  };
  const collect = () => run('collect', 'Tai собирает цифры площадок', 25, async () => {
    store(await api.post<SmmAnalytics>('/smm/analytics/collect'));
  }, 'Цифры не обновились');
  const report = () =>
    run(
      'report',
      'Tai разбирает цифры и пишет отчёт',
      30,
      async () => {
        const { report: created } = await api.post<{ report: SmmReport }>('/smm/reports/generate', {});
        store({ reports: [created, ...(data?.reports ?? [])] });
      },
      'Отчёт не получился',
    );
  const openPost = (id: string) => router.push({ pathname: '/manage/smm/post', params: { id } });

  return (
    <View style={styles.screen}>
      <Stack.Title>Аналитика</Stack.Title>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[styles.content, gutter]}
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
        {!data ? (
          query.error ? <Text style={[type.body, styles.secondary]}>{query.error.message}</Text> : <ActivityIndicator style={styles.loading} />
        ) : (
          <>
            <View style={styles.row}>
              {([7, 30] as const).map((d) => (
                <Pressable
                  key={d}
                  onPress={() => {
                    haptic.selection();
                    setDays(d);
                  }}
                  style={[styles.segment, days === d && styles.segmentOn]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: days === d }}>
                  <Text style={[type.subhead, days === d ? styles.segmentTextOn : styles.label]}>{`${d} дней`}</Text>
                </Pressable>
              ))}
              <View style={styles.flex} />
              <ChipButton title={acting === 'collect' ? 'Обновляю…' : 'Обновить'} icon="arrow.clockwise" disabled={!!acting} onPress={() => void collect()} />
            </View>
            {progress ? <ProgressBanner progress={progress} /> : null}

            {data.accounts.filter((a) => a.isActive).map((a, i) => (
              <Appear key={a.id} index={i}>
              <PlatformCard account={a} days={days} history={data.history.filter((h) => h.accountId === a.id)} insight={data.platforms.find((p) => p.accountId === a.id)} onOpenPost={openPost} />
              </Appear>
            ))}
            {!data.accounts.length ? (
              <Card>
                <Text style={[type.subhead, styles.secondary]}>Площадки не подключены. Владелец добавляет канал Telegram и Instagram в настройках СММ.</Text>
              </Card>
            ) : null}

            <SectionTitle title="Прогноз и факт" />
            <Accuracy data={data} />
            {data.posts.slice(-8).reverse().map((post) => (
              <PostRow key={post.id} post={post} showDay onPress={() => openPost(post.id)} />
            ))}

            <SectionTitle title="Отчёты Tai" />
            {data.reports.map((r, i) => (
              <ReportCard key={r.id} report={r} initiallyOpen={i === 0} />
            ))}
            <BigButton title={acting === 'report' ? 'Tai разбирает цифры…' : 'Сделать отчёт за неделю'} icon="doc.text.magnifyingglass" tone={data.reports.length ? 'plain' : 'accent'} busy={acting === 'report'} onPress={() => void report()} />
            <Text style={[type.footnote, styles.secondary, styles.center]}>{`Цифры — по API площадок: свежие посты каждый час, остальное раз в день. Отчёт Tai делает сам по понедельникам. Нейросети в этом месяце: ${data.spend.month} ₽${data.spend.budget ? ` из ${data.spend.budget} ₽` : ''}.`}</Text>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function PlatformCard({ account, days, history, insight, onOpenPost }: { account: SmmAccount; days: 7 | 30; history: SmmAnalytics['history']; insight?: SmmPlatformInsight; onOpenPost: (id: string) => void }) {
  const platform = account.platform === 'telegram' || account.platform === 'instagram' ? account.platform : 'other';
  const withFollowers = history.filter((h) => h.followers != null);
  const window = withFollowers.filter((h) => h.day >= dayAgo(days));
  const first = window[0]?.followers ?? null;
  const last = withFollowers[withFollowers.length - 1]?.followers ?? account.followers;
  const delta = first != null && last != null && window.length > 1 ? last - first : null;
  const period = days === 7 ? account.stats.period7 : account.stats.period30;
  const tg = account.stats.tg;
  const reach = history.filter((h) => h.reach != null && h.day >= dayAgo(days)).map((h) => h.reach!);
  const followerSeries = window.map((h) => h.followers!);
  const engagement = period?.reach && period.engaged != null ? Math.round((period.engaged / period.reach) * 1000) / 10 : null;

  return (
    <Card>
      <View style={styles.accountHead}>
        <PlatformBadge platform={platform} size={30} />
        <View style={styles.flex}>
          <Text style={[type.headline, styles.label]} numberOfLines={1}>
            {account.title}
          </Text>
          <Text style={[type.footnote, styles.secondary]}>{PLATFORM_LOOK[platform].label}</Text>
        </View>
        <View style={styles.right}>
          <Text style={[type.title2, styles.label, type.amount]}>{last != null ? fmt(last) : '—'}</Text>
          <Text style={[type.caption1, { color: delta == null ? colors.secondaryLabel : delta >= 0 ? colors.green : colors.red }]}>
            {delta == null ? 'подписчиков' : `${delta >= 0 ? '+' : ''}${delta} за ${days} дн.`}
          </Text>
        </View>
      </View>

      {platform === 'instagram' ? (
        <>
          <MetricGrid
            items={[
              { label: 'Охват', value: period?.reach },
              { label: 'Просмотры', value: period?.views },
              { label: 'Вовлечённость', value: engagement, suffix: '%' },
              { label: 'Взаимодействия', value: period?.interactions },
              { label: 'Визиты профиля', value: period?.profileViews },
              { label: 'Переходы по ссылке', value: period?.linkTaps },
              { label: 'Новые подписчики', value: period?.follows },
              { label: 'Отписки', value: period?.unfollows },
              { label: 'Ответы на сторис', value: period?.replies },
            ]}
          />
          {reach.length > 2 ? (
            <View style={styles.block}>
              <Text style={[type.caption1, styles.secondary]}>ОХВАТ ПО ДНЯМ</Text>
              <DayBars values={reach} fromZero />
            </View>
          ) : null}
        </>
      ) : null}

      {platform === 'telegram' ? (
        <>
          <MetricGrid
            items={[
              { label: 'Просмотров на пост', value: tg?.avgViews },
              { label: 'ERR — доля подписчиков, видящих пост', value: tg?.err, suffix: '%' },
              { label: 'Постов за 30 дней', value: tg?.posts30 },
              { label: 'Просмотров за 30 дней', value: tg?.views30 },
              { label: 'Реакций на пост', value: tg?.avgReactions },
            ]}
          />
          {followerSeries.length > 2 ? (
            <View style={styles.block}>
              <Text style={[type.caption1, styles.secondary]}>ПОДПИСЧИКИ ПО ДНЯМ</Text>
              <DayBars values={followerSeries} />
            </View>
          ) : null}
        </>
      ) : null}

      {insight ? <Insight insight={insight} onOpenPost={onOpenPost} /> : null}
      {platform === 'instagram' && account.stats.audience ? <Audience audience={account.stats.audience} /> : null}
      {account.statsError ? <Text style={[type.footnote, { color: colors.orange }]}>{account.statsError}</Text> : null}
    </Card>
  );
}

const dayAgo = (days: number) => new Date(Date.now() + 3 * 3600_000 - days * 86_400_000).toISOString().slice(0, 10);

/** Что заходит: форматы, дни недели, время выхода и лучшие публикации. */
function Insight({ insight, onOpenPost }: { insight: SmmPlatformInsight; onOpenPost: (id: string) => void }) {
  const formatMax = Math.max(...insight.formats.map((f) => f.avgViews), 1);
  const dayMax = Math.max(...insight.weekdays.map((w) => w.avgViews), 1);
  const bestDay = [...insight.weekdays].sort((a, b) => b.avgViews - a.avgViews)[0];
  const bestHour = [...insight.hours].sort((a, b) => b.avgViews - a.avgViews)[0];
  return (
    <>
      {insight.formats.length > 1 ? (
        <View style={styles.block}>
          <Text style={[type.caption1, styles.secondary]}>ФОРМАТЫ · ПРОСМОТРОВ В СРЕДНЕМ</Text>
          {insight.formats.map((f) => (
            <HBar key={f.format} label={`${FORMAT_LABEL[f.format]} · ${f.posts}`} value={f.avgViews} max={formatMax} strong={f.avgViews === formatMax} />
          ))}
        </View>
      ) : null}
      {insight.weekdays.length > 2 ? (
        <View style={styles.block}>
          <Text style={[type.caption1, styles.secondary]}>ДНИ НЕДЕЛИ</Text>
          {insight.weekdays.map((w) => (
            <HBar key={w.weekday} label={WEEKDAY[w.weekday]!} value={w.avgViews} max={dayMax} strong={w === bestDay} />
          ))}
        </View>
      ) : null}
      {bestDay || bestHour ? (
        <View style={styles.tip}>
          <SymbolView name="clock.badge.checkmark" size={16} tintColor={colors.accent} />
          <Text style={[type.footnote, styles.label, styles.flex]}>
            {`Лучше заходят посты${bestDay ? ` в ${WEEKDAY[bestDay.weekday]!.toLowerCase()}` : ''}${bestHour ? ` с ${bestHour.from}:00 до ${bestHour.to}:00` : ''} — по ${insight.posts} публикациям за 60 дней.`}
          </Text>
        </View>
      ) : null}
      {insight.top.length ? (
        <View style={styles.block}>
          <Text style={[type.caption1, styles.secondary]}>ЛУЧШИЕ ПУБЛИКАЦИИ ЗА 60 ДНЕЙ</Text>
          {insight.top.map((t) => (
            <TopRow key={t.extId} top={t} onOpenPost={onOpenPost} />
          ))}
        </View>
      ) : null}
    </>
  );
}

function TopRow({ top, onOpenPost }: { top: SmmTopPost; onOpenPost: (id: string) => void }) {
  const open = () => (top.postId ? onOpenPost(top.postId) : top.permalink ? void Linking.openURL(top.permalink) : undefined);
  const date = msk(top.publishedAt)?.date.slice(5).split('-').reverse().join('.');
  return (
    <Pressable onPress={open} style={({ pressed }) => [styles.topRow, pressed && styles.pressed]} accessibilityRole="button">
      {top.thumb ? (
        <Image source={{ uri: top.thumb }} style={styles.topThumb} contentFit="cover" recyclingKey={top.extId} />
      ) : (
        <View style={[styles.topThumb, styles.topEmpty]}>
          <SymbolView name="text.alignleft" size={16} tintColor={colors.tertiaryLabel} />
        </View>
      )}
      <View style={styles.flex}>
        <Text style={[type.subhead, styles.label]} numberOfLines={2}>
          {top.caption || FORMAT_LABEL[top.format]}
        </Text>
        <Text style={[type.caption1, styles.secondary]} numberOfLines={1}>
          {[date, FORMAT_LABEL[top.format], top.views != null ? `👁 ${fmt(top.views)}` : null, top.likes != null ? `♥ ${fmt(top.likes)}` : null, top.saves ? `🔖 ${top.saves}` : null, top.postId ? 'от Tai' : null].filter(Boolean).join('  ')}
        </Text>
      </View>
    </Pressable>
  );
}

function Audience({ audience }: { audience: NonNullable<SmmAccount['stats']['audience']> }) {
  const total = (list: { value: number }[]) => Math.max(list.reduce((s, x) => s + x.value, 0), 1);
  const ageTotal = total(audience.ages);
  const ageMax = Math.max(...audience.ages.map((a) => a.value), 1);
  const genderTotal = total(audience.genders);
  const cityTotal = total(audience.cities);
  return (
    <View style={styles.block}>
      <Text style={[type.caption1, styles.secondary]}>АУДИТОРИЯ</Text>
      {audience.ages.map((a) => (
        <HBar key={a.label} label={a.label} value={a.value} max={ageMax} note={`${Math.round((a.value / ageTotal) * 100)}%`} strong={a.value === ageMax} />
      ))}
      <Text style={[type.footnote, styles.secondary]}>{audience.genders.map((g) => `${g.label} ${Math.round((g.value / genderTotal) * 100)}%`).join(' · ')}</Text>
      {audience.cities.length ? <Text style={[type.footnote, styles.secondary]}>{`Города: ${audience.cities.slice(0, 5).map((c) => `${c.label} ${Math.round((c.value / cityTotal) * 100)}%`).join(', ')}`}</Text> : null}
    </View>
  );
}

/** Насколько сбываются прогнозы Tai: в коридоре, выше, ниже. */
function Accuracy({ data }: { data: SmmAnalytics }) {
  const a = data.accuracy;
  if (!a.posts) {
    return (
      <Card>
        <Text style={[type.subhead, styles.secondary]}>Когда посты Tai начнут выходить, здесь будет видно, сколько просмотров ждали и сколько получили. Прогноз считается по похожим постам площадки.</Text>
      </Card>
    );
  }
  return (
    <Card>
      <MetricGrid
        items={[
          { label: 'Постов с прогнозом', value: a.posts },
          { label: 'В коридоре прогноза', value: a.inside },
          { label: 'Выше прогноза', value: a.above },
          { label: 'Ниже прогноза', value: a.below },
        ]}
      />
      {a.ratio != null ? <Text style={[type.footnote, styles.secondary]}>{`В среднем посты набирают ${Math.round(a.ratio * 100)}% от прогноза.`}</Text> : null}
    </Card>
  );
}

function ReportCard({ report, initiallyOpen }: { report: SmmReport; initiallyOpen: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  const accent = useAccentHex();
  const period = `${report.periodFrom.slice(8, 10)}.${report.periodFrom.slice(5, 7)}–${report.periodTo.slice(8, 10)}.${report.periodTo.slice(5, 7)}`;
  return (
    <Card>
      <Pressable onPress={() => setOpen((v) => !v)} style={styles.reportHead} accessibilityRole="button" accessibilityState={{ expanded: open }}>
        <View style={styles.flex}>
          <Text style={[type.caption1, styles.secondary]}>{period}</Text>
          <Text style={[type.headline, styles.label]}>{report.title}</Text>
        </View>
        <SymbolView name={open ? 'chevron.up' : 'chevron.down'} size={13} tintColor={colors.tertiaryLabel} />
      </Pressable>
      {open ? (
        <>
          <Text style={[type.subhead, styles.label]} selectable>
            {report.summary}
          </Text>
          {report.metrics.length ? (
            <View style={styles.metrics}>
              {report.metrics.map((m) => (
                <View key={m.label} style={styles.metric}>
                  <Text style={[type.headline, styles.label, type.amount]}>{m.value}</Text>
                  <Text style={[type.caption1, styles.secondary]}>{m.label}</Text>
                  {m.delta != null ? <Text style={[type.caption2, { color: m.delta >= 0 ? colors.green : colors.red }]}>{`${m.delta >= 0 ? '+' : ''}${m.delta}%`}</Text> : null}
                </View>
              ))}
            </View>
          ) : null}
          {report.recommendations.map((r) => (
            <View key={r.title} style={styles.reco}>
              <SymbolView name="arrow.right.circle.fill" size={16} tintColor={accent} />
              <View style={styles.flex}>
                <Text style={[type.subhead, styles.label, styles.bold]}>{r.title}</Text>
                <Text style={[type.footnote, styles.secondary]} selectable>
                  {r.detail}
                </Text>
              </View>
            </View>
          ))}
        </>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.groupedBackground },
  flex: { flex: 1, minWidth: 0 },
  content: { gap: space.md, paddingTop: space.md, paddingBottom: space.xxxl },
  label: { color: colors.label },
  secondary: { color: colors.secondaryLabel },
  bold: { fontWeight: '600' },
  center: { textAlign: 'center' },
  pressed: { opacity: 0.7 },
  loading: { marginTop: space.xxl },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  segment: { paddingHorizontal: space.md, height: 34, borderRadius: 17, justifyContent: 'center', backgroundColor: colors.card },
  segmentOn: { backgroundColor: colors.accent },
  segmentTextOn: { color: 'white', fontWeight: '600' },
  right: { alignItems: 'flex-end' },
  accountHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  block: { gap: space.sm },
  tip: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm, padding: space.md, borderRadius: 14, borderCurve: 'continuous', backgroundColor: colors.fill },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  topThumb: { width: 44, height: 44, borderRadius: 8, backgroundColor: colors.fill },
  topEmpty: { alignItems: 'center', justifyContent: 'center' },
  reportHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: space.lg },
  metric: { minWidth: 80 },
  reco: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
});
