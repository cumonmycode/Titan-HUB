import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useReducer, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';

import Animated from 'react-native-reanimated';

import { AppRefreshControl } from '@/components/refresh-control';
import { Appear, glide } from '@/components/smm/motion';
import { BigButton, Card, ChipButton, Composer, ErrorBanner, PlatformBadge, ProgressBanner, StatusPill, Thread } from '@/components/smm/parts';
import { TaiGenerating, TaiRevealImage } from '@/components/tai/generating';
import { Text } from '@/components/text';
import { ToolbarMenu, ToolbarMenuAction } from '@/components/toolbar';
import { ApiError } from '@/lib/api';
import { promptText } from '@/lib/dialog';
import { haptic } from '@/lib/haptics';
import { usePageGutter } from '@/lib/layout';
import { useClubKey } from '@/lib/queries';
import {
  FORMAT_LABEL,
  PLATFORM_LOOK,
  VIDEO_ETA_SEC,
  autoPublishes,
  busyText,
  deletePost,
  directionLabel,
  mediaAction,
  pickMedia,
  plainText,
  postAction,
  refreshPost,
  selectedMedia,
  shareMedia,
  shareText,
  uploadAsset,
  useSmmPost,
  whenLabel,
  type SmmForecast,
  type SmmMedia,
  type SmmPost,
  type SmmProgress,
  type SmmStats,
} from '@/lib/smm-api';
import { colors, space, type } from '@/lib/theme';

const MAX_MEDIA_HEIGHT = 520;
const fail = (title: string) => (error: unknown) => Alert.alert(title, error instanceof ApiError || error instanceof Error ? error.message : String(error));
const fmt = (n: number) => n.toLocaleString('ru-RU');

/** Шкала работы над постом; видео — по времени с запуска (Veo ~2,5 мин). */
function postProgress(post: SmmPost): SmmProgress | null {
  if (post.progress) return post.progress;
  const video = post.media.find((m) => m.kind === 'video' && m.status === 'pending');
  return video ? { label: 'Нейросеть снимает видео', pct: 2, next: 97, eta: VIDEO_ETA_SEC, at: video.createdAt } : null;
}

/**
 * Публикация: как она будет выглядеть, текст, сценарий (рилс и сторис), что с ней
 * сейчас и следующий шаг. Замечание — в поле внизу: Tai переделает текст, картинку
 * или время и ответит в переписке.
 */
export default function SmmPostScreen() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const club = useClubKey();
  const gutter = usePageGutter();
  const query = useSmmPost(id);
  const [pulling, setPulling] = useState(false);
  const [acting, setActing] = useState<string | null>(null);
  const data = query.data;
  const post = data?.post;

  const run = async (name: string, job: () => Promise<unknown>, errorTitle = 'Не получилось') => {
    setActing(name);
    try {
      await job();
      haptic.success();
    } catch (error) {
      fail(errorTitle)(error);
    } finally {
      setActing(null);
    }
  };

  if (!post) {
    return (
      <View style={[styles.screen, styles.centerBox]}>
        {query.error ? <Text style={[type.body, styles.secondary]}>{query.error.message}</Text> : <ActivityIndicator />}
      </View>
    );
  }

  const action = (name: string, body?: unknown, errorTitle?: string) => run(name, () => postAction(club, post.id, name, body), errorTitle);
  const working = !!post.busy && post.busy !== 'video';

  const remove = () =>
    Alert.alert('Удалить публикацию?', 'Тема исчезнет из плана.', [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Удалить', style: 'destructive', onPress: () => void run('delete', async () => { await deletePost(club, post.id); router.back(); }) },
    ]);

  return (
    <View style={styles.screen}>
      <Stack.Title>{FORMAT_LABEL[post.format]}</Stack.Title>
      <Stack.Toolbar placement="right">
        <ToolbarMenu icon="ellipsis" accessibilityLabel="Ещё">
          {post.status !== 'published' && !working ? (
            <ToolbarMenuAction icon="pencil" onPress={() => router.push({ pathname: '/manage/smm/edit-text', params: { postId: post.id } })}>
              Изменить текст
            </ToolbarMenuAction>
          ) : null}
          {post.status !== 'published' ? (
            <ToolbarMenuAction icon="calendar" onPress={() => router.push({ pathname: '/manage/smm/when', params: { postId: post.id } })}>
              Перенести
            </ToolbarMenuAction>
          ) : null}
          {post.status !== 'published' && !working ? (
            <ToolbarMenuAction icon="arrow.clockwise" onPress={() => void action('write')}>
              Написать заново
            </ToolbarMenuAction>
          ) : null}
          {post.status === 'skipped' || post.status === 'failed' ? (
            <ToolbarMenuAction icon="arrow.uturn.backward" onPress={() => void action('restore')}>
              Вернуть в работу
            </ToolbarMenuAction>
          ) : post.status !== 'published' ? (
            <ToolbarMenuAction icon="nosign" onPress={() => void action('skip')}>
              Не выкладывать
            </ToolbarMenuAction>
          ) : null}
          {post.status !== 'published' ? (
            <ToolbarMenuAction icon="trash" destructive onPress={remove}>
              Удалить
            </ToolbarMenuAction>
          ) : null}
        </ToolbarMenu>
      </Stack.Toolbar>
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
          {post.busy || post.media.some((m) => m.status === 'pending') ? <ProgressBanner progress={postProgress(post)} text={post.busy ? busyText[post.busy] : undefined} /> : null}
          {post.error && !post.busy ? <ErrorBanner text={post.error} /> : null}
          <Appear index={0}>
            <Header post={post} />
          </Appear>
          <Appear index={1}>
            <MediaBlock post={post} disabled={working} acting={acting} onRun={run} />
          </Appear>
          <Appear index={2}>
            <BodyBlock post={post} onEdit={() => router.push({ pathname: '/manage/smm/edit-text', params: { postId: post.id } })} />
          </Appear>
          {post.script ? (
            <Appear index={3}>
              <ScriptBlock post={post} />
            </Appear>
          ) : null}
          <Appear index={4}>
            <IdeaBlock post={post} />
          </Appear>
          <Appear index={5}>
            <ResultBlock post={post} />
          </Appear>
          <Appear index={6}>
            <NextStep post={post} canApprove={data.canApprove} acting={acting} working={working} onAction={action} />
          </Appear>
          <Text style={[type.title3, styles.label, styles.remarksTitle]}>Замечания для Tai</Text>
          <Thread comments={data.comments} />
          <Composer
            placeholder={post.status === 'idea' ? 'Что учесть в посте?' : 'Что поправить? Текст, картинку, время…'}
            disabled={working}
            onSend={(text) => run('remark', () => postAction(club, post.id, 'remark', { text }), 'Tai не принял замечание')}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function Header({ post }: { post: SmmPost }) {
  const direction = directionLabel(post.direction);
  const manual = !autoPublishes(post);
  return (
    <View style={styles.header}>
      <View style={styles.headerMeta}>
        <PlatformBadge platform={post.platform} size={22} />
        <Text style={[type.subhead, styles.secondary]}>{`${PLATFORM_LOOK[post.platform].label} · ${FORMAT_LABEL[post.format]}`}</Text>
        <View style={styles.flex} />
        <StatusPill post={post} />
      </View>
      <Text style={[type.title2, styles.label]} selectable>
        {post.topic}
      </Text>
      <Text style={[type.subhead, styles.secondary]}>
        {[whenLabel(post.publishAt), direction, manual && post.assigneeName ? `выкладывает ${post.assigneeName}` : null].filter(Boolean).join(' · ')}
      </Text>
    </View>
  );
}

/** Картинки и видео: листаются, у каждой позиции — варианты и действия. */
function MediaBlock({ post, disabled, acting, onRun }: { post: SmmPost; disabled: boolean; acting: string | null; onRun: (name: string, job: () => Promise<unknown>, title?: string) => Promise<void> }) {
  const club = useClubKey();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const gutter = usePageGutter();
  const [page, setPage] = useState(0);
  const media = selectedMedia(post);
  const vertical = post.format === 'story' || post.format === 'reel';
  const inner = Math.min(width - gutter.paddingLeft - gutter.paddingRight, 480);
  const ratio = vertical ? 16 / 9 : 5 / 4;
  const height = Math.min(inner * ratio, MAX_MEDIA_HEIGHT);
  const mediaWidth = Math.round(height / ratio);
  const current = media[Math.min(page, Math.max(media.length - 1, 0))];
  const variants = current?.kind === 'image' ? post.media.filter((m) => m.kind === 'image' && m.sort === current.sort && m.status === 'done' && m.url) : [];

  const upload = async () => {
    const asset = await pickMedia('Своё фото или видео', ['images', 'videos']);
    if (!asset) return;
    await onRun('upload', () => uploadAsset(`/smm/posts/${post.id}/media`, asset).then(() => refreshPost(club, post.id)), 'Файл не загрузился');
  };
  const regenerate = () => onRun('image', () => postAction(club, post.id, 'image', current?.kind === 'image' ? { mediaId: current.id } : {}), 'Картинка не получилась');
  const describe = () =>
    promptText('Какую картинку нарисовать?', 'Опишите сцену своими словами — Tai нарисует новый вариант.', [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Нарисовать', onPress: (text?: string) => void (text?.trim() ? onRun('image', () => postAction(club, post.id, 'image', { prompt: text.trim(), mediaId: current?.kind === 'image' ? current.id : undefined }), 'Картинка не получилась') : undefined) },
    ]);
  const video = () =>
    promptText(
      'Видео нейросетью',
      'Tai продумает сцену, сделает реалистичный первый кадр (если сюжет у вас в клубе — в нужной зоне) и оживит его: 8 секунд со звуком, вертикально, около 48 ₽, пара минут. Можно написать, что должно быть в ролике.',
      [
        { text: 'Отмена', style: 'cancel' },
        { text: 'Сделать', onPress: (wish?: string) => void onRun('video', () => postAction(club, post.id, 'video', wish && wish.trim().length >= 10 ? { prompt: wish.trim() } : {}), 'Видео не запустилось') },
      ],
    );
  const remove = () =>
    current &&
    Alert.alert(current.kind === 'video' ? 'Убрать видео?' : media.length > 1 ? `Убрать слайд ${page + 1}?` : 'Убрать картинку?', 'Файл и его варианты уйдут из публикации.', [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Убрать',
        style: 'destructive',
        onPress: () =>
          void onRun('remove', async () => {
            await mediaAction(club, post.id, current.id, null);
            setPage((p) => Math.max(0, Math.min(p, media.length - 2)));
          }, 'Не убралось'),
      },
    ]);
  const editable = post.status !== 'published';

  return (
    <View style={styles.mediaBlock}>
      {media.length ? (
        <ScrollView
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          style={{ width: mediaWidth, alignSelf: 'center' }}
          onMomentumScrollEnd={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / mediaWidth))}>
          {media.map((m) => (
            <MediaItem key={m.id} media={m} width={mediaWidth} height={height} />
          ))}
        </ScrollView>
      ) : (
        <View style={[styles.mediaEmpty, { height: Math.min(height, 220) }]}>
          <SymbolView name="photo.on.rectangle.angled" size={36} tintColor={colors.tertiaryLabel} />
          <Text style={[type.subhead, styles.secondary, styles.center]}>{post.status === 'idea' ? 'Картинку Tai нарисует вместе с текстом' : 'Визуала пока нет'}</Text>
        </View>
      )}
      {media.length > 1 ? (
        <View style={styles.dots}>
          {media.map((m, i) => (
            <Animated.View key={m.id} layout={glide} style={[styles.dot, i === page && styles.dotActive]} />
          ))}
        </View>
      ) : null}
      {variants.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.variants}>
          {variants.map((v) => (
            <Pressable key={v.id} onPress={() => !v.selected && void onRun('pick', () => mediaAction(club, post.id, v.id, true))} accessibilityRole="button" accessibilityLabel="Выбрать вариант">
              <Image source={{ uri: v.url! }} style={[styles.variant, v.selected && styles.variantOn]} contentFit="cover" />
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        <ChipButton title={acting === 'image' ? 'Рисую…' : 'Новый вариант'} icon="wand.and.stars" disabled={disabled || !!acting} onPress={() => void regenerate()} />
        <ChipButton title="Описать картинку" icon="text.bubble" disabled={disabled || !!acting} onPress={describe} />
        <ChipButton title="Из архива" icon="photo.stack" disabled={!editable || !!acting} onPress={() => router.push({ pathname: '/manage/smm/library', params: { postId: post.id } })} />
        <ChipButton title={acting === 'upload' ? 'Загружаю…' : 'Своё фото/видео'} icon="square.and.arrow.up.on.square" disabled={!editable || !!acting} onPress={() => void upload()} />
        <ChipButton title="Видео ИИ" icon="film" disabled={disabled || !!acting || post.media.some((m) => m.kind === 'video' && m.status === 'pending')} onPress={video} />
        {media.length > 1 && editable ? <ChipButton title="Порядок" icon="arrow.up.arrow.down" disabled={disabled || !!acting} onPress={() => router.push({ pathname: '/manage/smm/order', params: { postId: post.id } })} /> : null}
        {current?.url && current.status === 'done' ? <ChipButton title="Сохранить" icon="square.and.arrow.down" onPress={() => void shareMedia(current.url!)} /> : null}
        {current && current.status !== 'pending' && editable ? <ChipButton title={acting === 'remove' ? 'Убираю…' : 'Убрать'} icon="trash" disabled={disabled || !!acting} onPress={remove} /> : null}
      </ScrollView>
    </View>
  );
}

/**
 * Медиа, которые на глазах у человека были «в работе»: готовая картинка один раз
 * проступает из-под инея. Открытые позже — сразу обычной картинкой.
 */
const thawing = new Set<string>();
const thawed = new Set<string>();

function MediaItem({ media, width, height }: { media: SmmMedia; width: number; height: number }) {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (media.status === 'pending') thawing.add(media.id);
  }, [media.id, media.status]);

  if (media.status === 'pending') {
    const label = media.kind === 'video' ? 'Снимаю видео' : media.source === 'archive' ? 'Беру фото из архива' : 'Рисую картинку';
    return <TaiGenerating width={width} height={height} label={label} hint={media.kind === 'video' ? 'Пара минут — пришлю уведомление' : undefined} />;
  }
  if (media.kind === 'video') {
    return (
      <Pressable onPress={() => media.url && void Linking.openURL(media.url)} style={[styles.mediaItem, styles.mediaPending, { width, height }]} accessibilityRole="button" accessibilityLabel="Смотреть видео">
        <SymbolView name="play.circle.fill" size={64} tintColor="white" />
        <Text style={[type.subhead, styles.onDark]}>{media.source === 'ai' ? 'Видео нейросети' : 'Ваше видео'}</Text>
      </Pressable>
    );
  }
  if (media.url && thawing.has(media.id) && !thawed.has(media.id)) {
    return (
      <TaiRevealImage
        uri={media.url}
        width={width}
        height={height}
        onDone={() => {
          thawed.add(media.id);
          thawing.delete(media.id);
          rerender();
        }}
      />
    );
  }
  return <Image source={{ uri: media.url ?? undefined }} style={[styles.mediaItem, { width, height }]} contentFit="cover" transition={250} recyclingKey={media.id} />;
}

function BodyBlock({ post, onEdit }: { post: SmmPost; onEdit: () => void }) {
  const text = plainText(post.body);
  if (!text) return null;
  const label = post.format === 'story' ? 'Текст на сторис' : post.platform === 'instagram' ? 'Подпись' : 'Текст поста';
  return (
    <Card>
      <View style={styles.cardHead}>
        <Text style={[type.headline, styles.label, styles.flex]}>{label}</Text>
        <Text style={[type.caption1, styles.secondary]}>{`${text.length} зн.`}</Text>
      </View>
      <Text style={[type.body, styles.label]} selectable>
        {text}
      </Text>
      <View style={styles.row}>
        {post.status !== 'published' ? <ChipButton title="Изменить" icon="pencil" onPress={onEdit} /> : null}
        <ChipButton title="Поделиться текстом" icon="square.and.arrow.up" onPress={() => shareText(text)} />
      </View>
    </Card>
  );
}

function ScriptBlock({ post }: { post: SmmPost }) {
  const s = post.script!;
  const story = post.format === 'story';
  return (
    <Card>
      <Text style={[type.headline, styles.label]}>{story ? 'Кадры сторис' : 'Сценарий рилс'}</Text>
      <View style={styles.hook}>
        <Text style={[type.caption1, styles.secondary]}>{story ? 'ТЕМА ДНЯ' : `ЗАЦЕПКА${s.formula ? ` · ${s.formula.toUpperCase()}` : ''}`}</Text>
        <Text style={[type.callout, styles.label, styles.bold]} selectable>
          {s.hook}
        </Text>
      </View>
      {s.shots.map((shot, i) => (
        <View key={`${i}-${shot.text.slice(0, 12)}`} style={styles.shot}>
          <View style={styles.shotNumber}>
            <Text style={[type.caption1, styles.onAccent]}>{i + 1}</Text>
          </View>
          <View style={styles.flex}>
            <Text style={[type.subhead, styles.label]} selectable>
              {shot.text}
            </Text>
            {shot.overlay ? <Text style={[type.footnote, styles.secondary]}>{`На экране: «${shot.overlay}»`}</Text> : null}
            {shot.sticker ? <Text style={[type.footnote, { color: colors.accent }]}>{`Стикер: ${shot.sticker}`}</Text> : null}
          </View>
          {shot.seconds ? <Text style={[type.caption1, styles.secondary]}>{`${shot.seconds} с`}</Text> : null}
        </View>
      ))}
      {[s.audio ? `Звук: ${s.audio}` : null, s.cast ? `Кто снимает: ${s.cast}` : null, s.tips ? `Совет: ${s.tips}` : null]
        .filter(Boolean)
        .map((line) => (
          <Text key={line!} style={[type.footnote, styles.secondary]} selectable>
            {line}
          </Text>
        ))}
    </Card>
  );
}

function IdeaBlock({ post }: { post: SmmPost }) {
  const [open, setOpen] = useState(post.status === 'idea');
  if (!post.brief && !post.visual) return null;
  return (
    <Card>
      <Pressable onPress={() => setOpen((v) => !v)} style={styles.cardHead} accessibilityRole="button" accessibilityState={{ expanded: open }}>
        <Text style={[type.headline, styles.label, styles.flex]}>Идея</Text>
        <SymbolView name={open ? 'chevron.up' : 'chevron.down'} size={13} tintColor={colors.tertiaryLabel} />
      </Pressable>
      {open ? (
        <>
          {post.brief ? (
            <Text style={[type.subhead, styles.label]} selectable>
              {post.brief}
            </Text>
          ) : null}
          {post.visual ? <Text style={[type.footnote, styles.secondary]}>{`Визуал: ${post.visual}`}</Text> : null}
        </>
      ) : null}
    </Card>
  );
}

const STAT_LABELS: [keyof SmmStats, string][] = [
  ['views', 'Просмотры'],
  ['reach', 'Охват'],
  ['likes', 'Лайки'],
  ['reactions', 'Реакции'],
  ['comments', 'Комменты'],
  ['shares', 'Репосты'],
  ['saves', 'Сохранения'],
];

/** Шкала: коридор прогноза (обычно) и где оказался факт. */
function ForecastScale({ forecast, actual }: { forecast: SmmForecast; actual?: number }) {
  const max = Math.max(forecast.high * 1.35, (actual ?? 0) * 1.1, 1);
  const pos = (v: number) => `${Math.min(100, (v / max) * 100)}%` as const;
  return (
    <View style={styles.scale} accessible accessibilityLabel={`Обычно от ${forecast.low} до ${forecast.high}${actual != null ? `, факт ${actual}` : ''}`}>
      <View style={[styles.scaleBand, { left: pos(forecast.low), width: `${Math.max(2, ((forecast.high - forecast.low) / max) * 100)}%` }]} />
      <View style={[styles.scaleMark, { left: pos(forecast.expected) }]} />
      {actual != null ? <View style={[styles.scaleActual, { left: pos(actual) }]} /> : null}
    </View>
  );
}

/**
 * Прогноз и результат: сколько просмотров ждём (по похожим постам площадки), что
 * вышло на деле и все цифры публикации. Цифры приходят по API сами.
 */
function ResultBlock({ post }: { post: SmmPost }) {
  const published = post.status === 'published';
  const f = post.forecast;
  if (!published && (!f || post.status === 'skipped')) return null;
  const views = post.stats.views;
  const items = STAT_LABELS.filter(([key]) => typeof post.stats[key] === 'number');
  const diff = published && f && typeof views === 'number' && f.expected > 0 ? Math.round((views / f.expected - 1) * 100) : null;
  const verdictColor = diff == null ? colors.secondaryLabel : views! > f!.high ? colors.green : views! < f!.low ? colors.orange : colors.label;
  const where = post.platform === 'telegram' ? 'канала' : 'Instagram';
  return (
    <Card>
      <View style={styles.cardHead}>
        <Text style={[type.headline, styles.label, styles.flex]}>{published ? 'Прогноз и результат' : 'Прогноз'}</Text>
        {published && post.publishedUrl ? (
          <Pressable onPress={() => void Linking.openURL(post.publishedUrl!)} hitSlop={8} accessibilityRole="link">
            <Text style={[type.subhead, { color: colors.accent }]}>Открыть</Text>
          </Pressable>
        ) : null}
      </View>
      {f ? (
        <View style={styles.forecastRow}>
          <View style={styles.flex}>
            <Text style={[type.caption1, styles.secondary]}>ПРОГНОЗ</Text>
            <Text style={[type.title2, styles.label, type.amount]}>{`~${fmt(f.expected)}`}</Text>
            <Text style={[type.caption1, styles.secondary]}>{`просмотров · обычно ${fmt(f.low)}–${fmt(f.high)}`}</Text>
          </View>
          {published ? (
            <View style={styles.flex}>
              <Text style={[type.caption1, styles.secondary]}>ФАКТ</Text>
              <Text style={[type.title2, type.amount, { color: verdictColor }]}>{typeof views === 'number' ? fmt(views) : '—'}</Text>
              <Text style={[type.caption1, { color: verdictColor }]}>{diff == null ? 'цифры придут в течение часа' : diff >= 0 ? `на ${diff}% больше прогноза` : `на ${-diff}% меньше прогноза`}</Text>
            </View>
          ) : null}
        </View>
      ) : null}
      {f ? <ForecastScale forecast={f} actual={published && typeof views === 'number' ? views : undefined} /> : null}
      {published && items.length ? (
        <View style={styles.stats}>
          {items.map(([key, label]) => (
            <View key={key} style={styles.stat}>
              <Text style={[type.title3, styles.label, type.amount]}>{fmt(post.stats[key] as number)}</Text>
              <Text style={[type.caption1, styles.secondary]}>{label}</Text>
            </View>
          ))}
        </View>
      ) : null}
      <Text style={[type.footnote, styles.secondary]}>
        {[
          f ? `Прогноз — по ${f.basis} похожим постам ${where}${f.frozen ? ', зафиксирован в момент выхода' : ''}.` : `Прогноза пока нет — у ${where} мало истории.`,
          published ? 'Цифры Tai берёт по API: первые двое суток — каждый час, потом раз в день.' : null,
        ]
          .filter(Boolean)
          .join(' ')}
      </Text>
    </Card>
  );
}

/** Следующий шаг по статусу — одна главная кнопка и, если нужно, вторая. */
function NextStep({ post, canApprove, acting, working, onAction }: { post: SmmPost; canApprove: boolean; acting: string | null; working: boolean; onAction: (name: string, body?: unknown, title?: string) => Promise<void> }) {
  const auto = autoPublishes(post);
  const when = whenLabel(post.publishAt);
  const insertLink = () =>
    promptText('Ссылка на публикацию', 'Скопируйте её в приложении соцсети: ⋯ → «Ссылка».', [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Сохранить', onPress: (url?: string) => void (url?.trim() ? onAction('link', { url: url.trim() }, 'Ссылка не сохранилась') : undefined) },
    ], 'plain-text', '', 'url');
  if (working) return null;

  switch (post.status) {
    case 'idea':
      return (
        <View style={styles.next}>
          <Text style={[type.footnote, styles.secondary, styles.center]}>{`Tai подготовит пост заранее сам. Можно не ждать:`}</Text>
          <BigButton title="Tai, напиши сейчас" icon="sparkles" busy={acting === 'write'} onPress={() => void onAction('write')} />
        </View>
      );
    case 'draft':
    case 'review':
      return (
        <View style={styles.next}>
          {canApprove ? (
            <>
              <BigButton title="Одобрить" icon="checkmark" busy={acting === 'approve'} onPress={() => void onAction('approve')} />
              <Text style={[type.footnote, styles.secondary, styles.center]}>
                {auto ? `Выйдет в канал сам: ${when}` : `${when} Tai пришлёт файлы и текст тому, кто выкладывает`}
              </Text>
              <BigButton tone="plain" title={auto ? 'Опубликовать сейчас' : 'Передать сейчас'} icon={auto ? 'paperplane' : 'tray.and.arrow.up'} busy={acting === 'publish'} onPress={() => void onAction('publish', undefined, 'Не опубликовалось')} />
            </>
          ) : (
            <Text style={[type.subhead, styles.secondary, styles.center]}>Ждёт одобрения владельца. Замечание можно оставить ниже.</Text>
          )}
        </View>
      );
    case 'approved':
      if (auto) {
        return (
          <View style={styles.next}>
            <Text style={[type.subhead, styles.label, styles.center]}>{`✓ Одобрено — выйдет в канал сам: ${when}`}</Text>
            <BigButton tone="plain" title="Опубликовать сейчас" icon="paperplane" busy={acting === 'publish'} onPress={() => void onAction('publish', undefined, 'Не опубликовалось')} />
          </View>
        );
      }
      if (!post.handoffAt) {
        const needsVideo = post.format === 'reel' && !post.media.some((m) => m.kind === 'video' && m.status === 'done');
        return (
          <View style={styles.next}>
            <Text style={[type.subhead, styles.label, styles.center]}>{`✓ Одобрено. ${when} Tai пришлёт файлы и текст${post.assigneeName ? ` ${post.assigneeName}` : ''} в Telegram`}</Text>
            {needsVideo ? <Text style={[type.footnote, styles.secondary, styles.center]}>Загрузите снятое видео в публикацию — если Instagram подключён по API, Tai выложит рилс сам.</Text> : null}
            <BigButton tone="plain" title="Передать сейчас" icon="tray.and.arrow.up" busy={acting === 'publish'} onPress={() => void onAction('publish', undefined, 'Не передалось')} />
          </View>
        );
      }
      return (
        <View style={styles.next}>
          <Text style={[type.subhead, styles.label, styles.center]}>Файлы и текст отправлены. Выложите и пришлите ссылку — Tai напомнит, если забудете.</Text>
          <BigButton title="Вставить ссылку" icon="link" busy={acting === 'link'} onPress={insertLink} />
        </View>
      );
    case 'published':
      return null;
    case 'skipped':
      return (
        <View style={styles.next}>
          <Text style={[type.subhead, styles.secondary, styles.center]}>Не выкладываем — публикация осталась в плане серой.</Text>
          <BigButton tone="plain" title="Вернуть в работу" icon="arrow.uturn.backward" busy={acting === 'restore'} onPress={() => void onAction('restore')} />
        </View>
      );
    case 'failed':
      return (
        <View style={styles.next}>
          <BigButton title={auto ? 'Опубликовать ещё раз' : 'Передать ещё раз'} icon="arrow.clockwise" busy={acting === 'publish'} onPress={() => void onAction('publish', undefined, 'Не опубликовалось')} />
          {!auto ? <BigButton tone="plain" title="Уже выложено — вставить ссылку" icon="link" onPress={insertLink} /> : null}
        </View>
      );
  }
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.groupedBackground },
  centerBox: { alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1, minWidth: 0 },
  content: { gap: space.md, paddingTop: space.md, paddingBottom: space.xxxl },
  label: { color: colors.label },
  secondary: { color: colors.secondaryLabel },
  onDark: { color: 'white', textAlign: 'center' },
  onAccent: { color: 'white', fontWeight: '700' },
  bold: { fontWeight: '600' },
  center: { textAlign: 'center' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  header: { gap: space.xs },
  headerMeta: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  mediaBlock: { gap: space.sm },
  mediaItem: { borderRadius: 20, borderCurve: 'continuous', backgroundColor: colors.fill },
  mediaPending: { alignItems: 'center', justifyContent: 'center', gap: space.sm, backgroundColor: '#1C1C1E', overflow: 'hidden' },
  mediaEmpty: { borderRadius: 20, borderCurve: 'continuous', backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center', gap: space.sm, padding: space.lg },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.tertiaryLabel },
  dotActive: { width: 18, backgroundColor: colors.accent },
  variants: { gap: space.sm, paddingHorizontal: 2 },
  variant: { width: 54, height: 66, borderRadius: 10, opacity: 0.6 },
  variantOn: { opacity: 1, borderWidth: 2, borderColor: colors.accent },
  chips: { gap: space.sm, paddingVertical: 2 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  hook: { gap: 2, padding: space.md, borderRadius: 14, borderCurve: 'continuous', backgroundColor: colors.fill },
  shot: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  shotNumber: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: space.lg },
  stat: { minWidth: 72 },
  forecastRow: { flexDirection: 'row', gap: space.lg },
  scale: { height: 14, justifyContent: 'center' },
  scaleBand: { position: 'absolute', height: 8, borderRadius: 4, backgroundColor: colors.fill },
  scaleMark: { position: 'absolute', width: 2, height: 14, marginLeft: -1, backgroundColor: colors.secondaryLabel },
  scaleActual: { position: 'absolute', width: 12, height: 12, marginLeft: -6, borderRadius: 6, backgroundColor: colors.accent, borderWidth: 2, borderColor: colors.card },
  next: { gap: space.sm, marginTop: space.xs },
  remarksTitle: { marginTop: space.md },
});
