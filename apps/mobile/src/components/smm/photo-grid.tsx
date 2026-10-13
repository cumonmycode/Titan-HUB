import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';

import { ApiError } from '@/lib/api';
import { chooseAction } from '@/lib/dialog';
import { haptic } from '@/lib/haptics';
import { usePageGutter } from '@/lib/layout';
import { useClubKey } from '@/lib/queries';
import { addArchivePhoto, type SmmLibraryPhoto } from '@/lib/smm-api';
import { colors, space } from '@/lib/theme';

export const PHOTO_COLUMNS = 3;
const KIND_LABEL: Record<string, string> = { template: 'Шаблон сторис', logo: 'Логотип', design: 'Дизайн', video: 'Видео' };

/** Сторона квадратика сетки при текущей ширине экрана. */
export function usePhotoSize(): number {
  const gutter = usePageGutter();
  const { width } = useWindowDimensions();
  const inner = width - gutter.paddingLeft - gutter.paddingRight;
  return Math.floor((inner - space.xs * (PHOTO_COLUMNS - 1)) / PHOTO_COLUMNS);
}

/**
 * Нажатие на фото архива: что на нём (описание Tai) и действия — добавить в
 * публикацию (если открыли из поста) или открыть оригинал в Google Диске.
 * `back` — сколько экранов закрыть после добавления (вернуться в публикацию).
 */
export function usePhotoActions(postId: string | undefined, back: number) {
  const router = useRouter();
  const club = useClubKey();
  const [adding, setAdding] = useState<string | null>(null);

  const add = async (photo: SmmLibraryPhoto) => {
    if (!postId) return;
    setAdding(photo.id);
    try {
      await addArchivePhoto(club, postId, photo.id);
      haptic.success();
      if (router.canDismiss()) router.dismiss(back);
      else router.back();
    } catch (error) {
      Alert.alert('Фото не добавилось', error instanceof ApiError || error instanceof Error ? error.message : String(error));
    } finally {
      setAdding(null);
    }
  };

  const open = (photo: SmmLibraryPhoto) => {
    haptic.selection();
    const album = photo.path.split(' / ').pop() || 'Архив';
    chooseAction(KIND_LABEL[photo.kind] ? `${KIND_LABEL[photo.kind]} · ${album}` : album, photo.description || photo.name, [
      ...(postId ? [{ text: 'Добавить в публикацию', onPress: () => void add(photo) }] : []),
      { text: 'Открыть оригинал', onPress: () => void Linking.openURL(`https://drive.google.com/file/d/${photo.id}/view`) },
      { text: 'Закрыть', style: 'cancel' as const },
    ]);
  };

  return { open, adding };
}

export function PhotoTile({ photo, size, busy, onPress }: { photo: SmmLibraryPhoto; size: number; busy: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [pressed && styles.pressed]} accessibilityRole="imagebutton" accessibilityLabel={photo.description || photo.name}>
      <Image source={{ uri: photo.thumb }} style={{ width: size, height: size, borderRadius: 8, backgroundColor: colors.fill }} contentFit="cover" recyclingKey={photo.id} transition={150} />
      {busy ? (
        <View style={[styles.busy, { width: size, height: size }]}>
          <ActivityIndicator color="white" />
        </View>
      ) : null}
    </Pressable>
  );
}

/** Небольшая сетка (результаты поиска): для альбома на сотни фото — список с подгрузкой. */
export function PhotoGrid({ photos, postId, back = 1 }: { photos: SmmLibraryPhoto[]; postId?: string; back?: number }) {
  const size = usePhotoSize();
  const { open, adding } = usePhotoActions(postId, back);
  return (
    <View style={styles.grid}>
      {photos.map((photo) => (
        <PhotoTile key={photo.id} photo={photo} size={size} busy={adding === photo.id} onPress={() => open(photo)} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  pressed: { opacity: 0.7 },
  busy: { position: 'absolute', borderRadius: 8, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
});
