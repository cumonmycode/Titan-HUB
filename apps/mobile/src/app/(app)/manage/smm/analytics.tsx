import { Stack, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppRefreshControl } from '@/components/refresh-control';
import { BigButton, Card, ChipButton, PlatformBadge, PostThumb, SectionTitle } from '@/components/smm/parts';
import { Text } from '@/components/text';
import { api, ApiError } from '@/lib/api';
import { haptic } from '@/lib/haptics';
import { usePageGutter } from '@/lib/layout';
import { queryClient } from '@/lib/query';
import { useClubKey } from '@/lib/queries';
import { PLATFORM_LOOK, msk, pickMedia, uploadAsset, useSmmAnalytics, type SmmAccount, type SmmAnalytics, type SmmPost, type SmmReport } from '@/lib/smm-api';
import { colors, space, type, useAccentHex } from '@/lib/theme';

/**
 * Аналитика: площадки с подписчиками и ростом, что из вышедшего зашло лучше всего и
 * отчёты Tai с выводами. Telegram Tai считает сам; Instagram без входа цифр не отдаёт —
 * скриншот статистики Tai разбирает нейросетью.
 */
export default function SmmAnalyticsScreen() {
  const router = useRouter();
  const club = useClubKey();
  const gutter = usePageGutter();
  const query = useSmmAnalytics();
  const [pulling, setPulling] = useState(false);
  const [acting, setActing] = useState<string | null>(null);
  const data = query.data;

  const store = (next: Partial<SmmAnalytics>) => queryClient.setQueryData<SmmAnalytics>([club, 'smm', 'analytics'], (prev) => (prev ? { ...prev, ...next } : prev));
  const run = async (name: string, job: () => Promise<void>, title: string) => {
    setActing(name);
    try {
      await job();
      haptic.success();
    } catch (error) {
      Alert.alert(title, error instanceof ApiError ? error.message : String(error));
    } finally {
      setActing(null);
    }
  };

  const collect = () =>
    run(
      'collect',
      async () => {
        store(await api.post<SmmAnalytics>('/smm/analytics/collect'));
      },
      'Цифры не обновились',
    );
  const screenshot = async () => {
    const asset = await pickMedia('Скриншот статистики', ['images']);
    if (!asset) return;
    await run(
      'screenshot',
      async () => {
        const r = await uploadAsset<SmmAnalytics & { summary: string }>('/smm/analytics/screenshot', asset);
        store(r);
        Alert.alert('Tai разобрал скриншот', r.summary);
      },
      'Скриншот не разобрался',
    );
  };
  const report = () =>
    run(
      'report',
      async () => {
        const { report: created } = await api.post<{ report: SmmReport }>('/smm/reports/generate', {});
        store({ reports: [created, ...(data?.reports ?? [])] });
      },
      'Отчёт не получился',
    );

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
          <ActivityIndicator style={styles.loading} />
        ) : (
          <>
            {data.accounts.filter((a) => a.isActive).map((a) => (
              <AccountCard key={a.id} account={a} history={data.history.filter((h) => h.accountId === a.id)} />
            ))}
            {!data.accounts.length ? (
              <Card>
                <Text style={[type.subhead, styles.secondary]}>Площадки не подключены. Владелец добавляет канал Telegram и Instagram в настройках СММ.</Text>
              </Card>
            ) : null}
            <View style={styles.row}>
              <ChipButton title={acting === 'collect' ? 'Обновляю…' : 'Обновить цифры'} icon="arrow.clockwise" disabled={!!acting} onPress={() => void collect()} />
              <ChipButton title={acting === 'screenshot' ? 'Разбираю…' : 'Скриншот статистики'} icon="camera.viewfinder" disabled={!!acting} onPress={() => void screenshot()} />
            </View>

            <SectionTitle title="Что зашло лучше" />
            <Top posts={data.posts} onOpen={(post) => router.push({ pathname: '/manage/smm/post', params: { id: post.id } })} />

            <SectionTitle title="Отчёты Tai" />
            {data.reports.map((r, i) => (
              <ReportCard key={r.id} report={r} initiallyOpen={i === 0} />
            ))}
            <BigButton title={acting === 'report' ? 'Tai разбирает цифры…' : 'Сделать отчёт за неделю'} icon="doc.text.magnifyingglass" tone={data.reports.length ? 'plain' : 'accent'} busy={acting === 'report'} onPress={() => void report()} />
            <Text style={[type.footnote, styles.secondary, styles.center]}>{`Отчёт Tai сам делает по понедельникам. Нейросети в этом месяце: ${data.spend.month} ₽${data.spend.budget ? ` из ${data.spend.budget} ₽` : ''}.`}</Text>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function AccountCard({ account, history }: { account: SmmAccount; history: SmmAnalytics['history'] }) {
  const points = history.filter((h) => h.followers != null);
  const first = points[0]?.followers ?? null;
  const last = points[points.length - 1]?.followers ?? account.followers;
  const delta = first != null && last != null ? last - first : null;
  const bars = points.slice(-30);
  const max = Math.max(...bars.map((b) => b.followers ?? 0), 1);
  const min = Math.min(...bars.map((b) => b.followers ?? max));
  const platform = account.platform === 'telegram' || account.platform === 'instagram' ? account.platform : 'other';
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
          <Text style={[type.title2, styles.label, type.amount]}>{last != null ? last.toLocaleString('ru-RU') : '—'}</Text>
          <Text style={[type.caption1, { color: delta == null ? colors.secondaryLabel : delta >= 0 ? colors.green : colors.red }]}>
            {delta == null ? 'подписчиков' : `${delta >= 0 ? '+' : ''}${delta} за ${points.length} дн.`}
          </Text>
        </View>
      </View>
      {bars.length > 2 ? (
        <View style={styles.spark}>
          {bars.map((b) => (
            <View key={b.day} style={[styles.sparkBar, { height: 6 + (((b.followers ?? min) - min) / Math.max(max - min, 1)) * 34 }]} />
          ))}
        </View>
      ) : null}
      <View style={styles.row}>
        {account.stats.views != null ? <Text style={[type.footnote, styles.secondary]}>{`${platform === 'telegram' ? 'Просмотров на пост' : 'Реакций на пост'} ~${account.stats.views}`}</Text> : null}
        {account.stats.engagement != null ? <Text style={[type.footnote, styles.secondary]}>{`Вовлечённость ${account.stats.engagement}%`}</Text> : null}
      </View>
      {account.statsError ? <Text style={[type.footnote, { color: colors.orange }]}>{account.statsError}</Text> : null}
    </Card>
  );
}

const score = (p: SmmPost) => (p.stats.views ?? 0) + (p.stats.likes ?? 0) * 10 + (p.stats.comments ?? 0) * 20 + (p.stats.saves ?? 0) * 25 + (p.stats.shares ?? 0) * 25;

function Top({ posts, onOpen }: { posts: SmmPost[]; onOpen: (post: SmmPost) => void }) {
  const ranked = posts.filter((p) => score(p) > 0).sort((a, b) => score(b) - score(a)).slice(0, 8);
  if (!ranked.length) {
    return (
      <Card>
        <Text style={[type.subhead, styles.secondary]}>Цифр по вышедшим публикациям пока нет — Tai соберёт просмотры канала за сутки, для Instagram пришлите скриншот.</Text>
      </Card>
    );
  }
  return (
    <>
      {ranked.map((post) => (
        <Pressable key={post.id} onPress={() => onOpen(post)} style={({ pressed }) => [styles.topRow, pressed && styles.pressed]} accessibilityRole="button">
          <PostThumb post={post} size={52} />
          <View style={styles.flex}>
            <Text style={[type.subhead, styles.label, styles.bold]} numberOfLines={2}>
              {post.topic}
            </Text>
            <Text style={[type.footnote, styles.secondary]} numberOfLines={1}>
              {[msk(post.publishedAt)?.date.slice(5).split('-').reverse().join('.'), post.stats.views != null ? `👁 ${post.stats.views}` : null, post.stats.likes != null ? `♥ ${post.stats.likes}` : null, post.stats.comments != null ? `💬 ${post.stats.comments}` : null]
                .filter(Boolean)
                .join('  ')}
            </Text>
          </View>
          <PlatformBadge platform={post.platform} size={20} />
        </Pressable>
      ))}
    </>
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
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  right: { alignItems: 'flex-end' },
  accountHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  spark: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 40 },
  sparkBar: { flex: 1, borderRadius: 2, backgroundColor: colors.accent, opacity: 0.75 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: 18, borderCurve: 'continuous', backgroundColor: colors.card },
  reportHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: space.lg },
  metric: { minWidth: 80 },
  reco: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
});
