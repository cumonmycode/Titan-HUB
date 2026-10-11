import { Stack } from 'expo-router';

import { colors } from '@/lib/theme';
import { sheetOptions } from '@/lib/sheet';

import { glassHeader, stackHeaderOptions } from '@/components/header-glass';
import { sheetLayout } from '@/components/sheet-grabber';

/** Шторки форм на всю высоту; контент без фона — под ним системное стекло шторки iOS 26. */
const formSheet = {
  presentation: 'formSheet' as const,
  ...sheetOptions,
  sheetAllowedDetents: [1],
  sheetGrabberVisible: true,
  headerShown: false,
  contentStyle: { backgroundColor: colors.sheetBackground },
};

export default function EventsLayout() {
  return (
    <Stack screenOptions={{ headerBackButtonDisplayMode: 'minimal', ...stackHeaderOptions }} screenLayout={sheetLayout}>
      {/* Заголовок «События» рисуется в самом экране — как в кассе. */}
      <Stack.Screen name="index" options={{ headerShown: false, title: 'События' }} />
      {/* Прозрачная шапка над фирменным фоном; открывается зумом из карточки. */}
      <Stack.Screen name="[eventId]" options={glassHeader()} />
      {/* Одна форма для мероприятия в клубе, выезда и миникапа (format=minicap). */}
      <Stack.Screen name="edit" options={formSheet} />
      <Stack.Screen name="participants" options={formSheet} />
    </Stack>
  );
}
