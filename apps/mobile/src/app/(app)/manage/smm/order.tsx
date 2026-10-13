import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { EditorToolbar } from '@/components/editor-toolbar';
import { glide } from '@/components/smm/motion';
import { Text } from '@/components/text';
import { ApiError } from '@/lib/api';
import { haptic } from '@/lib/haptics';
import { usePageGutter } from '@/lib/layout';
import { useClubKey } from '@/lib/queries';
import { reorderMedia, selectedMedia, useSmmPost, type SmmMedia, type SmmPost } from '@/lib/smm-api';
import { colors, space, type } from '@/lib/theme';

/** Высота строки и зазор — шаг перестановки при перетаскивании. */
const ROW = 86;
const GAP = space.sm;
const STEP = ROW + GAP;
const HOLD_MS = 180;

/**
 * Порядок слайдов карусели и кадров сторис: удерживайте слайд и тяните — соседи
 * расступаются. В таком порядке Tai выложит их сам или отдаст выкладывающему.
 */
export default function SmmOrderScreen() {
  const { postId = '' } = useLocalSearchParams<{ postId: string }>();
  const post = useSmmPost(postId).data?.post;
  if (!post) {
    return (
      <View style={[styles.screen, styles.center]}>
        <ActivityIndicator />
      </View>
    );
  }
  return <OrderList post={post} />;
}

function OrderList({ post }: { post: SmmPost }) {
  const router = useRouter();
  const club = useClubKey();
  const gutter = usePageGutter();
  const initial = selectedMedia(post).filter((m) => m.status === 'done');
  const [order, setOrder] = useState<SmmMedia[]>(initial);
  const [dragging, setDragging] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const changed = order.some((m, i) => m.id !== initial[i]?.id);
  const noun = post.format === 'story' ? 'Кадр' : 'Слайд';

  /** Поставить слайд на место `to`. По id — повторный вызов с тем же местом ничего не меняет. */
  const moveTo = (id: string, to: number) =>
    setOrder((list) => {
      const from = list.findIndex((m) => m.id === id);
      if (from < 0 || from === to || to < 0 || to >= list.length) return list;
      const next = [...list];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item!);
      return next;
    });

  const save = async () => {
    setSaving(true);
    try {
      await reorderMedia(club, post.id, order.map((m) => m.sort));
      haptic.success();
      router.back();
    } catch (error) {
      Alert.alert('Порядок не сохранился', error instanceof ApiError || error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <EditorToolbar title="Порядок" canSave={changed} busy={saving} onSave={() => void save()} />
      <ScrollView style={styles.screen} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={[styles.content, gutter]} scrollEnabled={!dragging}>
        <Text style={[type.footnote, styles.secondary]}>{`Удерживайте ${noun.toLowerCase()} и тяните. ${post.format === 'story' ? 'Кадры выйдут' : 'Слайды пойдут'} в этом порядке; первый — то, что увидят в ленте.`}</Text>
        {order.map((m, i) => (
          <DraggableRow
            key={m.id}
            media={m}
            index={i}
            count={order.length}
            noun={noun}
            active={dragging === m.id}
            onStart={() => setDragging(m.id)}
            onMove={(to) => moveTo(m.id, to)}
            onEnd={() => setDragging(null)}
          />
        ))}
      </ScrollView>
    </>
  );
}

function DraggableRow({ media, index, count, noun, active, onStart, onMove, onEnd }: {
  media: SmmMedia;
  index: number;
  count: number;
  noun: string;
  active: boolean;
  onStart: () => void;
  onMove: (to: number) => void;
  onEnd: () => void;
}) {
  const dy = useSharedValue(0);
  const lift = useSharedValue(0);
  // Место при захвате и последнее место под пальцем — сдвиг считаем от захвата.
  const from = useSharedValue(0);
  const last = useSharedValue(0);

  const pan = Gesture.Pan()
    .runOnJS(true)
    .activateAfterLongPress(HOLD_MS)
    .onStart(() => {
      from.set(index);
      last.set(index);
      lift.set(withTiming(1, { duration: 120 }));
      haptic.medium();
      onStart();
    })
    .onUpdate((e) => {
      const start = from.get();
      const target = Math.max(0, Math.min(count - 1, start + Math.round(e.translationY / STEP)));
      if (target !== last.get()) {
        last.set(target);
        haptic.selection();
        onMove(target);
      }
      dy.set(e.translationY - (target - start) * STEP);
    })
    .onFinalize(() => {
      dy.set(withTiming(0, { duration: 140 }));
      lift.set(withTiming(0, { duration: 140 }));
      onEnd();
    });

  const animated = useAnimatedStyle(() => ({
    transform: [{ translateY: dy.get() }, { scale: 1 + lift.get() * 0.03 }],
    shadowOpacity: lift.get() * 0.25,
    zIndex: lift.get() > 0 ? 10 : 0,
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        layout={active ? undefined : glide}
        style={[styles.row, animated]}
        accessible
        accessibilityLabel={`${noun} ${index + 1}`}
        accessibilityHint="Удерживайте и тяните, чтобы переставить"
        accessibilityActions={[{ name: 'up', label: 'Выше' }, { name: 'down', label: 'Ниже' }]}
        onAccessibilityAction={(e) => onMove(e.nativeEvent.actionName === 'up' ? index - 1 : index + 1)}>
        {media.kind === 'video' ? (
          <View style={[styles.thumb, styles.video]}>
            <SymbolView name="play.fill" size={18} tintColor="white" />
          </View>
        ) : (
          <Image source={{ uri: media.url ?? undefined }} style={styles.thumb} contentFit="cover" recyclingKey={media.id} />
        )}
        <View style={styles.flex}>
          <Text style={[type.headline, styles.label]}>{`${noun} ${index + 1}`}</Text>
          <Text style={[type.caption1, styles.secondary]} numberOfLines={2}>
            {media.kind === 'video' ? 'Видео' : media.source === 'archive' ? 'Фото из архива' : media.source === 'upload' ? 'Своё фото' : 'Картинка Tai'}
          </Text>
        </View>
        <SymbolView name="line.3.horizontal" size={20} tintColor={active ? colors.accent : colors.tertiaryLabel} />
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.sheetBackground },
  center: { alignItems: 'center', justifyContent: 'center' },
  content: { gap: GAP, paddingTop: space.md, paddingBottom: space.xxxl },
  flex: { flex: 1, minWidth: 0, gap: 2 },
  label: { color: colors.label },
  secondary: { color: colors.secondaryLabel },
  row: {
    height: ROW,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.sm,
    paddingRight: space.lg,
    borderRadius: 16,
    borderCurve: 'continuous',
    backgroundColor: colors.card,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 16,
  },
  thumb: { width: 56, height: 70, borderRadius: 10, backgroundColor: colors.fill },
  video: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#1C1C1E' },
});
