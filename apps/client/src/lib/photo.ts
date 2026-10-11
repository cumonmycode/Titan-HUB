// Фото профиля: снимок с камеры или выбор из галереи (квадрат) и файл для отправки на сервер.
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

type PhotoSource = 'camera' | 'library';

/** Спросить, откуда взять фото: снять (фронтальная камера) или выбрать из галереи. */
function askSource(): Promise<PhotoSource | null> {
  return new Promise((resolve) => {
    Alert.alert('Фото профиля', undefined, [
      { text: 'Снять фото', onPress: () => resolve('camera') },
      { text: 'Выбрать из галереи', onPress: () => resolve('library') },
      { text: 'Отмена', style: 'cancel', onPress: () => resolve(null) },
    ], { cancelable: true, onDismiss: () => resolve(null) });
  });
}

function explainSettings(title: string, text: string) {
  Alert.alert(title, text, [
    { text: 'Отмена', style: 'cancel' },
    { text: 'Открыть настройки', onPress: () => void Linking.openSettings() },
  ]);
}

/**
 * Квадратное фото с камеры или из галереи; null — отмена. Галерее разрешение не
 * нужно (системный выбор фото), камере — да: если доступ закрыт, ведём в настройки.
 */
export async function pickSquarePhoto(): Promise<ImagePicker.ImagePickerAsset | null> {
  const source = await askSource();
  if (!source) return null;
  if (source === 'camera') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      explainSettings('Нет доступа к камере', 'Разрешите My Titan доступ к камере в настройках телефона.');
      return null;
    }
    const shot = await ImagePicker.launchCameraAsync({ ...PICK_OPTIONS, cameraType: ImagePicker.CameraType.front });
    return shot.canceled ? null : (shot.assets[0] ?? null);
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
