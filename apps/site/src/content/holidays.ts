/**
 * Праздничное оформление сайта. Владелец включает праздник в HUB («Сайт →
 * Оформление»), сайт сохраняет каркас и стекло, а сверху добавляет частицы
 * (снег, сердца, листья…), декорации и оттенок подложки.
 */
export const HOLIDAYS = [
  'new_year', 'winter', 'valentine', 'defender', 'womens_day', 'maslenitsa',
  'spring', 'summer', 'autumn', 'halloween', 'club_birthday',
] as const
export type HolidayId = (typeof HOLIDAYS)[number]
export const isHoliday = (v: unknown): v is HolidayId => typeof v === 'string' && (HOLIDAYS as readonly string[]).includes(v)

export type ParticleKind = 'snow' | 'hearts' | 'leaves' | 'petals' | 'confetti' | 'bats' | 'stars' | 'sparks' | 'bokeh'
export type Decor = 'garland' | 'snowman' | 'pumpkins' | 'web' | 'balloons' | 'sun' | 'mimosa'
export type HolidayIcon = 'snowflake' | 'tree' | 'heart' | 'star' | 'flower' | 'sun' | 'leaf' | 'ghost' | 'cake'

export interface HolidayDef {
  label: string
  greeting: string
  icon: HolidayIcon
  particles: { kind: ParticleKind; colors: string[]; density: number }
  decor: Decor[]
}

export const HOLIDAY_DEFS: Record<HolidayId, HolidayDef> = {
  new_year: { label: 'Новый год', greeting: 'С Новым годом! Новогодние вечера мафии — записывайтесь заранее', icon: 'tree',
    particles: { kind: 'snow', colors: ['#FFFFFF', '#DDEBFF', '#C9DCFF'], density: 1 }, decor: ['garland', 'snowman'] },
  winter: { label: 'Зима', greeting: 'Зимние вечера в тёплом клубе — ждём вас', icon: 'snowflake',
    particles: { kind: 'snow', colors: ['#FFFFFF', '#E3EEFF'], density: 0.8 }, decor: [] },
  valentine: { label: 'День влюблённых', greeting: 'С Днём святого Валентина! Приходите парой — найдите мафию вдвоём', icon: 'heart',
    particles: { kind: 'hearts', colors: ['#FF5C8A', '#FF8FB1', '#E8336B'], density: 0.6 }, decor: [] },
  defender: { label: '23 февраля', greeting: 'С Днём защитника Отечества!', icon: 'star',
    particles: { kind: 'stars', colors: ['#F4C95D', '#FFE29A', '#D9A93B'], density: 0.5 }, decor: [] },
  womens_day: { label: '8 Марта', greeting: 'С 8 Марта! Весенние вечера для прекрасных дам', icon: 'flower',
    particles: { kind: 'petals', colors: ['#FFB3D1', '#FFD6E5', '#F7E35B'], density: 0.7 }, decor: ['mimosa'] },
  maslenitsa: { label: 'Масленица', greeting: 'Широкая Масленица в клубе!', icon: 'sun',
    particles: { kind: 'sparks', colors: ['#FFB547', '#FFD27A', '#FF8A3D'], density: 0.6 }, decor: ['sun'] },
  spring: { label: 'Весна', greeting: 'Весна в клубе — новые игры и новые лица', icon: 'flower',
    particles: { kind: 'petals', colors: ['#FFD1E3', '#FFFFFF', '#FFC2D6'], density: 0.6 }, decor: [] },
  summer: { label: 'Лето', greeting: 'Летние вечера мафии — прохладно в клубе, жарко за столом', icon: 'sun',
    particles: { kind: 'bokeh', colors: ['#FFE08A', '#8FF0E0', '#FFFFFF'], density: 0.5 }, decor: ['sun'] },
  autumn: { label: 'Осень', greeting: 'Осенний сезон турниров открыт', icon: 'leaf',
    particles: { kind: 'leaves', colors: ['#E8742B', '#F2A93B', '#C7442E', '#D9902F'], density: 0.6 }, decor: [] },
  halloween: { label: 'Хэллоуин', greeting: 'Halloween Mafia Party: найдите мафию среди нечисти', icon: 'ghost',
    particles: { kind: 'bats', colors: ['#14101F', '#22172F'], density: 0.35 }, decor: ['pumpkins', 'web'] },
  club_birthday: { label: 'День рождения клуба', greeting: 'Клубу TITAN KBR — новый год жизни! Празднуем вместе', icon: 'cake',
    particles: { kind: 'confetti', colors: ['#F4C95D', '#9B7BFF', '#FF6FA3', '#5FD3FF', '#FFFFFF'], density: 0.8 }, decor: ['balloons'] },
}
