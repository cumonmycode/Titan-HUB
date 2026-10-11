import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Плавающая панель вкладок на Android — как таб-бар iOS 26: капсула над контентом,
 * над ней — плашка смены или чека. На iOS панель системная (NativeTabs), и её высоту
 * UIKit сам добавляет в safe area экранов, поэтому здесь всё возвращает 0.
 */
export const FLOATING_TAB_BAR = Platform.OS === 'android';

export const TAB_BAR_HEIGHT = 64;
export const ACCESSORY_HEIGHT = 56;
/** Зазор между капсулами и от нижнего края. */
export const TAB_BAR_GAP = 8;

/**
 * Сколько снизу занимает плавающая панель (с плашкой — `withAccessory`). На iOS — 0:
 * там отступ под таб-бар даёт contentInsetAdjustmentBehavior и safe area.
 */
export function useTabBarClearance(withAccessory = false): number {
  const insets = useSafeAreaInsets();
  if (!FLOATING_TAB_BAR) return 0;
  return insets.bottom + TAB_BAR_GAP + TAB_BAR_HEIGHT + (withAccessory ? ACCESSORY_HEIGHT + TAB_BAR_GAP : 0);
}

/**
 * Шторки внутри вкладок. На Android они живут в области вкладки, и плавающая панель
 * легла бы поверх их низа, поэтому на время шторки панель уезжает вниз — как на iOS,
 * где шторка закрывает таб-бар. Держать в соответствии с `_layout.tsx` вкладок.
 */
export const SHEET_ROUTES: Record<string, ReadonlySet<string>> = {
  pos: new Set(['menu', 'chat', 'refund', 'player', 'discount', 'rental']),
  events: new Set(['edit', 'participants']),
  analytics: new Set(['check/[checkId]', 'period']),
  manage: new Set([
    'goods/edit',
    'goods/pick',
    'goods/category',
    'goods/reorder',
    'pricing/tariff',
    'pricing/evening',
    'pricing/space',
    'pricing/rate',
    'expenses/new',
    'clients/edit',
    'clients/adjust',
    'clients/telegram',
    'clients/tg-roster',
    'balances/find',
    'customers/edit',
    'collections/edit',
    'collections/pay',
    'collections/member',
    'loyalty/discount',
    'loyalty/tier-rule',
    'staff/new',
    'settings/home/devices',
    'settings/home/reorder',
    'polls/edit',
  ]),
};
