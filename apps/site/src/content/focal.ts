/**
 * Точки кадрирования фото сайта (object-position), найдены по лицам (macOS Vision,
 * scratchpad/tools/focal.swift): по горизонтали — центр лиц, по вертикали — чуть выше
 * верхнего края лиц, чтобы при обрезке под карточку не резало головы.
 */
export const FOCAL: Record<string, string> = {
  '5y-1': '50% 16%',
  '5y-2': '52% 16%',
  '5y-3': '53% 21%',
  'dark-room': '38% 26%',
  'emc2021-1': '52% 8%',
  'emc2021-2': '50% 18%',
  'emc2021-3': '51% 24%',
  'friendscup-1': '55% 9%',
  'friendscup-2': '46% 22%',
  'girlcup-1': '48% 13%',
  'girlcup-2': '46% 31%',
  'girlcup-3': '42% 5%',
  'girls-violet': '49% 18%',
  'halloween-1': '51% 18%',
  'halloween-2': '49% 20%',
  'halloween-3': '53% 19%',
  'kid-mask': '43% 30%',
  'meladzecup-1': '52% 7%',
  'meladzecup-2': '52% 8%',
  'meladzecup-3': '48% 15%',
  'noir-hats': '73% 26%',
  'players': '42% 14%',
  'police': '34% 13%',
  'smc2022-1': '44% 21%',
  'smc2022-2': '60% 32%',
  'smc2022-3': '50% 29%',
  'smc2025-1': '51% 21%',
  'smc2025-2': '51% 29%',
  'smc2025-3': '52% 24%',
  'table-night': '49% 4%',
  'team-bench': '51% 10%',
  'team-bw': '51% 10%',
  'team-studio': '56% 9%',
  'wanted': '63% 24%',
}

/** Для фото без разметки (загрузки из HUB) — верхняя треть: там обычно лица. */
export const DEFAULT_FOCAL = '50% 28%'
