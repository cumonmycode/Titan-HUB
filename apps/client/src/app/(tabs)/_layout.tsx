// Вкладки My Titan.
//
// iOS — системный таб-бар (UITabBarController): на iOS 26 это Liquid Glass, который
// сворачивается при прокрутке вниз. Цвет выбранной вкладки — лавандовый Titan, бейдж
// непрочитанных — фирменный розовый. «Оплатить» в центре — кнопка, а не экран: вкладка
// `disabled` (выбрать нельзя, но нажатие приходит событием) открывает шторку оплаты.
//
// Android — плавающая капсула на RN (components/tab-bar.tsx), как было: системной
// панели Material владелец предпочёл капсулу «как на айфоне».
import { useRouter } from 'expo-router';
import { Tabs } from 'expo-router/tabs';
import { NativeTabs } from 'expo-router/unstable-native-tabs';

import { sfSymbol } from '@/components/icon';
import { TabBar } from '@/components/tab-bar';
import { haptic } from '@/lib/haptics';
import { useWallet } from '@/lib/queries';
import { backdrop, colors, IS_IOS } from '@/lib/theme';

/** «Оплатить» всегда в акценте — во всех состояниях вкладки и видах таб-бара. */
const payItem = { tabBarItemIconColor: colors.lavender, tabBarItemTitleFontColor: colors.lavender };
const payStates = { normal: payItem, selected: payItem, focused: payItem, disabled: payItem };
const payAppearance = { stacked: payStates, inline: payStates, compactInline: payStates };
const payNativeProps = {
  ios: {
    standardAppearance: payAppearance,
    scrollEdgeAppearance: { ...payAppearance, tabBarBlurEffect: 'none' as const, tabBarShadowColor: 'transparent' },
  },
};

export default function TabsLayout() {
  const router = useRouter();
  const { data: wallet } = useWallet();
  const unread = wallet?.unreadNotifications ?? 0;

  if (!IS_IOS) return <AndroidTabs />;

  return (
    <NativeTabs
      tintColor={colors.lavender}
      iconColor={{ default: colors.textSecondary, selected: colors.lavender }}
      badgeBackgroundColor={colors.pink}
      minimizeBehavior="onScrollDown"
    >
      <NativeTabs.Trigger name="(home)" contentStyle={backdrop}>
        <NativeTabs.Trigger.Icon sf={sfSymbol('wallet')} />
        <NativeTabs.Trigger.Label>Кошелёк</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="history" contentStyle={backdrop}>
        <NativeTabs.Trigger.Icon sf={sfSymbol('history')} />
        <NativeTabs.Trigger.Label>История</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger
        name="pay-action"
        disabled
        unstable_nativeProps={payNativeProps}
        listeners={{
          tabPress: () => {
            haptic.tap();
            router.push('/pay');
          },
        }}
      >
        <NativeTabs.Trigger.Icon sf="plus.circle.fill" />
        <NativeTabs.Trigger.Label>Оплатить</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="inbox" contentStyle={backdrop}>
        <NativeTabs.Trigger.Icon sf={{ default: 'bell', selected: 'bell.fill' }} />
        <NativeTabs.Trigger.Label>Входящие</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Badge hidden={unread === 0}>{unread > 99 ? '99+' : String(unread)}</NativeTabs.Trigger.Badge>
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
      <Tabs.Screen name="(home)" options={{ title: 'Кошелёк' }} />
      <Tabs.Screen name="history" options={{ title: 'История' }} />
      <Tabs.Screen name="pay-action" options={{ title: 'Оплатить' }} />
      <Tabs.Screen name="inbox" options={{ title: 'Входящие' }} />
      <Tabs.Screen name="profile" options={{ title: 'Профиль' }} />
    </Tabs>
  );
}
