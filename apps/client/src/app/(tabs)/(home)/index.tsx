// «Кошелёк» — главный экран: голо-карта клуба с бонусами, депозит и долг, быстрые
// действия, взносы (фонд клуба и разовые сборы), прогресс до «Резидента», последние
// операции. Крупный заголовок шапки — приветствие по времени суток.
import { Stack, useRouter } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { FEED_ROW_INSET, FeedRow } from '@/components/feed-row';
import { Glass, GlassButton } from '@/components/glass';
import { HoloCard } from '@/components/holo-card';
import { Icon, type IconName } from '@/components/icon';
import { RollingNumber } from '@/components/rolling-number';
import { TabScroll } from '@/components/screen';
import { Tap } from '@/components/tap';
import { Divider, EmptyState, IconTile, SectionHeader, Skeleton } from '@/components/ui';
import { errorText } from '@/lib/api';
import { bonus, inDays, money, plural } from '@/lib/format';
import { pushPermission, registerForPush } from '@/lib/push';
import { refreshMoney, useFeed, useWallet } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { colors, radius, space, type } from '@/lib/theme';
import type { Collection, Wallet } from '@/lib/types';

const PUSH_PROMPT_KEY = 'push_prompt_dismissed';

function greeting(demo: boolean): string {
  const hour = new Date().getHours();
  const hello = hour < 5 ? 'Доброй ночи' : hour < 12 ? 'Доброе утро' : hour < 18 ? 'Добрый день' : 'Добрый вечер';
  return demo ? `${hello} · демо` : hello;
}

export default function WalletScreen() {
  const router = useRouter();
  const demo = useSession((s) => s.status === 'demo');
  const wallet = useWallet();
  const recent = useFeed('all', 6);
  const w = wallet.data;
  const title = greeting(demo);

  const refresh = async () => {
    refreshMoney();
    await Promise.all([wallet.refetch(), recent.refetch()]);
  };

  if (!w) {
    return (
      <TabScroll title={title} onRefresh={refresh}>
        <Stack.Screen options={{ title }} />
        {wallet.isError ? (
          <EmptyState icon="offline" title="Не удалось загрузить кошелёк" text={errorText(wallet.error)}>
            <GlassButton title="Повторить" variant="secondary" onPress={() => void wallet.refetch()} />
          </EmptyState>
        ) : (
          <View style={styles.skeletons}>
            <Skeleton height={212} rounded={radius.card} />
            <View style={styles.row}>
              <Skeleton height={112} rounded={radius.tile} style={styles.flex} />
              <Skeleton height={112} rounded={radius.tile} style={styles.flex} />
            </View>
            <Skeleton height={86} rounded={radius.tile} />
            <Skeleton height={220} rounded={radius.card} />
          </View>
        )}
      </TabScroll>
    );
  }

  const items = recent.data?.pages[0]?.items.slice(0, 5) ?? [];
  const collections = w.collections.filter((c) => !c.excluded);
  const openCheck = (id: string) => router.push({ pathname: '/check/[id]', params: { id } });

  return (
    <TabScroll title={title} onRefresh={refresh}>
      <Stack.Screen options={{ title }} />

      <Animated.View entering={FadeInDown.duration(500).springify().damping(18)}>
        <HoloCard
          nickname={w.profile.nickname}
          tierLabel={w.tier.label}
          tierColor={w.tier.color}
          bonus={w.bonus}
          bonusHidden={w.bonusHidden}
          memberSince={w.profile.memberSince}
        />
      </Animated.View>

      {w.bonusExpiring && !w.bonusHidden ? (
        <Tap onPress={() => router.push('/bonus-rules')} scaleTo={0.97} style={styles.expiryWrap}
          accessibilityRole="button" accessibilityLabel="Бонусы сгорают — подробнее">
          <Glass interactive tint="rgba(251,191,36,0.22)" fallback={styles.expiryFallback} style={styles.expiry}>
            <Icon name="flame" size={15} color={colors.amber} />
            <Text style={styles.expiryText}>
              {bonus(w.bonusExpiring.amount)} {plural(w.bonusExpiring.amount, 'бонус сгорит', 'бонуса сгорят', 'бонусов сгорят')} {inDays(w.bonusExpiring.date)}
            </Text>
            <Icon name="chevron" size={11} color={colors.amber} weight="bold" />
          </Glass>
        </Tap>
      ) : null}

      <View style={[styles.row, styles.tiles]}>
        <BalanceTile
          label="Депозит"
          value={w.deposit}
          color={colors.green}
          active={w.deposit > 0}
          hint="Пополнить"
          onPress={() => router.push({ pathname: '/pay', params: { purpose: 'deposit' } })}
        />
        <BalanceTile
          label="Долг"
          value={w.debt}
          color={colors.red}
          active={w.debt > 0}
          hint={w.debt > 0 ? 'Погасить' : 'Нет долга'}
          negative
          onPress={w.debt > 0 ? () => router.push({ pathname: '/pay', params: { purpose: 'debt' } }) : undefined}
        />
      </View>

      <QuickActions wallet={w} />

      <PushPrompt />

      {collections.length ? (
        <View style={styles.section}>
          <SectionHeader title="Взносы" />
          <View style={styles.stack}>
            {collections.map((c) => <CollectionCard key={c.id} c={c} online={w.pay.online} />)}
          </View>
        </View>
      ) : null}

      {w.visitProgress.tier === 'newbie' && w.visitProgress.remaining >= 0 ? <ResidentProgress wallet={w} /> : null}

      <View style={styles.section}>
        <SectionHeader title="Операции" action={items.length ? 'Все' : undefined} onAction={() => router.navigate('/history')} />
        <Glass style={styles.list}>
          {recent.isLoading ? (
            <View style={styles.listLoading}><Skeleton height={40} /><Skeleton height={40} /><Skeleton height={40} /></View>
          ) : items.length === 0 ? (
            <EmptyState icon="receipt" title="Операций пока нет" text="Здесь появятся оплаты, пополнения и бонусы" />
          ) : items.map((it, i) => (
            <View key={it.id}>
              {i > 0 ? <Divider inset={FEED_ROW_INSET} /> : null}
              <FeedRow item={it} dated onOpenCheck={openCheck} />
            </View>
          ))}
        </Glass>
      </View>
    </TabScroll>
  );
}

function BalanceTile({
  label, value, color, active, hint, onPress, negative,
}: { label: string; value: number; color: string; active: boolean; hint: string; onPress?: () => void; negative?: boolean }) {
  const tint = active ? `${color}2e` : undefined;
  const content = (
    <Glass interactive={!!onPress} tint={tint} fallback={active ? { backgroundColor: `${color}1a`, borderColor: `${color}55` } : null}
      style={styles.tile}>
      <Text style={type.overline}>{label}</Text>
      <RollingNumber
        value={value}
        format={(n) => (negative && n > 0 ? `−${money(n)}` : money(n))}
        style={[styles.tileValue, { color: active ? color : colors.textMuted }]}
      />
      <View style={styles.tileHint}>
        <Text style={[styles.tileHintText, { color: onPress ? (active ? color : colors.lavender) : colors.textMuted }]}>{hint}</Text>
        {onPress ? <Icon name="arrow" size={12} color={active ? color : colors.lavender} weight="bold" /> : null}
      </View>
    </Glass>
  );
  if (!onPress) return <View style={styles.flex}>{content}</View>;
  return (
    <Tap onPress={onPress} scaleTo={0.97} style={styles.flex} accessibilityRole="button" accessibilityLabel={`${label} ${money(value)}. ${hint}`}>
      {content}
    </Tap>
  );
}

function QuickActions({ wallet }: { wallet: Wallet }) {
  const router = useRouter();
  const due = wallet.collections.find((c) => !c.excluded && c.topUp > 0);
  const actions: { icon: IconName; label: string; color: string; onPress: () => void }[] = [
    { icon: 'deposit', label: 'Пополнить', color: colors.green, onPress: () => router.push({ pathname: '/pay', params: { purpose: 'deposit' } }) },
  ];
  if (wallet.debt > 0) {
    actions.push({ icon: 'debt', label: 'Погасить', color: colors.red, onPress: () => router.push({ pathname: '/pay', params: { purpose: 'debt' } }) });
  }
  if (wallet.collections.some((c) => !c.excluded)) {
    actions.push({
      icon: 'fund', label: due ? 'Взнос' : 'Взносы', color: colors.cyan,
      onPress: () => router.push({ pathname: '/pay', params: { purpose: 'fund', ...(due ? { collectionId: due.id } : {}) } }),
    });
  }
  actions.push({ icon: 'sparkles', label: 'Бонусы', color: colors.gold, onPress: () => router.push('/bonus-rules') });
  return (
    <View style={styles.actions}>
      {actions.map((a) => (
        <Tap key={a.label} onPress={a.onPress} style={styles.action} scaleTo={0.92} accessibilityRole="button" accessibilityLabel={a.label}>
          <Glass interactive tint={`${a.color}30`} fallback={{ backgroundColor: `${a.color}1f`, borderColor: `${a.color}40` }} style={styles.actionLens}>
            <Icon name={a.icon} size={24} color={a.color} />
          </Glass>
          <Text style={styles.actionLabel} numberOfLines={1}>{a.label}</Text>
        </Tap>
      ))}
    </View>
  );
}

function CollectionCard({ c, online }: { c: Collection; online: boolean }) {
  const router = useRouter();
  const owes = c.topUp > 0;
  const tone = owes ? colors.amber : colors.green;
  return (
    <Glass tint={`${tone}1f`} fallback={{ backgroundColor: `${tone}14`, borderColor: `${tone}40` }} style={styles.card}>
      <View style={styles.cardRow}>
        <IconTile name={owes ? 'pending' : 'paid'} color={tone} />
        <View style={styles.flex}>
          <Text style={type.headline} numberOfLines={1}>{c.name}</Text>
          <Text style={type.caption}>
            {c.kind === 'recurring' ? c.period.label : c.isMandatory ? 'Разовый сбор' : 'Добровольный сбор'}
            {c.due > 0 ? ` · ${money(c.due)}` : ''}
          </Text>
        </View>
        {owes
          ? <Text style={[styles.collAmount, { color: tone }]}>{money(c.topUp)}</Text>
          : <Text style={[styles.collPaid, { color: tone }]}>Оплачено</Text>}
      </View>
      {c.prepaidMonths > 0 ? (
        <Text style={[type.caption, styles.cardNote]}>
          Оплачено вперёд на {c.prepaidMonths} {plural(c.prepaidMonths, 'месяц', 'месяца', 'месяцев')}
        </Text>
      ) : null}
      {owes && online ? (
        <GlassButton
          title={`Оплатить ${money(c.topUp)}`}
          size="md"
          style={styles.cardButton}
          onPress={() => router.push({ pathname: '/pay', params: { purpose: 'fund', collectionId: c.id } })}
        />
      ) : null}
    </Glass>
  );
}

function ResidentProgress({ wallet }: { wallet: Wallet }) {
  const vp = wallet.visitProgress;
  const pct = Math.min(1, vp.visits / Math.max(1, vp.threshold));
  return (
    <Glass tint="rgba(76,215,246,0.14)" fallback={{ backgroundColor: colors.cyanTint, borderColor: 'rgba(76,215,246,0.3)' }}
      style={[styles.card, styles.section]}>
      <View style={styles.cardRow}>
        <IconTile name="trophy" color={colors.cyan} />
        <Text style={[type.headline, styles.flex]}>До статуса «Резидент»</Text>
        <Text style={styles.progressCount}>{vp.visits}/{vp.threshold}</Text>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${pct * 100}%` }]} />
      </View>
      <Text style={[type.caption, styles.cardNote]}>
        {vp.remaining > 0
          ? `Ещё ${vp.remaining} ${plural(vp.remaining, 'посещение', 'посещения', 'посещений')} — и вы Резидент 🎉`
          : 'Порог достигнут — статус повысится после следующего визита'}
      </Text>
    </Glass>
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
    <Glass tint="rgba(139,92,246,0.20)" fallback={{ backgroundColor: colors.violetTint, borderColor: colors.borderViolet }}
      style={[styles.card, styles.section]}>
      <View style={styles.cardRow}>
        <IconTile name="inbox" color={colors.violetLight} />
        <View style={styles.flex}>
          <Text style={type.headline}>Уведомления об операциях</Text>
          <Text style={[type.caption, styles.promptText]}>Бонусы, пополнения, долг и новости клуба — сразу на телефон.</Text>
        </View>
        <Tap onPress={dismiss} hitSlop={12} accessibilityRole="button" accessibilityLabel="Скрыть">
          <Icon name="close" size={14} color={colors.textMuted} weight="bold" />
        </Tap>
      </View>
      <GlassButton title="Включить" size="md" style={styles.cardButton} onPress={async () => {
        await registerForPush(true);
        dismiss();
      }} />
    </Glass>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', gap: space.md },
  skeletons: { gap: space.lg },
  expiryWrap: { alignSelf: 'center', marginTop: space.md },
  expiry: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, height: 34, borderRadius: radius.pill,
  },
  expiryFallback: { backgroundColor: colors.amberTint, borderColor: 'rgba(251,191,36,0.3)' },
  expiryText: { color: colors.amber, fontSize: 13, fontWeight: '700' },
  tiles: { marginTop: space.lg },
  tile: { borderRadius: radius.tile, padding: space.lg, minHeight: 112, justifyContent: 'space-between' },
  tileValue: { fontSize: 24, fontWeight: '800', fontStyle: 'italic', marginTop: 4 },
  tileHint: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
  tileHintText: { fontSize: 13, fontWeight: '700' },
  actions: { flexDirection: 'row', justifyContent: 'space-around', marginTop: space.xl },
  action: { alignItems: 'center', width: 78, gap: 7 },
  actionLens: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center' },
  actionLabel: { color: colors.textBody, fontSize: 12.5, fontWeight: '600' },
  section: { marginTop: space.xxl + space.xs },
  stack: { gap: space.md },
  card: { borderRadius: radius.tile, padding: space.lg },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  cardNote: { marginTop: space.sm },
  cardButton: { marginTop: space.md },
  promptText: { marginTop: 2 },
  collAmount: { fontSize: 17, fontWeight: '800', fontStyle: 'italic', fontVariant: ['tabular-nums'] },
  collPaid: { fontSize: 13, fontWeight: '800' },
  progressCount: { color: colors.cyan, fontWeight: '800', fontSize: 14, fontVariant: ['tabular-nums'] },
  track: { height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.12)', overflow: 'hidden', marginTop: space.md },
  fill: { height: '100%', borderRadius: 4, experimental_backgroundImage: 'linear-gradient(90deg, #8B5CF6, #4cd7f6)' },
  list: { borderRadius: radius.card, overflow: 'hidden' },
  listLoading: { padding: space.lg, gap: space.md },
});
