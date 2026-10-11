// Фото профиля: выбор из галереи (квадрат) и файл для отправки на сервер.
// Нужен в анкете нового клиента (вход) и на экране профиля.
import { File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { Alert, Linking } from 'react-native';

const PICK_OPTIONS: ImagePicker.ImagePickerOptions = {
  mediaTypes: ['images'],
  allowsEditing: true,
  aspect: [1, 1],
  quality: 0.6,
};

/** Галерея → квадратное фото; null — отмена или нет доступа (сами объясняем, как дать). */
export async function pickSquarePhoto(): Promise<ImagePicker.ImagePickerAsset | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    Alert.alert('Нужен доступ к фото', 'Разрешите My Titan доступ к фото в настройках телефона.', [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Открыть настройки', onPress: () => void Linking.openSettings() },
    ]);
    return null;
  }
  const result = await ImagePicker.launchImageLibraryAsync(PICK_OPTIONS);
  return result.canceled ? null : (result.assets[0] ?? null);
}

/**
 * Файл для FormData. Глобальный fetch в Expo 57 — expo/fetch: RN-объект
 * `{ uri, name, type }` он не принимает («Unsupported FormDataPart implementation»),
 * запрос не уходит и выглядит как «нет соединения». Поэтому только File.
 */
export function photoFile(uri: string): File {
  return new File(uri);
}
