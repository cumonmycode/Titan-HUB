/**
 * Публичные страницы без входа и без меню кассы: запись, политика, поддержка и вики
 * для разработчиков (/wiki и все её разделы). Один список на гвард, Sidebar и BottomNav.
 */
const PUBLIC_PATHS = ['/login', '/privacy', '/terms', '/book', '/support']
const PUBLIC_PREFIXES = ['/wiki']

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.includes(pathname) || PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}

/** Публичная страница, на которой не нужны меню кассы (/login прячет их своим правилом). */
export function hidesAppChrome(pathname: string): boolean {
  return pathname !== '/login' && isPublicPath(pathname)
}
