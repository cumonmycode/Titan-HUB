import { Stack } from 'expo-router';

import { colors } from '@/lib/theme';
import { sheetOptions } from '@/lib/sheet';

import { formHeader, stackHeaderOptions } from '@/components/header-glass';
import { sheetLayout } from '@/components/sheet-grabber';

/** Шторка по высоте содержимого (клавиатура суммы) — без фона, под ней системное стекло iOS 26. */
const compactSheet = {
  presentation: 'formSheet' as const,
  ...sheetOptions,
  sheetAllowedDetents: 'fitToContents' as const,
  sheetGrabberVisible: true,
  headerShown: false,
  contentStyle: { backgroundColor: colors.sheetBackground },
};

/**
 * Редактор-форма (SwiftUI Form) с «Отмена» и «Сохранить» в шапке, как системные формы iOS:
 * на iPhone — карточка поверх раздела, на Android — полноэкранная форма. В отличие от
 * шторки по высоте содержимого, форма прокручивается и сама уходит от клавиатуры.
 */
const editorModal = { presentation: 'modal' as const, ...formHeader() };

export default function ManageLayout() {
  return (
    <Stack screenOptions={{ headerBackButtonDisplayMode: 'minimal', ...stackHeaderOptions }} screenLayout={sheetLayout}>
      {/* Корень — нативная форма, как «Настройки» iOS: крупный заголовок в шапке Liquid Glass. */}
      <Stack.Screen name="index" options={formHeader({ title: 'Управление', headerLargeTitle: true })} />

      {/* «Товары»: меню, остатки и операции склада (2026-10-08 вместо «Меню» и «Склада»). */}
      <Stack.Screen name="goods/index" options={formHeader({ title: 'Товары' })} />
      <Stack.Screen name="goods/[itemId]" options={formHeader()} />
      <Stack.Screen name="goods/edit" options={editorModal} />
      <Stack.Screen name="goods/pick" options={editorModal} />
      <Stack.Screen name="goods/categories" options={formHeader({ title: 'Категории' })} />
      <Stack.Screen name="goods/category" options={editorModal} />
      <Stack.Screen name="goods/reorder" options={editorModal} />
      <Stack.Screen name="goods/supply" options={formHeader()} />
      <Stack.Screen name="goods/write-off" options={formHeader()} />
      <Stack.Screen name="goods/revision" options={formHeader()} />
      <Stack.Screen name="goods/doc" options={formHeader()} />

      <Stack.Screen name="pricing/index" options={formHeader({ title: 'Тарифы и аренда' })} />
      <Stack.Screen name="pricing/tariff" options={editorModal} />
      <Stack.Screen name="pricing/evening" options={editorModal} />
      <Stack.Screen name="pricing/space" options={editorModal} />
      <Stack.Screen name="pricing/rate" options={editorModal} />

      <Stack.Screen name="salary/index" options={formHeader({ title: 'Зарплата' })} />
      <Stack.Screen name="expenses/index" options={formHeader({ title: 'Расходы' })} />
      <Stack.Screen name="expenses/new" options={editorModal} />

      <Stack.Screen name="shifts/index" options={formHeader({ title: 'Смены' })} />
      <Stack.Screen name="shifts/[shiftId]" options={formHeader({ title: 'Отчёт смены' })} />

      <Stack.Screen name="clients/index" options={formHeader({ title: 'Клиенты' })} />
      <Stack.Screen name="clients/[clientId]" options={formHeader()} />
      <Stack.Screen name="clients/history" options={formHeader({ title: 'История' })} />
      <Stack.Screen name="clients/edit" options={editorModal} />
      <Stack.Screen name="clients/adjust" options={compactSheet} />
      <Stack.Screen name="clients/telegram" options={editorModal} />
      <Stack.Screen name="clients/tg-roster" options={editorModal} />

      <Stack.Screen name="balances/index" options={formHeader({ title: 'Депозиты и долги' })} />
      <Stack.Screen name="balances/find" options={compactSheet} />

      <Stack.Screen name="customers/index" options={formHeader({ title: 'Заказчики' })} />
      <Stack.Screen name="customers/[customerId]" options={formHeader()} />
      <Stack.Screen name="customers/edit" options={editorModal} />

      <Stack.Screen name="collections/index" options={formHeader({ title: 'Сбор средств' })} />
      <Stack.Screen name="collections/[collectionId]" options={formHeader()} />
      <Stack.Screen name="collections/edit" options={editorModal} />
      <Stack.Screen name="collections/pay" options={compactSheet} />
      <Stack.Screen name="collections/member" options={editorModal} />

      <Stack.Screen name="broadcasts/index" options={formHeader({ title: 'Рассылки' })} />
      <Stack.Screen name="broadcasts/compose" options={editorModal} />

      <Stack.Screen name="loyalty/index" options={formHeader({ title: 'Лояльность' })} />
      <Stack.Screen name="loyalty/bonus" options={formHeader({ title: 'Бонусная программа' })} />
      <Stack.Screen name="loyalty/certificates" options={formHeader({ title: 'Сертификаты' })} />
      <Stack.Screen name="loyalty/discount" options={editorModal} />
      <Stack.Screen name="loyalty/tier-rule" options={editorModal} />

      <Stack.Screen name="staff/index" options={formHeader({ title: 'Сотрудники' })} />
      <Stack.Screen name="staff/[staffId]" options={formHeader()} />
      <Stack.Screen name="staff/me" options={formHeader({ title: 'Мой профиль' })} />
      <Stack.Screen name="staff/notifications" options={formHeader({ title: 'Уведомления' })} />
      <Stack.Screen name="staff/new" options={editorModal} />

      <Stack.Screen name="settings/index" options={formHeader({ title: 'Настройки клуба' })} />
      <Stack.Screen name="settings/reviews" options={formHeader({ title: 'Отзывы гостей' })} />
      {/* «Сайт»: оформление, расписание, публикации, онлайн-запись, домен и контакты — нативно. */}
      <Stack.Screen name="settings/site/index" options={formHeader({ title: 'Сайт' })} />
      <Stack.Screen name="settings/site/look" options={formHeader({ title: 'Оформление' })} />
      <Stack.Screen name="settings/site/schedule" options={formHeader({ title: 'Расписание вечеров' })} />
      <Stack.Screen name="settings/site/evening" options={editorModal} />
      <Stack.Screen name="settings/site/stories" options={formHeader({ title: 'Публикации' })} />
      <Stack.Screen name="settings/site/story" options={editorModal} />
      <Stack.Screen name="settings/site/domain" options={formHeader({ title: 'Домен' })} />
      <Stack.Screen name="settings/site/contacts" options={formHeader({ title: 'Контакты' })} />
      <Stack.Screen name="settings/site/notify" options={formHeader({ title: 'Уведомления' })} />
      <Stack.Screen name="settings/integrations" options={formHeader({ title: 'Интеграции' })} />
      <Stack.Screen name="settings/integration-store" options={formHeader({ title: 'Добавить интеграцию' })} />
      <Stack.Screen name="settings/integration" options={formHeader()} />
      {/* Home Assistant для HUB: подключение и помещения шторки «Свет и климат» на кассе. */}
      <Stack.Screen name="settings/home/index" options={formHeader({ title: 'Home Assistant' })} />
      <Stack.Screen name="settings/home/zone" options={formHeader()} />
      <Stack.Screen name="settings/home/devices" options={editorModal} />
      <Stack.Screen name="settings/home/reorder" options={editorModal} />

      <Stack.Screen name="screens/index" options={formHeader({ title: 'Экраны' })} />
      <Stack.Screen name="screens/[screenId]" options={formHeader()} />
      <Stack.Screen name="screens/connect" options={formHeader({ title: 'Подключить ТВ' })} />
      <Stack.Screen name="screens/new" options={editorModal} />
      <Stack.Screen name="screens/slide" options={editorModal} />

      <Stack.Screen name="polls/index" options={formHeader({ title: 'Опросы' })} />
      <Stack.Screen name="polls/edit" options={editorModal} />

      <Stack.Screen name="tai/index" options={formHeader({ title: 'Tai' })} />
      <Stack.Screen name="tai/voice" options={formHeader({ title: 'Голос' })} />
      <Stack.Screen name="tai/chat" options={formHeader()} />
      <Stack.Screen name="tai/brief" options={editorModal} />

      <Stack.Screen name="about/index" options={formHeader({ title: 'О системе' })} />
    </Stack>
  );
}
