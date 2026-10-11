import { usePathname, useRouter } from 'expo-router';
import { Tabs } from 'expo-router/tabs';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import type { ReactNode } from 'react';
import { Platform, useWindowDimensions } from 'react-native';

import { CheckAccessory } from '@/components/check-accessory';
import { FloatingTabBar } from '@/components/floating-tab-bar';
import { HomeShadeHost } from '@/components/home/home-shade';
import { ShiftAccessory } from '@/components/shift-accessory';
import { useChrome } from '@/lib/chrome';
import { haptic } from '@/lib/haptics';
import { colors } from '@/lib/theme';

const IS_PAD = Platform.OS === 'ios' && Platform.isPad;
const CHECK_PATH = /^\/pos\/([0-9a-f-]{36})$/i;
/**
 * «Увеличенный» вид iPhone (14 Pro — 320 pt в ширину): пять подписей системным кеглем 10 pt
 * слипаются («АналитикаУправление»). На узком экране подписи на пункт мельче.
 */
const NARROW_TAB_BAR = 360;
const narrowLabelStyle = { fontSize: 9 };

/**
 * «Новый» всегда в акценте. Иконка — системный символ, поэтому iOS выравнивает её
 * ровно как соседние; цвет задаём внешним видом самой вкладки во всех состояниях.
 */
const accentItem = { tabBarItemIconColor: colors.accent, tabBarItemTitleFontColor: colors.accent };
const accentStates = { normal: accentItem, selected: accentItem, focused: accentItem, disabled: accentItem };
const accentAppearance = { stacked: accentStates, inline: accentStates, compactInline: accentStates };
const newTabNativeProps = {
  ios: {
    standardAppearance: accentAppearance,
    scrollEdgeAppearance: { ...accentAppearance, tabBarBlurEffect: 'none' as const, tabBarShadowColor: 'transparent' },
  },
};

/**
 * Системный таб-бар (UITabBarController): Liquid Glass на iOS 26, на iPad — боковая панель.
 * Подписи короткие и почти равной длины («Отчёты», «Меню» — как в веб-кассе): iOS 26
 * ставит пункты по ширине подписей (itemPositioning не помогает), и длинные «Аналитика» /
 * «Управление» сдвигали значки — ряд выглядел прижатым влево.
 *
 * «Новый» на iPhone — кнопка, а не экран: вкладка `disabled` (выбрать нельзя, но нажатие
 * приходит событием) открывает шторку создания чека. На iPad вкладки нет: кнопка
 * «Новый чек» живёт в плашке смены.
 *
 * Над таб-баром — системная плашка (bottom accessory): на главном экране кассы это смена
 * (на iPhone прячется при прокрутке), в открытом чеке на iPhone — «Добавить» и «Оплатить».
 */
export default function AppLayout() {
  const router = useRouter();
  const pathname = usePathname();
  const accessoryVisible = useChrome((s) => s.accessoryVisible);
  const openCheckId = IS_PAD ? undefined : CHECK_PATH.exec(pathname)?.[1];
  const { width } = useWindowDimensions();

  // Android прячет плашку смены при прокрутке сам (плавающая панель на RN — это дёшево).
  // На iOS плашку не снимаем: каждое снятие перестраивало таб-бар UIKit (~60 мс) прямо
  // посреди прокрутки. Там таб-бар сворачивается системно (minimizeBehavior), а плашка
  // переезжает в компактный вид рядом с ним (placement 'inline').
  const hiddenByScroll = Platform.OS === 'android' && !accessoryVisible;
  let accessory: ReactNode = null;
  if (pathname === '/pos' && (IS_PAD || !hiddenByScroll)) accessory = <ShiftAccessory />;
  else if (openCheckId) accessory = <CheckAccessory checkId={openCheckId} />;

  if (Platform.OS === 'android') return <AndroidTabs accessory={accessory} homeShade={pathname === '/pos'} />;

  return (
    <NativeTabs
      tintColor={colors.accent}
      labelStyle={!IS_PAD && width < NARROW_TAB_BAR ? narrowLabelStyle : undefined}
      sidebarAdaptable
      minimizeBehavior="onScrollDown"
      screenListeners={({ route }) => ({
        tabPress: () => {
          // Папка без _layout даёт маршрут «new/index»: Trigger сопоставляет имя без «/index», а route.name — нет.
          if (route.name.replace(/\/index$/, '') === 'new') {
            haptic.light();
            router.push('/new-check');
          }
        },
      })}>
      <NativeTabs.Trigger name="pos">
        <NativeTabs.Trigger.Icon sf={{ default: 'rublesign.circle', selected: 'rublesign.circle.fill' }} md="currency_ruble" />
        <NativeTabs.Trigger.Label>Касса</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="events">
        <NativeTabs.Trigger.Icon sf="calendar" md="calendar_month" />
        <NativeTabs.Trigger.Label>События</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="new" disabled hidden={IS_PAD} unstable_nativeProps={newTabNativeProps}>
        <NativeTabs.Trigger.Icon sf="plus.circle.fill" md="add_circle" />
        <NativeTabs.Trigger.Label>Новый</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="analytics">
        <NativeTabs.Trigger.Icon sf={{ default: 'chart.bar', selected: 'chart.bar.fill' }} md="bar_chart" />
        <NativeTabs.Trigger.Label>Отчёты</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="manage">
        <NativeTabs.Trigger.Icon sf={{ default: 'gearshape', selected: 'gearshape.fill' }} md="settings" />
        <NativeTabs.Trigger.Label>Меню</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      {accessory && <NativeTabs.BottomAccessory>{accessory}</NativeTabs.BottomAccessory>}
    </NativeTabs>
  );
}

/**
 * Android: вкладки без системной панели Material — вместо неё плавающая капсула как на
 * iPhone (components/floating-tab-bar.tsx). Плашка смены или чека едет в той же стопке
 * над капсулой: раньше её клали отдельным слоем на расчётную высоту, и она наезжала на
 * панель. Экраны занимают всю высоту и прокручиваются под капсулой, как на iOS.
 *
 * Шторка «Свет и климат» на кассе — последним слоем поверх вкладок: так она и свёрнутая, и
 * раскрытая лежит над капсулой, а касания мимо неё проходят к экрану (Modal бы их забрал).
 */
function AndroidTabs({ accessory, homeShade }: { accessory: ReactNode; homeShade: boolean }) {
  return (
    <>
      <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <FloatingTabBar {...props} accessory={accessory} />}>
        <Tabs.Screen name="pos" />
        <Tabs.Screen name="events" />
        <Tabs.Screen name="new/index" />
        <Tabs.Screen name="analytics" />
        <Tabs.Screen name="manage" />
      </Tabs>
      {/* Шторка «Свет и климат» — над капсулой вкладок, пока на экране касса (components/home/home-shade.tsx). */}
      {homeShade && <HomeShadeHost />}
    </>
  );
}
