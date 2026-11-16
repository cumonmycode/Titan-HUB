/** Разделы вики в порядке чтения: навигация слева и «Назад / Далее» внизу страницы. */
export const WIKI_PAGES = [
  { href: '/wiki', title: 'Обзор', blurb: 'Что такое Titan Connect и быстрый старт' },
  { href: '/wiki/connect', title: 'Подключение', blurb: 'Одноразовый код, ключ, несколько клубов' },
  { href: '/wiki/clients', title: 'Клиенты', blurb: 'Объект клиента, поиск, страницы' },
  { href: '/wiki/sync', title: 'Синхронизация', blurb: 'Только изменения, удалённые клиенты' },
  { href: '/wiki/errors', title: 'Ошибки и лимиты', blurb: 'Коды ошибок, повторы, лимиты' },
  { href: '/wiki/examples', title: 'Примеры кода', blurb: 'curl, TypeScript, Python' },
] as const

export type WikiHref = (typeof WIKI_PAGES)[number]['href']

export function neighbours(href: WikiHref) {
  const i = WIKI_PAGES.findIndex((p) => p.href === href)
  return { prev: i > 0 ? WIKI_PAGES[i - 1] : null, next: i < WIKI_PAGES.length - 1 ? WIKI_PAGES[i + 1] : null }
}
