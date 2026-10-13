import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { EditorToolbar } from '@/components/editor-toolbar';
import { Text } from '@/components/text';
import { ApiError } from '@/lib/api';
import { haptic } from '@/lib/haptics';
import { usePageGutter } from '@/lib/layout';
import { useClubKey } from '@/lib/queries';
import { reorderMedia, selectedMedia, useSmmPost, type SmmMedia, type SmmPost } from '@/lib/smm-api';
import { colors, space, type, useAccentHex } from '@/lib/theme';

/**
 * Порядок слайдов карусели и кадров сторис: стрелками вверх-вниз. В таком порядке
 * Tai выложит их сам или отдаст выкладывающему.
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
  const accent = useAccentHex();
  const initial = selectedMedia(post).filter((m) => m.status === 'done');
  const [order, setOrder] = useState<SmmMedia[]>(initial);
  const [saving, setSaving] = useState(false);
  const changed = order.some((m, i) => m.id !== initial[i]?.id);
  const noun = post.format === 'story' ? 'Кадр' : 'Слайд';

  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= order.length) return;
    haptic.selection();
    setOrder((list) => {
      const next = [...list];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  };

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
      <ScrollView style={styles.screen} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={[styles.content, gutter]}>
        <Text style={[type.footnote, styles.secondary]}>{`${post.format === 'story' ? 'Кадры выйдут' : 'Слайды пойдут'} в этом порядке. Первый — то, что увидят в ленте.`}</Text>
        {order.map((m, i) => (
          <View key={m.id} style={styles.row}>
            {m.kind === 'video' ? (
              <View style={[styles.thumb, styles.video]}>
                <SymbolView name="play.fill" size={18} tintColor="white" />
              </View>
            ) : (
              <Image source={{ uri: m.url ?? undefined }} style={styles.thumb} contentFit="cover" recyclingKey={m.id} />
            )}
            <View style={styles.flex}>
              <Text style={[type.headline, styles.label]}>{`${noun} ${i + 1}`}</Text>
              <Text style={[type.caption1, styles.secondary]} numberOfLines={2}>
                {m.kind === 'video' ? 'Видео' : m.source === 'archive' ? 'Фото из архива' : m.source === 'upload' ? 'Своё фото' : 'Картинка Tai'}
              </Text>
            </View>
            <Pressable onPress={() => move(i, -1)} disabled={i === 0} hitSlop={6} style={[styles.arrow, i === 0 && styles.off]} accessibilityRole="button" accessibilityLabel={`${noun} ${i + 1} выше`}>
              <SymbolView name="chevron.up" size={18} tintColor={accent} />
            </Pressable>
            <Pressable onPress={() => move(i, 1)} disabled={i === order.length - 1} hitSlop={6} style={[styles.arrow, i === order.length - 1 && styles.off]} accessibilityRole="button" accessibilityLabel={`${noun} ${i + 1} ниже`}>
              <SymbolView name="chevron.down" size={18} tintColor={accent} />
            </Pressable>
          </View>
        ))}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.sheetBackground },
  center: { alignItems: 'center', justifyContent: 'center' },
  content: { gap: space.sm, paddingTop: space.md, paddingBottom: space.xxxl },
  flex: { flex: 1, minWidth: 0, gap: 2 },
  label: { color: colors.label },
  secondary: { color: colors.secondaryLabel },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.sm, borderRadius: 16, borderCurve: 'continuous', backgroundColor: colors.card },
  thumb: { width: 56, height: 70, borderRadius: 10, backgroundColor: colors.fill },
  video: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#1C1C1E' },
  arrow: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.fill },
  off: { opacity: 0.3 },
});
