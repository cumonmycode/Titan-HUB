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

export async function uploadImage(asset: ImagePicker.ImagePickerAsset, fit: ImageFit): Promise<string> {
  const w = asset.width ?? 0;
  const h = asset.height ?? 0;
  const scale = w && h ? Math.min(1, fit.long / Math.max(w, h), fit.short / Math.min(w, h)) : 1;
  const context = ImageManipulator.manipulate(asset.uri);
  if (scale < 1) context.resize({ width: Math.round(w * scale) });
  const image = await context.renderAsync();
  const saved = await image.saveAsync({ compress: fit.quality, format: SaveFormat.JPEG });
  const form = new FormData();
  // Глобальный fetch в Expo 57 — expo/fetch: RN-объект `{ uri, name, type }` он не принимает
  // («Unsupported FormDataPart implementation»), и запрос не уходил. Файл — только как File.
  form.append('file', new File(saved.uri));
  const { url } = await api.post<{ url: string }>('/upload/image', form);
  return url;
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
