import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Alert, Linking } from 'react-native';

import { api, ApiError } from './api';

/**
 * Загрузка картинок в хранилище клуба (`POST /upload/image`, multipart `file`): фото
 * профилей и картинки для ТВ. Сервер сверяет тип по байтам и держит лимит размера,
 * поэтому картинку всегда уменьшаем и пересохраняем в JPEG: снимок с камеры весит 2–5 МБ.
 */

/** Предел сторон картинки в пикселях и качество JPEG. */
export type ImageFit = { long: number; short: number; quality: number };

/** Фото профиля: квадрат, на аватаре больше 1080 px не видно. */
const AVATAR_FIT: ImageFit = { long: 1080, short: 1080, quality: 0.8 };

/** Обрезка в квадрат 1:1, сжатие делает `uploadImage`. */
const PICK_OPTIONS: ImagePicker.ImagePickerOptions = {
  mediaTypes: ['images'],
  allowsEditing: true,
  aspect: [1, 1],
  quality: 1,
};

/** Уменьшенная копия снимка в JPEG — как File для multipart. */
export async function compressedImage(asset: ImagePicker.ImagePickerAsset, fit: ImageFit): Promise<File> {
  const w = asset.width ?? 0;
  const h = asset.height ?? 0;
  const scale = w && h ? Math.min(1, fit.long / Math.max(w, h), fit.short / Math.min(w, h)) : 1;
  const context = ImageManipulator.manipulate(asset.uri);
  if (scale < 1) context.resize({ width: Math.round(w * scale) });
  const image = await context.renderAsync();
  const saved = await image.saveAsync({ compress: fit.quality, format: SaveFormat.JPEG });
  // Глобальный fetch в Expo 57 — expo/fetch: RN-объект `{ uri, name, type }` он не принимает
  // («Unsupported FormDataPart implementation»), и запрос не уходил. Файл — только как File.
  return new File(saved.uri);
}

export async function uploadImage(asset: ImagePicker.ImagePickerAsset, fit: ImageFit): Promise<string> {
  const form = new FormData();
  form.append('file', await compressedImage(asset, fit));
  const { url } = await api.post<{ url: string }>('/upload/image', form);
  return url;
}

/** Фото в переписку: без обрезки, длинная сторона до 1600 px — читается на телефоне. */
export const CHAT_PHOTO_FIT: ImageFit = { long: 1600, short: 1600, quality: 0.82 };

/** Снять или выбрать фото без обрезки (для чата). null — отменили или нет доступа. */
export async function pickChatPhoto(source: 'camera' | 'library'): Promise<ImagePicker.ImagePickerAsset | null> {
  const permission = source === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    Alert.alert(source === 'camera' ? 'Нужен доступ к камере' : 'Нужен доступ к фото', 'Разрешите доступ в настройках телефона.', [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Открыть настройки', onPress: () => void Linking.openSettings() },
    ]);
    return null;
  }
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1 };
  const result = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  return result.canceled ? null : (result.assets[0] ?? null);
}

/**
 * Показывает системный выбор «Снять / Из галереи», отдаёт ссылку на загруженное фото.
 * `null` — пользователь отменил; ошибки показываем сами и тоже отдаём `null`.
 */
export function pickAndUploadPhoto(title: string, onDone: (url: string) => void, onBusy?: (busy: boolean) => void): void {
  const run = async (source: 'camera' | 'library') => {
    const permission = source === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(source === 'camera' ? 'Нужен доступ к камере' : 'Нужен доступ к фото', 'Разрешите доступ в настройках телефона.', [
        { text: 'Отмена', style: 'cancel' },
        { text: 'Открыть настройки', onPress: () => void Linking.openSettings() },
      ]);
      return;
    }
    const result = source === 'camera' ? await ImagePicker.launchCameraAsync(PICK_OPTIONS) : await ImagePicker.launchImageLibraryAsync(PICK_OPTIONS);
    const asset = result.canceled ? null : result.assets[0];
    if (!asset) return;
    onBusy?.(true);
    try {
      onDone(await uploadImage(asset, AVATAR_FIT));
    } catch (error) {
      Alert.alert('Фото не загрузилось', error instanceof ApiError ? error.message : String(error));
    } finally {
      onBusy?.(false);
    }
  };

  Alert.alert(title, undefined, [
    { text: 'Отмена', style: 'cancel' },
    { text: 'Снять', onPress: () => void run('camera') },
    { text: 'Из галереи', onPress: () => void run('library') },
  ]);
}
