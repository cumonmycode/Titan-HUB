// Три вкладки: Главная, История, Профиль. Оплата и уведомления — не вкладки: оплата
// открывается из блока «К оплате» и кнопки «Пополнить» на главной, уведомления — по
// колокольчику в её шапке.
//
// iOS — системный таб-бар (UITabBarController): на iOS 26 это Liquid Glass, который
// сворачивается при прокрутке вниз; выбранная вкладка — лавандовая Titan.
// Android — плавающая капсула на RN (components/tab-bar.tsx).
import { Tabs } from 'expo-router/tabs';
import { NativeTabs } from 'expo-router/unstable-native-tabs';

import { sfSymbol } from '@/components/icon';
import { TabBar } from '@/components/tab-bar';
import { backdrop, colors, IS_IOS } from '@/lib/theme';

export default function TabsLayout() {
  if (!IS_IOS) return <AndroidTabs />;

  return (
    <NativeTabs
      tintColor={colors.lavender}
      iconColor={{ default: colors.textSecondary, selected: colors.lavender }}
      minimizeBehavior="onScrollDown"
    >
      <NativeTabs.Trigger name="(home)" contentStyle={backdrop}>
        <NativeTabs.Trigger.Icon sf={sfSymbol('wallet')} />
        <NativeTabs.Trigger.Label>Главная</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="history" contentStyle={backdrop}>
        <NativeTabs.Trigger.Icon sf={sfSymbol('history')} />
        <NativeTabs.Trigger.Label>История</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="profile" contentStyle={backdrop}>
        <NativeTabs.Trigger.Icon sf={{ default: 'person.crop.circle', selected: 'person.crop.circle.fill' }} />
        <NativeTabs.Trigger.Label>Профиль</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

function AndroidTabs() {
  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{ headerShown: false, sceneStyle: backdrop, animation: 'shift' }}
    >
      <Tabs.Screen name="(home)" options={{ title: 'Главная' }} />
      <Tabs.Screen name="history" options={{ title: 'История' }} />
      <Tabs.Screen name="profile" options={{ title: 'Профиль' }} />
    </Tabs>
  );
}
