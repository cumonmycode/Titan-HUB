/** Форматы клуба: что продаём. Тексты — со старого сайта, цены — из HUB. */

export type FormatId = 'city' | 'sport' | 'board' | 'kids' | 'corporate' | 'party'

export interface Format {
  id: FormatId
  title: string
  short: string
  text: string
  photo: string
  /** Куда ведёт карточка. */
  href: string
  /** Какую форму открывает кнопка. */
  request: { kind: 'game'; evening: 'city_mafia' | 'sport_mafia' | 'board_games' } | { kind: 'event'; format: 'birthday' | 'corporate' | 'kids' | 'party' }
}

export const FORMATS: Format[] = [
  {
    id: 'city', title: 'Городская мафия', short: 'Психологическая игра для всех',
    text: 'Захватывающая психологическая игра, где каждое слово, взгляд и жест могут стать ключом к победе. Новичкам ведущий объяснит правила прямо перед игрой.',
    photo: 'table-night', href: '/games', request: { kind: 'game', evening: 'city_mafia' },
  },
  {
    id: 'sport', title: 'Спортивная мафия', short: 'Строгие правила, рейтинг ELO',
    text: 'Интеллектуальное сражение по правилам ФСМ: стратегии, турниры и рейтинг на GoMafia. Пройдите Школу мафии и станьте мастером игры.',
    photo: 'girls-violet', href: '/games', request: { kind: 'game', evening: 'sport_mafia' },
  },
  {
    id: 'kids', title: 'Детская мафия', short: 'Дни рождения, школы, выходные',
    text: 'Адаптированные игры для детей: каждый пробует себя детективом, мирным жителем или хитрым мафиози. Логика, речь и уверенность — в весёлом игровом шоу.',
    photo: 'kid-mask', href: '/kidspromo', request: { kind: 'event', format: 'kids' },
  },
  {
    id: 'corporate', title: 'Корпоративная мафия', short: 'В штабе или у вас',
    text: 'Игра с профессиональным ведущим, антуражем и сценарием для команды. Приедем со всем реквизитом в офис или проведём вечер в штабе.',
    photo: 'team-bench', href: '/events', request: { kind: 'event', format: 'corporate' },
  },
  {
    id: 'party', title: 'Тематические вечеринки', short: 'Ваша идея — наша постановка',
    text: 'Киновечер, неоновая вечеринка, ретро-ночь, stand-up, квизы, караоке или crazy birthday — превращаем любую идею в живое событие.',
    photo: '5y-2', href: '/events', request: { kind: 'event', format: 'party' },
  },
  {
    id: 'board', title: 'Настольные игры', short: 'Компанией — в штаб',
    text: 'Приходите с друзьями поиграть в настольные игры: хороший кофе, быстрый интернет и уютный зал.',
    photo: 'friendscup-1', href: '/games', request: { kind: 'game', evening: 'board_games' },
  },
]

export const formatById = (id: FormatId): Format => FORMATS.find((f) => f.id === id) ?? FORMATS[0]!
