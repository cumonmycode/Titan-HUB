// Главная. У каждого действия — ровно одно место:
// • голо-карта — бонусы и срок их сгорания; нажатие открывает бонусную программу;
// • «Депозит» — баланс и единственная кнопка «Пополнить»;
// • «К оплате» — долг и взносы, у каждого своя кнопка оплаты;
// • «В эфире» — плашка появляется, только пока идёт трансляция клуба, ведёт в «Трансляции»;
// • «Игровые вечера» — сколько и каких вечеров сыграно, ведёт в шторку со статистикой;
// • «Последние операции» — три свежие, «Все» ведёт во вкладку «История»;
// • колокольчик в шапке — уведомления.
import { Stack, useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { ClubCard } from '@/components/club-card';
import { gamesWord, ShareBar } from '@/components/evenings';
import { FEED_ROW_INSET, FeedRow } from '@/components/feed-row';
import { GlassButton, GlassIconButton } from '@/components/glass';
import { Icon, type IconName } from '@/components/icon';
import { LiveBadge } from '@/components/live-badge';
import { Tap } from '@/components/tap';
import { RollingNumber } from '@/components/rolling-number';
import { TabScroll } from '@/components/screen';
import { Divider, EmptyState, IconTile, SectionHeader, Skeleton, Surface } from '@/components/ui';
import { errorText } from '@/lib/api';
import { bonus, inDays, money, plural } from '@/lib/format';
import { EVENING_COLORS, summarize } from '@/lib/evenings';
import { refreshMoney, useEvenings, useFeed, useStream, useWallet } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { colors, IS_IOS, radius, space, type } from '@/lib/theme';
import type { Collection, Wallet } from '@/lib/types';

const RECENT_COUNT = 3;

function greeting(demo: boolean): string {
  const hour = new Date().getHours();
  const hello = hour < 5 ? 'Доброй ночи' : hour < 12 ? 'Доброе утро' : hour < 18 ? 'Добрый день' : 'Добрый вечер';
  return demo ? `${hello} · демо` : hello;
}

export default function HomeScreen() {
  const router = useRouter();
  const demo = useSession((s) => s.status === 'demo');
  const wallet = useWallet();
  const recent = useFeed('all', 6);
  const w = wallet.data;
  const title = greeting(demo);
  const unread = w?.unreadNotifications ?? 0;
  const openNotifications = () => router.push('/notifications');

  const refresh = async () => {
    refreshMoney();
    await Promise.all([wallet.refetch(), recent.refetch()]);
  };

  const header = (
    <>
      <Stack.Screen options={{ title }} />
      {IS_IOS ? (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button onPress={openNotifications}
            accessibilityLabel={unread ? `Уведомления, непрочитанных ${unread}` : 'Уведомления'}>
            <Stack.Toolbar.Icon sf={unread ? 'bell.badge' : 'bell'} />
            {unread > 0 ? <Stack.Toolbar.Badge>{unread > 99 ? '99+' : String(unread)}</Stack.Toolbar.Badge> : null}
          </Stack.Toolbar.Button>
        </Stack.Toolbar>
      ) : null}
    </>
  );
  const androidBell = <GlassIconButton icon="bell" label="Уведомления" dot={unread > 0} onPress={openNotifications} />;

  if (!w) {
    return (
      <TabScroll title={title} right={androidBell} onRefresh={refresh}>
        {header}
        {wallet.isError ? (
          <EmptyState icon="offline" title="Не удалось загрузить данные" text={errorText(wallet.error)}>
            <GlassButton title="Повторить" variant="secondary" onPress={() => void wallet.refetch()} />
          </EmptyState>
        ) : (
          <View style={styles.skeletons}>
            <Skeleton height={212} rounded={radius.card} />
            <Skeleton height={96} rounded={radius.tile} />
            <Skeleton height={150} rounded={radius.card} />
            <Skeleton height={200} rounded={radius.card} />
          </View>
        )}
      </TabScroll>
    );
  }

  const items = recent.data?.pages[0]?.items.slice(0, RECENT_COUNT) ?? [];
  const expiring = w.bonusExpiring && !w.bonusHidden
    ? `${bonus(w.bonusExpiring.amount)} ${plural(w.bonusExpiring.amount, 'сгорит', 'сгорят', 'сгорят')} ${inDays(w.bonusExpiring.date)}`
    : null;

  return (
    <TabScroll title={title} right={androidBell} onRefresh={refresh}>
      {header}

      <Animated.View entering={FadeInDown.duration(500).springify().damping(18)}>
        <ClubCard
          data={{
            nickname: w.profile.nickname,
            tierLabel: w.tier.label,
            tierColor: w.tier.color,
            bonus: w.bonus,
            bonusHidden: w.bonusHidden,
            expiring,
            deposit: w.deposit,
            visits: w.visitProgress.visits,
          }}
          onPress={() => router.push('/bonus-rules')}
        />
      </Animated.View>

      <LiveBanner />
      {w.registration === 'pending' ? <RegistrationPending /> : null}
      <DepositCard wallet={w} />
      <Dues wallet={w} />
      {w.visitProgress.tier === 'newbie' && w.visitProgress.remaining >= 0 ? <ResidentProgress wallet={w} /> : null}
      <EveningsCard />

      <View style={styles.section}>
        <SectionHeader title="Последние операции" action={items.length ? 'Все' : undefined} onAction={() => router.navigate('/history')} />
        <Surface style={styles.group}>
          {recent.isLoading ? (
            <View style={styles.listLoading}><Skeleton height={40} /><Skeleton height={40} /><Skeleton height={40} /></View>
          ) : items.length === 0 ? (
            <EmptyState icon="receipt" title="Операций пока нет" text="Здесь появятся оплаты, пополнения и бонусы" />
          ) : items.map((it, i) => (
            <View key={it.id}>
              {i > 0 ? <Divider inset={FEED_ROW_INSET} /> : null}
              <FeedRow item={it} dated onOpenCheck={(id) => router.push({ pathname: '/check/[id]', params: { id } })} />
            </View>
          ))}
        </Surface>
      </View>
    </TabScroll>
  );
}

/** Идёт трансляция клуба — плашка над депозитом; эфира нет — плашки нет. */
function LiveBanner() {
  const router = useRouter();
  const live = useStream().data?.live;
  if (!live) return null;
  return (
    <Tap onPress={() => router.push('/stream')} scaleTo={0.98} accessibilityRole="button"
      accessibilityLabel={`Сейчас в эфире: ${live.title}. Смотреть`} style={styles.pending}>
      <Surface tone={colors.red} style={[styles.card, styles.row]}>
        <IconTile name="live" color={colors.red} />
        <View style={styles.flex}>
          <LiveBadge />
          <Text style={[type.headline, styles.liveTitle]} numberOfLines={2}>{live.title}</Text>
        </View>
        <Icon name="chevron" size={14} color={colors.textMuted} weight="bold" />
      </Surface>
    </Tap>
  );
}

/** «Игровые вечера»: число сыгранных вечеров, полоса видов и любимый — вход в статистику. */
function EveningsCard() {
  const router = useRouter();
  const { data } = useEvenings();
  if (!data) return null;
  const s = summarize(data);
  const open = () => router.push('/evenings');
  return (
    <View style={styles.section}>
      <SectionHeader title="Игровые вечера" />
      <Tap onPress={open} scaleTo={0.98} accessibilityRole="button"
        accessibilityLabel={`Игровые вечера: ${s.games}${s.favorite ? `, любимый — ${s.favorite.label}` : ''}`}>
        <Surface style={styles.card}>
          {s.games ? (
            <>
              <View style={styles.eveningsHead}>
                <Text style={styles.eveningsCount}>{s.games}</Text>
                <Text style={[type.callout, styles.flex]}>{gamesWord(s.games)} в клубе</Text>
                {s.thisMonth ? <Text style={type.caption}>+{s.thisMonth} в этом месяце</Text> : null}
              </View>
              <ShareBar shares={s.shares} />
              <View style={styles.legend}>
                {s.shares.map((sh) => (
                  <View key={sh.key} style={styles.legendItem}>
                    <View style={[styles.legendDot, { backgroundColor: EVENING_COLORS[sh.key] }]} />
                    <Text style={type.caption} numberOfLines={1}>{sh.label} · {sh.count}</Text>
                  </View>
                ))}
              </View>
            </>
          ) : (
            <View style={styles.row}>
              <IconTile name="evenings" color={colors.violetLight} />
              <Text style={[type.callout, styles.flex]}>Сыграйте первый вечер — здесь появится ваша статистика игр</Text>
            </View>
          )}
        </Surface>
      </Tap>
    </View>
  );
}

/** Регистрация ждёт подтверждения клуба: до него без бонусов и оплаты в приложении (кнопки скрыты — pay.online). */
function RegistrationPending() {
  return (
    <Surface tone={colors.amber} style={[styles.card, styles.pending]}>
      <View style={styles.row}>
        <IconTile name="pending" color={colors.amber} />
        <View style={styles.flex}>
          <Text style={type.headline}>Регистрация на проверке</Text>
          <Text style={[type.caption, styles.promptText]}>
            Администратор клуба скоро её подтвердит. После этого начнут начисляться бонусы и откроется оплата в приложении.
          </Text>
        </View>
      </View>
    </Surface>
  );
}

/** Депозит — баланс и единственная кнопка пополнения в приложении. */
function DepositCard({ wallet }: { wallet: Wallet }) {
  const router = useRouter();
  const active = wallet.deposit > 0;
  return (
    <Surface tone={active ? colors.green : undefined} style={styles.deposit}>
      <View style={styles.flex}>
        <Text style={type.overline}>Депозит</Text>
        <RollingNumber value={wallet.deposit} format={(n) => money(n)}
          style={[styles.depositValue, { color: active ? colors.green : colors.textMuted }]} />
      </View>
      {wallet.pay.online ? (
        <GlassButton title="Пополнить" icon="pay" size="md"
          onPress={() => router.push({ pathname: '/pay', params: { purpose: 'deposit' } })} />
      ) : (
        <Text style={styles.offlineNote}>Пополнить можно{'\n'}на кассе клуба</Text>
      )}
    </Surface>
  );
}

interface Due {
  key: string;
  icon: IconName;
  color: string;
  title: string;
  subtitle: string;
  amount: number | null;
  /** Кнопка оплаты: «Оплатить» — есть что платить, «Вперёд» — взнос оплачен, можно вперёд. */
  action: { label: string; params: Record<string, string>; primary: boolean } | null;
}

function duesFor(w: Wallet): Due[] {
  const dues: Due[] = [];
  if (w.debt > 0) {
    dues.push({
      key: 'debt', icon: 'debt', color: colors.red, title: 'Долг', subtitle: 'Погасить онлайн через СБП',
      amount: w.debt, action: { label: 'Оплатить', params: { purpose: 'debt' }, primary: true },
    });
  }
  for (const c of w.collections.filter((x) => !x.excluded)) dues.push(collectionDue(c));
  // Сначала то, что нужно оплатить.
  return [...dues].sort((a, b) => Number(!!b.amount) - Number(!!a.amount));
}

function collectionDue(c: Collection): Due {
  const owes = c.topUp > 0;
  const kind = c.kind === 'recurring' ? c.period.label : c.isMandatory ? 'Разовый сбор' : 'Добровольный сбор';
  const ahead = c.prepaidMonths > 0 ? ` · вперёд на ${c.prepaidMonths} ${plural(c.prepaidMonths, 'месяц', 'месяца', 'месяцев')}` : '';
  const params = { purpose: 'fund', collectionId: c.id };
  if (owes) {
    return {
      key: c.id, icon: 'pending', color: colors.amber, title: c.name, subtitle: kind,
      amount: c.topUp, action: { label: 'Оплатить', params, primary: true },
    };
  }
  return {
    key: c.id, icon: 'paid', color: colors.green, title: c.name, subtitle: `Оплачено · ${kind}${ahead}`,
    amount: null, action: c.kind === 'recurring' ? { label: 'Вперёд', params, primary: false } : null,
  };
}

/** «К оплате»: долг и взносы одним списком, у каждого своя кнопка. */
function Dues({ wallet }: { wallet: Wallet }) {
  const router = useRouter();
  const dues = duesFor(wallet);
  if (!dues.length) return null;
  const owes = dues.some((d) => d.amount);
  const online = wallet.pay.online;
  return (
    <View style={styles.section}>
      <SectionHeader title={owes ? 'К оплате' : 'Взносы'} />
      <Surface style={styles.group}>
        {dues.map((d, i) => (
          <View key={d.key}>
            {i > 0 ? <Divider inset={DUE_INSET} /> : null}
            <View style={styles.due}>
              <IconTile name={d.icon} color={d.color} size={38} />
              <View style={styles.flex}>
                <View style={styles.dueLine}>
                  <Text style={[type.headline, styles.flex]} numberOfLines={1}>{d.title}</Text>
                  {d.amount ? <Text style={[styles.dueAmount, { color: d.color }]}>{money(d.amount)}</Text> : null}
                </View>
                <View style={styles.dueLine}>
                  <Text style={[type.caption, styles.flex]} numberOfLines={2}>{d.subtitle}</Text>
                  {online && d.action ? (
                    <GlassButton title={d.action.label} size="sm" variant={d.action.primary ? 'primary' : 'secondary'}
                      onPress={() => router.push({ pathname: '/pay', params: d.action!.params })} />
                  ) : null}
                </View>
              </View>
            </View>
          </View>
        ))}
      </Surface>
      {!online && owes ? <Text style={styles.footer}>Онлайн-оплата временно недоступна — оплатить можно на кассе клуба.</Text> : null}
    </View>
  );
}

const DUE_INSET = space.lg + 38 + space.md;

function ResidentProgress({ wallet }: { wallet: Wallet }) {
  const vp = wallet.visitProgress;
  const pct = Math.min(1, vp.visits / Math.max(1, vp.threshold));
  return (
    <Surface tone={colors.cyan} style={[styles.card, styles.section]}>
      <View style={styles.row}>
        <IconTile name="trophy" color={colors.cyan} />
        <Text style={[type.headline, styles.flex]}>До статуса «Резидент»</Text>
        <Text style={styles.progressCount}>{vp.visits}/{vp.threshold}</Text>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${pct * 100}%` }]} />
      </View>
      <Text style={[type.caption, styles.note]}>
        {vp.remaining > 0
          ? `Ещё ${vp.remaining} ${plural(vp.remaining, 'посещение', 'посещения', 'посещений')} — и вы Резидент`
          : 'Порог достигнут — статус повысится после следующего визита'}
      </Text>
    </Surface>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  skeletons: { gap: space.lg },
  deposit: {
    flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.lg,
    paddingVertical: space.lg, paddingLeft: space.xl, paddingRight: space.lg, borderRadius: radius.tile,
  },
  depositValue: { fontSize: 28, fontWeight: '800', fontStyle: 'italic', marginTop: 2 },
  offlineNote: { ...StyleSheet.flatten(type.caption), textAlign: 'right' },
  section: { marginTop: space.xxl + space.xs },
  group: { borderRadius: radius.card, overflow: 'hidden' },
  due: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md },
  dueLine: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 24 },
  dueAmount: { fontSize: 17, fontWeight: '800', fontStyle: 'italic', fontVariant: ['tabular-nums'] },
  footer: { ...StyleSheet.flatten(type.caption), marginTop: space.sm, marginHorizontal: space.lg },
  card: { borderRadius: radius.tile, padding: space.lg },
  note: { marginTop: space.sm },
  progressCount: { color: colors.cyan, fontWeight: '800', fontSize: 14, fontVariant: ['tabular-nums'] },
  track: { height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.12)', overflow: 'hidden', marginTop: space.md },
  fill: { height: '100%', borderRadius: 4, experimental_backgroundImage: 'linear-gradient(90deg, #8B5CF6, #4cd7f6)' },
  promptText: { marginTop: 2 },
  pending: { marginTop: space.lg },
  listLoading: { padding: space.lg, gap: space.md },
  liveTitle: { marginTop: space.xs },
  eveningsHead: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm, marginBottom: space.md },
  eveningsCount: { color: colors.text, fontSize: 30, fontWeight: '800', fontVariant: ['tabular-nums'] },
  legend: { flexDirection: 'row', flexWrap: 'wrap', columnGap: space.md, rowGap: space.xs, marginTop: space.md },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
});
