import { Stack, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, FlatList, StyleSheet, View } from 'react-native';

import { PHOTO_COLUMNS, PhotoTile, usePhotoActions, usePhotoSize } from '@/components/smm/photo-grid';
import { Text } from '@/components/text';
import { usePageGutter } from '@/lib/layout';
import { useSmmAlbum } from '@/lib/smm-api';
import { colors, space, type } from '@/lib/theme';

/** Альбом фотоархива: все фото сеткой (в альбоме бывает больше тысячи — список с подгрузкой). */
export default function SmmAlbumScreen() {
  const { id = '', title = 'Альбом', postId } = useLocalSearchParams<{ id: string; title?: string; postId?: string }>();
  const gutter = usePageGutter();
  const size = usePhotoSize();
  const query = useSmmAlbum(id);
  // Добавили фото — закрываем альбом и архив, возвращаемся в публикацию.
  const { open, adding } = usePhotoActions(postId || undefined, 2);
  const photos = query.data?.photos ?? [];

  return (
    <View style={styles.screen}>
      <Stack.Title>{title}</Stack.Title>
      {!query.data ? (
        <View style={styles.center}>{query.error ? <Text style={[type.body, styles.secondary]}>{query.error.message}</Text> : <ActivityIndicator />}</View>
      ) : (
        <FlatList
          data={photos}
          keyExtractor={(p) => p.id}
          numColumns={PHOTO_COLUMNS}
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={[styles.content, gutter]}
          columnWrapperStyle={styles.row}
          initialNumToRender={24}
          windowSize={7}
          ListHeaderComponent={
            <Text style={[type.footnote, styles.secondary, styles.note]}>
              {postId ? 'Нажмите на фото — оно встанет в публикацию, обрезанное под формат.' : `${photos.length} фото. Нажмите, чтобы увидеть, что Tai знает о фото.`}
            </Text>
          }
          renderItem={({ item }) => <PhotoTile photo={item} size={size} busy={adding === item.id} onPress={() => open(item)} />}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.groupedBackground },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { gap: space.xs, paddingTop: space.md, paddingBottom: space.xxxl },
  row: { gap: space.xs },
  secondary: { color: colors.secondaryLabel },
  note: { marginBottom: space.sm },
});
