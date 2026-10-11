/**
 * Что Tai знает до первого инструмента: даты бизнес-дня клуба, кто спрашивает и на
 * каком экране. Отсюда же — системный промпт.
 */
import type { Database } from '@titan/database'
import { getBusinessDayStartHour } from '../../../lib/appSettings.js'
import { bizDayStr } from '../../../lib/dateFmt.js'
import { addDays, WEEKDAYS } from './format.js'

export interface TaiDates {
  today: string
  yesterday: string
  weekFrom: string
  lastWeekFrom: string
  lastWeekTo: string
  monthFrom: string
  lastMonthFrom: string
  lastMonthTo: string
  startHour: number
  weekday: string
}

export async function businessDates(db: Database): Promise<TaiDates> {
  const startHour = await getBusinessDayStartHour(db)
  const today = bizDayStr(0, startHour)
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay()
  const weekFrom = addDays(today, -((dow + 6) % 7))
  const monthFrom = `${today.slice(0, 8)}01`
  const lastMonthTo = addDays(monthFrom, -1)
  return {
    today,
    yesterday: addDays(today, -1),
    weekFrom,
    lastWeekFrom: addDays(weekFrom, -7),
    lastWeekTo: addDays(weekFrom, -1),
    monthFrom,
    lastMonthFrom: `${lastMonthTo.slice(0, 8)}01`,
    lastMonthTo,
    startHour,
    weekday: WEEKDAYS[dow] ?? '',
  }
}

export interface PromptInput {
  clubName: string
  nickname: string
  isOwner: boolean
  dates: TaiDates
  screenLine: string
  voice: boolean
  profanity: boolean
}

export function systemPrompt(p: PromptInput): string {
  const d = p.dates
  return [
    `Ты — Tai, свой человек в команде клуба «${p.clubName}»: помогаешь с кассой и цифрами. С тобой говорит ${p.nickname}, ${p.isOwner ? 'владелец' : 'сотрудник'}.`,
    'Общайся как живой коллега: на «ты», просто и коротко, разговорным языком, с юмором по ситуации. ' +
      (p.profanity ? 'Мат можно — к месту и без перебора, но никогда не в адрес гостей и коллег. ' : 'Без мата. ') +
      'Без канцелярита, без «Я — ИИ-ассистент», без извинений и вежливых вступлений. Главное — сделать задачу.',
    `Бизнес-день клуба начинается в ${String(d.startHour).padStart(2, '0')}:00. Сегодня ${d.today} (${d.weekday}), вчера ${d.yesterday}. ` +
      `Эта неделя ${d.weekFrom}..${d.today}, прошлая ${d.lastWeekFrom}..${d.lastWeekTo}. Этот месяц ${d.monthFrom}..${d.today}, прошлый ${d.lastMonthFrom}..${d.lastMonthTo}.`,
    p.screenLine,
    '',
    'Правила:',
    '- Данные — только из инструментов, ничего не выдумывай. Даты в инструменты — YYYY-MM-DD.',
    '- Инструменты сами показывают пользователю карточки, графики и списки. В тексте не пересказывай их цифры — дай 1–2 фразы вывода или ответ на вопрос.',
    '- Изменения в кассе (открыть чек, добавить или убрать позиции, скидка, отмена чека) — только через propose_*: пользователь подтвердит карточкой. Не пиши «готово» — скажи, что подготовил.',
    '- Чтобы открыть чек: find_clients для гостя и find_menu_items для позиций (вызывай параллельно), затем propose_open_check. Гостя нет в базе — передай guestName.',
    '- «Сюда», «в этот чек» — чек на экране. Чек другого гостя ищи через open_checks.',
    '- Неоднозначно (два похожих гостя, несколько подходящих позиций) — ask_user_choice. Не нашёл — так и скажи.',
    '- Оплату не проводи: дай кнопку перехода к оплате через show_links (screen pay).',
    '- Отвечай по-русски, без воды. Разметка — только **жирный** и короткие списки.',
    p.voice
      ? '- Голосовой режим: ответ озвучат. Начни с короткой фразы на 3–6 слов, потом ещё одна-две живые фразы, без списков и разметки. ' +
        'Все числа, суммы, проценты, время и даты пиши СЛОВАМИ в правильном падеже, без цифр и символов: «около сорока восьми тысяч рублей», «тридцать один чек», «в девять вечера». Суммы округляй.'
      : '',
  ]
    .filter((line) => line !== '')
    .join('\n')
}
