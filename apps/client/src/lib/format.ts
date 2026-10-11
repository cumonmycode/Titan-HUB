// Форматирование денег, бонусов, дат и склонений — единые правила для экранов.

const rub0 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
const rub2 = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 1 250 ₽ (копейки показываем, только если они есть). */
export function money(amount: number, withSign = false): string {
  const abs = Math.abs(amount);
  const body = Number.isInteger(Math.round(abs * 100) / 100) ? rub0.format(abs) : rub2.format(abs);
  const sign = withSign ? (amount > 0 ? '+' : amount < 0 ? '−' : '') : amount < 0 ? '−' : '';
  return `${sign}${body} ₽`;
}

export function bonus(amount: number): string {
  return rub0.format(Math.floor(amount));
}

export function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

const dayMonth = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' });
const dayMonthYear = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
const time = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' });
const shortDate = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit' });

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** «Сегодня» / «Вчера» / «12 сентября» / «12 сентября 2025» — заголовок группы. */
export function dayTitle(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const diff = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
  if (diff === 0) return 'Сегодня';
  if (diff === 1) return 'Вчера';
  return d.getFullYear() === now.getFullYear() ? dayMonth.format(d) : dayMonthYear.format(d);
}

export function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function clock(iso: string): string {
  return time.format(new Date(iso));
}

export function ddmm(iso: string): string {
  return shortDate.format(new Date(iso));
}

export function longDate(iso: string): string {
  return dayMonthYear.format(new Date(iso));
}

/** «только что» / «5 мин назад» / «14:32» / «вчера, 14:32» / «12 сентября». */
export function relative(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const sec = Math.round((now.getTime() - d.getTime()) / 1000);
  if (sec < 60) return 'только что';
  if (sec < 3600) return `${Math.floor(sec / 60)} мин назад`;
  const title = dayTitle(iso, now);
  if (title === 'Сегодня') return clock(iso);
  if (title === 'Вчера') return `вчера, ${clock(iso)}`;
  return title;
}

/** «через 3 дня» / «завтра» / «сегодня» — для сгорания бонусов. */
export function inDays(iso: string, now = new Date()): string {
  const days = Math.round((startOfDay(new Date(iso)) - startOfDay(now)) / 86_400_000);
  if (days <= 0) return 'сегодня';
  if (days === 1) return 'завтра';
  return `через ${days} ${plural(days, 'день', 'дня', 'дней')}`;
}

/** Телефон в +7XXXXXXXXXX по мере ввода. */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  const d = digits.startsWith('8') ? '7' + digits.slice(1) : digits.startsWith('7') ? digits : '7' + digits;
  return '+' + d.slice(0, 11);
}

const NATIONAL_LENGTH = 10;

/**
 * Номер без «+7» из того, что ввели, вставили или подставила клавиатура (iOS
 * подставляет «+7 (999) 123-45-67», бывает «8 999…» или «999…»). Длину поля не
 * ограничиваем — иначе система обрезает автозаполнение. prev — прошлое значение:
 * лишняя цифра, набранная к полному номеру, отбрасывается.
 */
export function nationalPhoneDigits(prev: string, text: string): string {
  const digits = text.replace(/\D/g, '');
  if (digits.length <= NATIONAL_LENGTH) return digits;
  if (prev.length === NATIONAL_LENGTH && digits.length === NATIONAL_LENGTH + 1 && digits.startsWith(prev)) return prev;
  if (digits.length === NATIONAL_LENGTH + 1 && (digits.startsWith('7') || digits.startsWith('8'))) return digits.slice(1);
  return digits.slice(-NATIONAL_LENGTH);
}

/** «9991234567» → «999 123-45-67» (разделители — только перед цифрами). */
export function formatNationalPhone(digits: string): string {
  let out = digits.slice(0, 3);
  if (digits.length > 3) out += ` ${digits.slice(3, 6)}`;
  if (digits.length > 6) out += `-${digits.slice(6, 8)}`;
  if (digits.length > 8) out += `-${digits.slice(8, 10)}`;
  return out;
}

export const isFullNationalPhone = (digits: string) => digits.length === NATIONAL_LENGTH;
export const displayPhone = (digits: string) => `+7 ${formatNationalPhone(digits)}`;

/** ДД.ММ.ГГГГ ↔ YYYY-MM-DD для поля дня рождения. */
export function birthdayToInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : '';
}

export function maskBirthday(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}.${d.slice(2)}`;
  return `${d.slice(0, 2)}.${d.slice(2, 4)}.${d.slice(4)}`;
}

export function inputToBirthday(value: string): string | null | 'invalid' {
  if (!value.trim()) return null;
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value.trim());
  if (!m) return 'invalid';
  const [, dd, mm, yyyy] = m;
  const date = new Date(`${yyyy}-${mm}-${dd}T00:00:00`);
  if (Number.isNaN(date.getTime()) || date.getDate() !== Number(dd) || Number(yyyy) < 1920 || date > new Date()) {
    return 'invalid';
  }
  return `${yyyy}-${mm}-${dd}`;
}
