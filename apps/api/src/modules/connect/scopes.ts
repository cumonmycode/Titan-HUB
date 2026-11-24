/**
 * Права (scopes) подключения Titan Connect. Владелец отмечает их в HUB при создании
 * подключения; сторонний сервис видит только разрешённое. `clients:read` — основа,
 * без него остальные права не имеют смысла и включаются вместе с ним.
 */
export const CONNECT_SCOPES = [
  {
    key: 'clients:read',
    title: 'Профили клиентов',
    description: 'Ник, имя, статус, резидент или нет, дата регистрации, ID игрока GoMafia.',
    required: true,
  },
  {
    key: 'clients:photos',
    title: 'Фото',
    description: 'Ссылка на фото клиента: загруженное в HUB, из Telegram или GoMafia.',
    required: false,
  },
  {
    key: 'clients:contacts',
    title: 'Контакты',
    description: 'Телефон, дата рождения, Telegram.',
    required: false,
  },
  {
    key: 'clients:balance',
    title: 'Депозит и бонусы',
    description: 'Остаток депозита (минус — долг) и бонусные баллы.',
    required: false,
  },
  {
    key: 'clients:visits',
    title: 'Посещения',
    description: 'Сколько вечеров клиент был в клубе.',
    required: false,
  },
  {
    key: 'streams:publish',
    title: 'Стримы',
    description: 'Сервис передаёт в HUB ссылки на эфир и донаты. Публиковать ли их через Tai — решаете в Telegram → Стримы.',
    required: false,
  },
] as const

export type ConnectScope = (typeof CONNECT_SCOPES)[number]['key']

const KNOWN = new Set<string>(CONNECT_SCOPES.map((s) => s.key))

/** Оставить только известные права, без повторов; базовое право добавляется всегда. */
export function normalizeScopes(input: readonly string[]): ConnectScope[] {
  const picked = new Set(input.filter((s) => KNOWN.has(s)))
  picked.add('clients:read')
  return CONNECT_SCOPES.map((s) => s.key).filter((key) => picked.has(key))
}

export const hasScope = (scopes: readonly string[], scope: ConnectScope): boolean => scopes.includes(scope)
