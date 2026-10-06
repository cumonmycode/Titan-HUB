// Стек вкладки. На iOS — системная шапка: прозрачная, с крупным заголовком, который
// сворачивается при прокрутке, и прогрессивным размытием края (scroll edge effect iOS 26);
// кнопки шапки — стеклянные (Stack.Toolbar в экранах). На Android шапки нет: заголовок
// рисуется в контенте (components/screen.tsx).
//
// Фирменный фон — стиль контейнера экрана (contentStyle), а не отдельный слой: размытие
// края iOS ищет ScrollView строго первым ребёнком экрана.
import { Stack } from 'expo-router';

import { backdrop, colors, IS_IOS } from '@/lib/theme';

const iosHeader = {
  headerTransparent: true,
  headerLargeTitleEnabled: true,
  headerLargeTitleShadowVisible: false,
  headerShadowVisible: false,
  headerLargeStyle: { backgroundColor: 'transparent' },
  headerTitleStyle: { color: colors.text, fontWeight: '700' as const },
  headerLargeTitleStyle: { color: colors.text, fontWeight: '800' as const },
  headerTintColor: colors.lavender,
  headerBackButtonDisplayMode: 'minimal' as const,
  scrollEdgeEffects: { top: 'automatic' as const, bottom: 'automatic' as const },
  contentStyle: backdrop,
};

const androidHeader = { headerShown: false, contentStyle: backdrop };

export function TabStack({ title }: { title: string }) {
  return (
    <Stack screenOptions={IS_IOS ? iosHeader : androidHeader}>
      <Stack.Screen name="index" options={{ title }} />
    </Stack>
  );
}
