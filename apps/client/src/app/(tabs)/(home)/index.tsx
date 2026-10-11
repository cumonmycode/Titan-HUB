// Главная. У каждого действия — ровно одно место:
// • голо-карта — бонусы и срок их сгорания; нажатие открывает бонусную программу;
// • «Депозит» — баланс и единственная кнопка «Пополнить»;
// • «К оплате» — долг и взносы, у каждого своя кнопка оплаты;
// • «Последние операции» — три свежие, «Все» ведёт во вкладку «История»;
// • колокольчик в шапке — уведомления.
import { Stack, useRouter } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { ClubCard } from '@/components/club-card';
import { FEED_ROW_INSET, FeedRow } from '@/components/feed-row';
import { GlassButton, GlassIconButton } from '@/components/glass';
import type { IconName } from '@/components/icon';
import { RollingNumber } from '@/components/rolling-number';
import { TabScroll } from '@/components/screen';
import { Divider, EmptyState, IconTile, SectionHeader, Skeleton, Surface } from '@/components/ui';
import { errorText } from '@/lib/api';
import { bonus, inDays, money, plural } from '@/lib/format';
import { pushPermission, registerForPush } from '@/lib/push';
import { refreshMoney, useFeed, useWallet } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { colors, IS_IOS, radius, space, type } from '@/lib/theme';
import type { Collection, Wallet } from '@/lib/types';

const PUSH_PROMPT_KEY = 'push_prompt_dismissed';
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

      {w.registration === 'pending' ? <RegistrationPending /> : null}
      <DepositCard wallet={w} />
      <PushPrompt />
      <Dues wallet={w} />
      {w.visitProgress.tier === 'newbie' && w.visitProgress.remaining >= 0 ? <ResidentProgress wallet={w} /> : null}

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

/** Мягкое предложение включить push — системный запрос только по нажатию. */
function PushPrompt() {
  const status = useSession((s) => s.status);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (status !== 'signedIn') return;
    let alive = true;
    void (async () => {
      const dismissed = await SecureStore.getItemAsync(PUSH_PROMPT_KEY).catch(() => null);
      const perm = await pushPermission().catch(() => 'denied' as const);
      if (alive) setVisible(!dismissed && perm === 'undetermined');
    })();
    return () => { alive = false; };
  }, [status]);
  if (!visible) return null;
  const dismiss = () => { setVisible(false); void SecureStore.setItemAsync(PUSH_PROMPT_KEY, '1'); };
  return (
    <Surface tone={colors.violet} style={[styles.card, styles.section]}>
      <View style={styles.row}>
        <IconTile name="inbox" color={colors.violetLight} />
        <View style={styles.flex}>
          <Text style={type.headline}>Уведомления об операциях</Text>
          <Text style={[type.caption, styles.promptText]}>Бонусы, пополнения, долг и новости клуба — сразу на телефон.</Text>
        </View>
      </View>
      <View style={styles.promptActions}>
        <GlassButton title="Не сейчас" variant="ghost" size="md" onPress={dismiss} />
        <GlassButton title="Включить" size="md" onPress={async () => {
          await registerForPush(true);
          dismiss();
        }} />
      </View>
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
  promptActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: space.sm, marginTop: space.md },
  listLoading: { padding: space.lg, gap: space.md },
});
