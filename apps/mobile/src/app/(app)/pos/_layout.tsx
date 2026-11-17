import { Stack } from 'expo-router';

import { colors } from '@/lib/theme';
import { sheetOptions } from '@/lib/sheet';

import { glassHeader, stackHeaderOptions } from '@/components/header-glass';
import { sheetLayout } from '@/components/sheet-grabber';

/**
 * Короткие действия с чеком — шторки по высоте содержимого, как «Новый чек».
 * Контент без собственного фона: iOS 26 рисует под ним Liquid Glass шторки.
 */
const compactSheet = {
  presentation: 'formSheet',
  ...sheetOptions,
  sheetAllowedDetents: 'fitToContents',
  sheetGrabberVisible: true,
  headerShown: false,
  contentStyle: { backgroundColor: colors.sheetBackground },
} as const;

export default function PosLayout() {
  return (
    <Stack screenOptions={{ headerBackButtonDisplayMode: 'minimal', ...stackHeaderOptions }} screenLayout={sheetLayout}>
      {/* Заголовок «Касса» рисуется в самом экране — в одну строку с колокольчиком, как в App Store. */}
      <Stack.Screen name="index" options={{ headerShown: false, title: 'Касса' }} />
      {/* Прозрачная шапка: фирменный фон и стеклянные карточки чека видны и под ней. */}
      <Stack.Screen name="[checkId]" options={glassHeader()} />
      <Stack.Screen
        name="menu"
        options={{
          presentation: 'formSheet',
          ...sheetOptions,
          sheetAllowedDetents: [0.62, 1],
          sheetGrabberVisible: true,
          sheetLargestUndimmedDetentIndex: 0,
          headerShown: false,
          contentStyle: { backgroundColor: colors.sheetBackground },
        }}
      />
      <Stack.Screen name="refunds" options={glassHeader({ title: 'Возвраты' })} />
      <Stack.Screen
        name="refund"
        options={{
          presentation: 'formSheet',
          ...sheetOptions,
          sheetAllowedDetents: [1],
          sheetGrabberVisible: true,
          headerShown: false,
          contentStyle: { backgroundColor: colors.sheetBackground },
        }}
      />
      <Stack.Screen name="player" options={compactSheet} />
      <Stack.Screen name="discount" options={compactSheet} />
      <Stack.Screen name="rental" options={compactSheet} />
      <Stack.Screen name="zone" options={compactSheet} />
    </Stack>
  );
}
