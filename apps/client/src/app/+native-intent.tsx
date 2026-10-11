// Входящие ссылки в приложение. titanresident://open — кнопка «Открыть приложение»
// из бота (через страницу titanpos.ru/my-titan): нужно только открыть приложение,
// вход завершит экран входа сам. Такого экрана нет — ведём на главную ('/'),
// а охрана маршрутов в _layout покажет вход или кошелёк.
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    const url = new URL(path, 'titanresident://app');
    const route = url.pathname.replace(/^\/+/, '');
    if (url.hostname === 'open' || route === 'open') return '/';
    return path;
  } catch {
    return '/';
  }
}
