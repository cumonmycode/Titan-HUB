// «Трансляции» — эфир клуба и где его смотреть. Идёт эфир — название, кнопки площадок
// этого эфира и «Поддержать донатом»; эфира нет — постоянные площадки клуба (каналы) и
// тот же донат. Открывается плашкой «В эфире» на главной, push «Мы в эфире» и строкой
// «Трансляции» в профиле. На iOS шторка по высоте содержимого — без прокрутки; на Android
// это полноэкранное окно, и на невысоком телефоне эфир + донат + площадки прокручиваются.
//
// Донат — только на Android: в iOS чаевые авторам цифрового контента Apple принимает
// лишь через встроенные покупки (App Review 3.1.1), внешняя ссылка — причина отказа.
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlassButton } from '@/components/glass';
import { ListRow, ListSection } from '@/components/list';
import { LiveBadge } from '@/components/live-badge';
import { SheetHeader, useCloseSheet } from '@/components/sheet';
import { EmptyState, IconTile, Skeleton, Surface } from '@/components/ui';
import { errorText } from '@/lib/api';
import { clock, relative } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { useStream, useWallet } from '@/lib/queries';
import { colors, GUTTER, IS_IOS, MAX_WIDTH, radius, space, type } from '@/lib/theme';
import type { StreamLink, StreamView } from '@/lib/types';

/** Ссылка — в приложение площадки (VK Видео, YouTube, Twitch), если оно стоит, иначе в браузер. */
function open(link: StreamLink) {
  haptic.tap();
  void Linking.openURL(link.url).catch(() => undefined);
}

export default function StreamScreen() {
  const insets = useSafeAreaInsets();
  const close = useCloseSheet();
  const query = useStream();
  const data = query.data;

  const body = (
    <View style={styles.column}>
      {data ? <Content data={data} /> : query.isError ? (
        <EmptyState icon="offline" title="Не удалось загрузить" text={errorText(query.error)}>
          <GlassButton title="Повторить" variant="secondary" onPress={() => void query.refetch()} />
        </EmptyState>
      ) : <Skeleton height={180} rounded={radius.card} />}
    </View>
  );
  const padding = [styles.content, { paddingBottom: insets.bottom + space.xl }];

  return (
    <View style={IS_IOS ? undefined : styles.root}>
      <SheetHeader title="Трансляции" onClose={close} />
      {IS_IOS ? <View style={padding}>{body}</View> : <ScrollView contentContainerStyle={padding}>{body}</ScrollView>}
    </View>
  );
}

function Content({ data }: { data: StreamView }) {
  const live = data.live;
  // Донат эфира важнее постоянного: во время эфира — его, иначе — постоянный донат клуба.
  const donate = IS_IOS ? null : (live?.donate[0] ?? data.donate[0] ?? null);
  // Площадки клуба, которых нет среди ссылок эфира.
  const channels = data.channels.filter((c) => !live?.watch.some((w) => w.url === c.url));

  return (
    <>
      {live ? <Live live={live} /> : <Offline data={data} />}
      {donate ? (
        <GlassButton title="Поддержать донатом" icon="heart" variant="secondary" onPress={() => open(donate)} style={styles.donate} />
      ) : null}
      {channels.length ? (
        <ListSection title={live ? 'Ещё площадки клуба' : 'Где мы стримим'}>
          {channels.map((c) => (
            <ListRow key={c.url} icon="play" color={colors.red} title={c.label} subtitle={hostOf(c.url)} external onPress={() => open(c)} />
          ))}
        </ListSection>
      ) : null}
    </>
  );
}

function Live({ live }: { live: NonNullable<StreamView['live']> }) {
  return (
    <Surface tone={colors.red} style={styles.card}>
      <LiveBadge />
      <Text style={styles.title} numberOfLines={3}>{live.title}</Text>
      <Text style={type.caption}>Эфир идёт с {clock(live.startedAt)}</Text>
      <View style={styles.buttons}>
        {live.watch.map((w, i) => (
          <GlassButton key={w.url} title={live.watch.length > 1 ? `Смотреть · ${w.label}` : 'Смотреть'} icon="play"
            variant={i === 0 ? 'primary' : 'secondary'} size={i === 0 ? 'lg' : 'md'} onPress={() => open(w)} />
        ))}
      </View>
    </Surface>
  );
}

function Offline({ data }: { data: StreamView }) {
  const { data: wallet } = useWallet();
  const notify = wallet?.prefs.streams !== false && wallet?.prefs.push !== false;
  const last = data.lastEndedAt ? `Последний эфир — ${relative(data.lastEndedAt)}. ` : '';
  return (
    <Surface style={[styles.card, styles.offline]}>
      <IconTile name="live" color={colors.textSecondary} />
      <View style={styles.flex}>
        <Text style={type.headline}>Сейчас эфира нет</Text>
        <Text style={[type.caption, styles.note]}>
          {last}{notify ? 'Пришлём уведомление, как только начнём.' : 'Включите «Трансляции» в профиле — пришлём уведомление о начале эфира.'}
        </Text>
      </View>
    </Surface>
  );
}

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return undefined;
  }
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  content: { paddingHorizontal: GUTTER },
  column: { width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center' },
  card: { borderRadius: radius.card, padding: space.xl, gap: space.sm },
  offline: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg },
  title: { ...StyleSheet.flatten(type.heading), marginTop: space.xs },
  note: { marginTop: 2 },
  buttons: { gap: space.sm, marginTop: space.md },
  donate: { marginTop: space.lg },
});
