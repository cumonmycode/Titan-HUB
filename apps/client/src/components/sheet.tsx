// Шторки (оплата, чек, бонусы, личные данные).
//
// iOS — системная шторка formSheet с ручкой и упоров по высоте. На iOS 26 её фон —
// Liquid Glass: контент без своего фона, поверх стекла только мягкий фиолетовый
// отсвет Titan сверху. На iOS до 26 — сплошная фирменная поверхность.
// Android — полноэкранное окно, выезжающее снизу, на фирменном фоне.
import { type Href, useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { backdrop, colors, GUTTER, IS_IOS, MAX_WIDTH, space, type } from '@/lib/theme';

import { GlassIconButton, LIQUID_GLASS } from './glass';

const sheetGlow =
  'radial-gradient(circle at 12% 0%, rgba(139,92,246,0.24) 0%, rgba(139,92,246,0) 55%), ' +
  'radial-gradient(circle at 100% 8%, rgba(76,215,246,0.10) 0%, rgba(76,215,246,0) 40%)';

/**
 * Опции экрана-шторки корневого стека (iOS). detents — доли высоты экрана или
 * 'fitToContents' — по высоте содержимого, как системные короткие шторки (тогда у
 * экрана не должно быть flex: 1 и прокрутки, иначе высота схлопнется).
 */
export function sheetOptions(detents: number[] | 'fitToContents' = [1]) {
  if (IS_IOS) {
    return {
      presentation: 'formSheet' as const,
      sheetAllowedDetents: detents,
      sheetGrabberVisible: true,
      headerShown: false,
      contentStyle: LIQUID_GLASS
        ? { backgroundColor: 'transparent', experimental_backgroundImage: sheetGlow }
        : { backgroundColor: colors.surface, experimental_backgroundImage: sheetGlow },
    };
  }
  return {
    presentation: 'modal' as const,
    animation: 'fade_from_bottom' as const,
    headerShown: false,
    contentStyle: backdrop,
  };
}

/** Закрыть шторку; если открыта ссылкой «с нуля» — уйти на запасной экран. */
export function useCloseSheet(fallback: Href = '/') {
  const router = useRouter();
  return () => (router.canGoBack() ? router.back() : router.replace(fallback));
}

export function SheetHeader({ title, onClose }: { title: string; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.header, { paddingTop: IS_IOS ? space.xl + space.xs : insets.top + space.md }]}>
      <Text style={styles.title} accessibilityRole="header" numberOfLines={1}>{title}</Text>
      <GlassIconButton icon="close" label="Закрыть" size={40} onPress={onClose} />
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md,
    paddingHorizontal: GUTTER, paddingBottom: space.md, width: '100%', maxWidth: MAX_WIDTH + GUTTER * 2, alignSelf: 'center',
  },
  title: { ...StyleSheet.flatten(type.heading), fontSize: 24, lineHeight: 30, flex: 1 },
});
