import { Stack } from 'expo-router';
import { Platform } from 'react-native';
import { colors } from '@/lib/theme';
import { stackHeaderOptions } from '@/components/header-glass';

/**
 * Шторка не доходит до статус-бара, но шапка Android всё равно добавляла над собой отступ
 * его высоты — выходила пустая белая полоса. Отступ шапки native-stack берёт из
 * `statusBarTranslucent`: false — без отступа (окно при edge-to-edge не меняется).
 */
const SHEET_HEADER =
  Platform.OS === 'android'
    ? { statusBarTranslucent: false, headerStyle: { backgroundColor: colors.sheetBackground }, contentStyle: { backgroundColor: colors.sheetBackground } }
    : {};

/** Шторка смены: сводка, открытие, закрытие и кассовые операции — шагами внутри шторки. */
export default function ShiftLayout() {
  return (
    <Stack screenOptions={{ headerBackButtonDisplayMode: 'minimal', ...stackHeaderOptions, ...SHEET_HEADER }}>
      <Stack.Screen name="index" options={{ title: 'Смена' }} />
      {/* Свой заголовок с крестиком: экран бывает первым в шторке (из плашки «Смена закрыта»). */}
      <Stack.Screen name="open" options={{ title: 'Открыть смену', headerShown: false }} />
      <Stack.Screen name="close" options={{ title: 'Закрыть смену' }} />
      <Stack.Screen name="cash" options={{ title: 'Касса' }} />
      <Stack.Screen name="staff" options={{ title: 'Кто на смене' }} />
      <Stack.Screen name="pay" options={{ title: 'Зарплата' }} />
    </Stack>
  );
}
