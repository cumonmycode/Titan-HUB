/**
 * Текст для озвучки по-русски: числа прописью в нужном роде и с согласованными словами.
 * Синтезатор читает «48 200 ₽» как попало (по-английски, с ошибками в падежах), поэтому
 * перед синтезом суммы, тысячи, проценты, время и даты разворачиваются в слова:
 * «48 200 ₽» → «сорок восемь тысяч двести рублей», «9 окт» → «девятого октября».
 */

type Gender = 'm' | 'f' | 'n'

const UNITS: Record<Gender, string[]> = {
  m: ['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'],
  f: ['', 'одна', 'две', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'],
  n: ['', 'одно', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'],
}
const TEENS = ['десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать', 'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать']
const TENS = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто']
const HUNDREDS = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот']
const SCALES: { forms: [string, string, string]; gender: Gender }[] = [
  { forms: ['тысяча', 'тысячи', 'тысяч'], gender: 'f' },
  { forms: ['миллион', 'миллиона', 'миллионов'], gender: 'm' },
  { forms: ['миллиард', 'миллиарда', 'миллиардов'], gender: 'm' },
]

/** Форма слова после числа: 1 чек, 2 чека, 5 чеков. */
export function plural(n: number, forms: readonly [string, string, string]): string {
  const a = Math.abs(n) % 100
  const b = a % 10
  if (a > 10 && a < 20) return forms[2]
  if (b === 1) return forms[0]
  if (b > 1 && b < 5) return forms[1]
  return forms[2]
}

function triad(n: number, gender: Gender): string[] {
  const words: string[] = []
  const h = Math.floor(n / 100)
  const rest = n % 100
  if (h) words.push(HUNDREDS[h]!)
  if (rest >= 10 && rest < 20) words.push(TEENS[rest - 10]!)
  else {
    const t = Math.floor(rest / 10)
    const u = rest % 10
    if (t) words.push(TENS[t]!)
    if (u) words.push(UNITS[gender][u]!)
  }
  return words
}

/** Целое число прописью: 48200 → «сорок восемь тысяч двести». */
export function numberWords(value: number, gender: Gender = 'm'): string {
  let n = Math.round(Math.abs(value))
  if (n === 0) return 'ноль'
  const parts: string[] = []
  const groups: number[] = []
  while (n > 0) {
    groups.push(n % 1000)
    n = Math.floor(n / 1000)
  }
  for (let i = groups.length - 1; i >= 0; i -= 1) {
    const g = groups[i]!
    if (!g) continue
    if (i === 0) parts.push(...triad(g, gender))
    else {
      const scale = SCALES[i - 1]
      if (!scale) continue
      // «тысяча пятьсот», а не «одна тысяча пятьсот».
      if (g === 1 && i === 1) parts.push(scale.forms[0])
      else parts.push(...triad(g, scale.gender), plural(g, scale.forms))
    }
  }
  return `${value < 0 ? 'минус ' : ''}${parts.join(' ')}`
}

const ORDINAL_GEN: string[] = [
  '', 'первого', 'второго', 'третьего', 'четвёртого', 'пятого', 'шестого', 'седьмого', 'восьмого', 'девятого', 'десятого',
  'одиннадцатого', 'двенадцатого', 'тринадцатого', 'четырнадцатого', 'пятнадцатого', 'шестнадцатого', 'семнадцатого',
  'восемнадцатого', 'девятнадцатого', 'двадцатого',
]
function dayGenitive(day: number): string {
  if (day <= 20) return ORDINAL_GEN[day] ?? String(day)
  if (day < 30) return `двадцать ${ORDINAL_GEN[day - 20]}`
  if (day === 30) return 'тридцатого'
  return `тридцать ${ORDINAL_GEN[day - 30]}`
}

const MONTHS: [RegExp, string][] = [
  [/^янв/i, 'января'], [/^фев/i, 'февраля'], [/^мар/i, 'марта'], [/^апр/i, 'апреля'], [/^ма[йя]/i, 'мая'], [/^июн/i, 'июня'],
  [/^июл/i, 'июля'], [/^авг/i, 'августа'], [/^сен/i, 'сентября'], [/^окт/i, 'октября'], [/^ноя/i, 'ноября'], [/^дек/i, 'декабря'],
]

// Слова женского и среднего рода, после которых число согласуется: «две позиции», «одно место».
const FEMININE = /^(тысяч|позици|штук|смен|игр|недел|минут|секунд|бутыл|банк|пачк|чашк|кабинк|зон|пицц|порци|скидк|ночь|ноч[еи])/i
const NEUTER = /^(мест|окн|блюд|утр|очк)/i

const toInt = (digits: string) => Number(digits.replace(/[\s ]/g, ''))

/** Текст ответа → то, что синтезатор прочитает правильно. */
export function speakable(text: string): string {
  return (
    text
      .replace(/\*\*/g, '')
      .replace(/^#+\s*/gm, '')
      .replace(/^\s*([-*•]|\d+[.)])\s+/gm, '')
      .replace(/[«»"]/g, '')
      // Даты: «9 окт», «9 октября» → «девятого октября».
      .replace(/\b(\d{1,2})\s+(янв|фев|мар|апр|ма[йя]|июн|июл|авг|сен|окт|ноя|дек)[а-яё]*\.?/gi, (_, d: string, m: string) => {
        const month = MONTHS.find(([re]) => re.test(m))?.[1] ?? m
        const day = Number(d)
        return day >= 1 && day <= 31 ? `${dayGenitive(day)} ${month}` : `${d} ${month}`
      })
      // Время: «21:40» → «двадцать один сорок», «21:00» → «двадцать один час».
      .replace(/\b([01]?\d|2[0-3]):([0-5]\d)\b/g, (_, h: string, mm: string) => {
        const hour = Number(h)
        const minutes = Number(mm)
        if (!minutes) return `${numberWords(hour)} ${plural(hour, ['час', 'часа', 'часов'])}`
        return `${numberWords(hour)} ${mm.startsWith('0') ? 'ноль ' : ''}${numberWords(minutes, 'f')}`
      })
      // «48 тыс. ₽», «48 тысяч рублей» → «сорок восемь тысяч рублей».
      .replace(/(\d[\d\s ]*?)\s*тыс\.?(?=\s|$|[,.!?])/gi, (_, d: string) => `${numberWords(toInt(d), 'f')} ${plural(toInt(d), ['тысяча', 'тысячи', 'тысяч'])}`)
      // Суммы: «48 200 ₽», «1 460,5 руб.» → «… рублей» (копейки не читаем).
      .replace(/([−-])?(\d[\d\s ]*\d|\d)(?:[.,]\d+)?\s*(₽|руб(?:л[а-яё]*)?\.?)/gi, (_, minus: string | undefined, d: string) => {
        const n = toInt(d)
        return `${minus ? 'минус ' : ''}${numberWords(n)} ${plural(n, ['рубль', 'рубля', 'рублей'])}`
      })
      // Проценты: «+12%» → «плюс двенадцать процентов».
      .replace(/([+−-])?\s?(\d+)(?:[.,](\d+))?\s*%/g, (_, sign: string | undefined, d: string) => {
        const n = Number(d)
        const prefix = sign === '+' ? 'плюс ' : sign ? 'минус ' : ''
        return `${prefix}${numberWords(n)} ${plural(n, ['процент', 'процента', 'процентов'])}`
      })
      // Остальные числа — по роду следующего слова: «2 позиции» → «две позиции».
      .replace(/(\d[\d\s ]*\d|\d)(?:[.,]\d+)?(\s+)([а-яё]+)?/gi, (_, d: string, space: string, word: string | undefined) => {
        const gender: Gender = word && FEMININE.test(word) ? 'f' : word && NEUTER.test(word) ? 'n' : 'm'
        return `${numberWords(toInt(d), gender)}${space}${word ?? ''}`
      })
      .replace(/(\d+)/g, (d: string) => numberWords(Number(d)))
      .replace(/₽/g, 'рублей')
      .replace(/×\s*/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  )
}
