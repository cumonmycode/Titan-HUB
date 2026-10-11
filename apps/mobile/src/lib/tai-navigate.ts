import type { useRouter } from 'expo-router';

import { setAnalyticsRange } from './analytics-api';
import { isSplitLayout } from './layout';
import { usePosSelection } from './pos-selection';
import type { TaiRoute } from './tai-api';

type Router = ReturnType<typeof useRouter>;

/** Сколько длится закрытие шторки iOS: переход после неё виден, а не прячется под ней. */
const SHEET_DISMISS_MS = 420;

/**
 * Переход по смыслу (`TaiRoute`) на экран приложения. Тот же переход используют блоки
 * Tai и графики аналитики («Чеки за 9 окт ›»).
 */
export function openRoute(router: Router, to: TaiRoute) {
  switch (to.screen) {
    case 'pos':
      router.navigate('/pos');
      return;
    case 'check':
      // На iPad чек открывается в правой панели кассы, на телефоне — отдельным экраном.
      if (isSplitLayout()) {
        router.navigate('/pos');
        usePosSelection.getState().select(to.checkId);
      } else {
        router.navigate({ pathname: '/pos/[checkId]', params: { checkId: to.checkId } });
      }
      return;
    case 'pay':
      router.push({ pathname: '/pay', params: { checkId: to.checkId } });
      return;
    case 'shift':
      router.push('/shift/open');
      return;
    case 'analytics':
      setAnalyticsRange(to.from, to.to);
      router.navigate('/analytics');
      return;
    case 'analytics-checks':
      router.navigate({
        pathname: '/analytics/checks',
        params: { from: to.from, to: to.to, ...(to.hour !== undefined ? { hour: String(to.hour) } : {}), ...(to.method ? { method: to.method } : {}) },
      });
      return;
    case 'analytics-check':
      router.navigate({ pathname: '/analytics/check/[checkId]', params: { checkId: to.checkId } });
      return;
    case 'analytics-products':
      setAnalyticsRange(to.from, to.to);
      router.navigate('/analytics/products');
      return;
    case 'analytics-players':
      setAnalyticsRange(to.from, to.to);
      router.navigate('/analytics/players');
      return;
    case 'player':
      router.navigate({ pathname: '/analytics/player/[playerId]', params: { playerId: to.playerId } });
      return;
    case 'inventory':
      router.navigate('/manage/goods');
      return;
    case 'events':
      router.navigate('/events');
      return;
  }
}

/** Переход из шторки Tai: сперва шторка уезжает, затем открывается экран. */
export function openRouteFromTai(router: Router, to: TaiRoute) {
  router.back();
  setTimeout(() => openRoute(router, to), SHEET_DISMISS_MS);
}
