import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/text';
import { ApiError } from '@/lib/api';
import { haptic } from '@/lib/haptics';
import { uploadImage, type ImageFit } from '@/lib/photo';
import { colors, space, type } from '@/lib/theme';

/** Фото публикации: широкий кадр для обложки и галереи сайта. */
const STORY_FIT: ImageFit = { long: 1920, short: 1280, quality: 0.82 };
const MAX_PHOTOS = 24;
const COLUMNS = 3;

/**
 * Фото публикации сайта: первое — обложка. Добавление — несколько снимков из
 * галереи сразу (загружаются по очереди), нажатие — «Сделать обложкой» или
 * «Убрать». Ссылки (https или /media/… сайта) показываются через resolve.
 */
export function PhotoGrid({ photos, onChange, resolve, width }: {
  photos: string[];
  onChange: (next: string[]) => void;
  resolve: (url: string) => string;
  width: number;
}) {
  const [uploading, setUploading] = useState(0);
  const size = Math.floor((width - space.sm * (COLUMNS - 1)) / COLUMNS);

  const add = async () => {
    haptic.light();
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Нужен доступ к фото', 'Разрешите доступ в настройках телефона.', [
        { text: 'Отмена', style: 'cancel' },
        { text: 'Открыть настройки', onPress: () => void Linking.openSettings() },
      ]);
      return;
    }
    const left = MAX_PHOTOS - photos.length;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: left, quality: 1 });
    if (result.canceled) return;
    const assets = result.assets.slice(0, left);
    setUploading(assets.length);
    let next = photos;
    for (const asset of assets) {
      try {
        next = [...next, await uploadImage(asset, STORY_FIT)];
        onChange(next);
      } catch (error) {
        Alert.alert('Фото не загрузилось', error instanceof ApiError ? error.message : String(error));
      } finally {
        setUploading((n) => n - 1);
      }
    }
    haptic.success();
  };

  const actions = (index: number) => {
    haptic.medium();
    const buttons: { text: string; style?: 'cancel' | 'destructive'; onPress?: () => void }[] = [{ text: 'Отмена', style: 'cancel' }];
    if (index > 0) buttons.push({ text: 'Сделать обложкой', onPress: () => onChange([photos[index]!, ...photos.filter((_, j) => j !== index)]) });
    buttons.push({ text: 'Убрать', style: 'destructive', onPress: () => onChange(photos.filter((_, j) => j !== index)) });
    Alert.alert(index === 0 ? 'Обложка' : 'Фото', undefined, buttons);
  };

  return (
    <View style={styles.grid}>
      {photos.map((url, i) => (
        <Pressable key={`${url}-${i}`} onPress={() => actions(i)} accessibilityRole="button" accessibilityLabel={i === 0 ? 'Обложка' : `Фото ${i + 1}`}>
          <Image source={{ uri: resolve(url) }} style={[styles.photo, { width: size, height: size }]} contentFit="cover" transition={150} />
          {i === 0 && (
            <View style={styles.cover}>
              <Text style={[type.caption2, styles.coverText]}>Обложка</Text>
            </View>
          )}
        </Pressable>
      ))}
      {Array.from({ length: uploading }, (_, i) => (
        <View key={`up-${i}`} style={[styles.photo, styles.tile, { width: size, height: size }]}>
          <ActivityIndicator />
        </View>
      ))}
      {photos.length + uploading < MAX_PHOTOS && (
        <Pressable onPress={() => void add()} accessibilityRole="button" accessibilityLabel="Добавить фото" style={({ pressed }) => [styles.photo, styles.tile, { width: size, height: size }, pressed && styles.pressed]}>
          <SymbolView name="plus" size={22} weight="semibold" tintColor={colors.accent} />
          <Text style={[type.caption1, styles.addText]}>Фото</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, paddingVertical: space.sm },
  photo: { borderRadius: 12, borderCurve: 'continuous', backgroundColor: colors.fill },
  tile: { alignItems: 'center', justifyContent: 'center', gap: 4 },
  cover: { position: 'absolute', left: 6, bottom: 6, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: 'rgba(0,0,0,0.6)' },
  coverText: { color: 'white', fontWeight: '700' },
  addText: { color: colors.accent, fontWeight: '600' },
  pressed: { opacity: 0.7 },
});
