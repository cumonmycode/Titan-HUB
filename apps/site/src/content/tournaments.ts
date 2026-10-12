/** Турниры и вечеринки клуба (портфолио). Адреса страниц — как на старом сайте. */

export interface Stat { value: string; label: string }

export interface Tournament {
  slug: string
  title: string
  tagline: string
  kind: 'tournament' | 'party'
  text: string[]
  stats: Stat[]
  photos: string[] // имена из public/media без размера
  resultsUrl?: string
  galleryUrl: string
}

export const TOURNAMENTS: Tournament[] = [
  {
    slug: 'smc2025', title: 'Society Mafia Cup 2025', tagline: 'Самый большой турнир в Кабардино-Балкарии', kind: 'tournament',
    text: [
      'Ежегодный турнир по спортивной мафии от клуба TITAN KBR собирает сильнейших игроков региона, чтобы определить лучшего мафиозного стратега года.',
      'Напряжённые партии, профессиональное судейство и атмосфера интеллектуального поединка: каждый раунд — сражение разума, логики и интуиции, где решает одна фраза.',
      'Society Mafia Cup — больше, чем турнир: встреча единомышленников и праздник для всех, кто живёт игрой. Финалисты получают призы, признание сообщества и место в истории TITAN KBR.',
    ],
    stats: [{ value: '30', label: 'участников' }, { value: '50 000 ₽', label: 'призовой фонд' }, { value: '1721', label: 'ELO турнира' }],
    photos: ['smc2025-1', 'smc2025-2', 'smc2025-3'],
    resultsUrl: 'https://gomafia.pro/tournament/1982',
    galleryUrl: 'https://drive.google.com/drive/folders/1JhJjbJ77u-ZVGnFhV6w9SpHlW1vsdv9T?usp=sharing',
  },
  {
    slug: 'friendscup', title: 'Friends Cup', tagline: 'Мафия, как в хорошей компании', kind: 'tournament',
    text: [
      'Миникап под тематикой легендарного сериала «Друзья»: 10 игроков из Нальчика, Владикавказа, Ессентуков, Минеральных Вод и Пятигорска провели день, полный смеха и мафиозных интриг.',
      'Этот миникап не про соперничество — он про дружбу, эмоции и удовольствие от игры. Место за столом нашлось для всех, как в Центральной кофейне.',
    ],
    stats: [{ value: '10', label: 'участников' }, { value: '5', label: 'городов' }, { value: '1570', label: 'ELO турнира' }],
    photos: ['friendscup-1', 'friendscup-2', 'table-night'],
    resultsUrl: 'https://gomafia.pro/tournament/2271',
    galleryUrl: 'https://drive.google.com/drive/folders/1JhJjbJ77u-ZVGnFhV6w9SpHlW1vsdv9T?usp=sharing',
  },
  {
    slug: 'girlcup', title: 'Женский миникап', tagline: 'Игра со стилем', kind: 'tournament',
    text: [
      'Girl power в мафии: за игровые столы сели только девушки из Нальчика, Владикавказа, Минеральных Вод, Пятигорска и Ессентуков.',
      'День азарта, улыбок и командного духа, а на память — бьюти-подарки от партнёров турнира. Мафия, которая звучит по-новому.',
    ],
    stats: [{ value: '10', label: 'участниц' }, { value: '3', label: 'города' }, { value: '1384', label: 'ELO турнира' }],
    photos: ['girlcup-1', 'girlcup-2', 'girlcup-3'],
    resultsUrl: 'https://gomafia.pro/tournament/1250',
    galleryUrl: 'https://drive.google.com/drive/folders/1_nnKEVu_I3lqNHhViKBqkGrl28rvzWD7?usp=sharing',
  },
  {
    slug: '5y', title: '5 лет клубу Titan KBR', tagline: 'Эпоха гангстеров и блеска', kind: 'party',
    text: [
      'Клуб отметил пятый день рождения вечеринкой в духе мафии 20-х: джаз, костюмы в стиле Гэтсби, шляпы, перья и блеск бокалов — настоящее подпольное казино золотой эпохи Чикаго.',
      'За столами — коварные мафиози и обаятельные леди, за кадром — смех, музыка и лучшие моменты пяти лет. И это только начало.',
    ],
    stats: [{ value: '50', label: 'гостей' }, { value: '4', label: 'города' }, { value: '10', label: 'часов веселья' }],
    photos: ['5y-1', '5y-2', '5y-3'],
    galleryUrl: 'https://drive.google.com/drive/folders/1MCA-ltEV3yHALo7j4c44OLc9gskTjL05?usp=sharing',
  },
  {
    slug: 'halloween', title: 'Halloween 2025', tagline: 'Ночь, где мафия оживает', kind: 'party',
    text: [
      'Halloween Mafia Party: костюмы, маски и игры до глубокой ночи. Гости приехали из семи городов, чтобы найти мафию среди нечисти.',
    ],
    stats: [{ value: '60', label: 'гостей' }, { value: '7', label: 'городов' }, { value: '9', label: 'часов веселья' }],
    photos: ['halloween-1', 'halloween-2', 'halloween-3'],
    galleryUrl: 'https://drive.google.com/drive/folders/1ILzGwMEa-h4HOsMmU-6rBA5lb3PBYiRw?usp=sharing',
  },
  {
    slug: 'meladzecup', title: 'Meladze Cup', tagline: 'Мафия под музыку, которая трогает душу', kind: 'tournament',
    text: [
      'Особенный миникап, посвящённый творчеству Валерия Меладзе: весь вечер за столами звучали его лучшие хиты.',
      'Игроки из Нальчика, Владикавказа, Ессентуков, Пятигорска и Минеральных Вод, а в финале — подарок каждому на память. Там, где звучит Меладзе, игра превращается в историю.',
    ],
    stats: [{ value: '10', label: 'участников' }, { value: '4', label: 'города' }, { value: '1492', label: 'ELO турнира' }],
    photos: ['meladzecup-1', 'meladzecup-2', 'meladzecup-3'],
    resultsUrl: 'https://gomafia.pro/tournament/1380',
    galleryUrl: 'https://drive.google.com/drive/folders/1ZyshOOKNrG4B4i1ovLV_FEAq1BPDwrDr?usp=sharing',
  },
  {
    slug: 'smc2022', title: 'Society Mafia Cup 2022', tagline: 'Старт новой эры мафии', kind: 'tournament',
    text: [
      'С этого турнира началась история больших мафиозных сражений TITAN KBR: игроки из девяти городов открыли новую страницу спортивной мафии в регионе.',
      'Каждая партия — мини-триллер с неожиданными поворотами. Здесь родилась традиция, которая ежегодно объединяет лучших.',
    ],
    stats: [{ value: '40', label: 'участников' }, { value: '9', label: 'городов' }, { value: '1240', label: 'ELO турнира' }],
    photos: ['smc2022-1', 'smc2022-2', 'smc2022-3'],
    resultsUrl: 'https://gomafia.pro/tournament/72',
    galleryUrl: 'https://drive.google.com/drive/folders/1T1IKM7QZyJeDCoa6KB6s_8_fZueDacIU?usp=sharing',
  },
  {
    slug: 'emc2021', title: 'Elbrus Mafia Cup 2021', tagline: 'Мафия на высоте', kind: 'tournament',
    text: [
      'Самый высокогорный турнир по мафии в истории: на склонах Эльбруса, под облаками, собрались лучшие игроки из разных городов.',
      'Каждый раунд — на фоне Кавказа, где стратегия и интуиция звучат в гармонии с природой. Легендарная веха в истории TITAN KBR.',
    ],
    stats: [{ value: '20', label: 'участников' }, { value: '5', label: 'городов' }, { value: '3', label: 'дня' }],
    photos: ['emc2021-1', 'emc2021-2', 'emc2021-3'],
    resultsUrl: 'https://mafiaworldtour.org/tournaments/1279',
    galleryUrl: 'https://drive.google.com/drive/folders/1Kw-fR9QgWN7s7LzAcTUafyXIua_P_olQ?usp=sharing',
  },
]

export const tournamentBySlug = (slug: string): Tournament | undefined => TOURNAMENTS.find((t) => t.slug === slug)
