// Свет и климат кабинки поверх сущностей Home Assistant: что умеет устройство,
// подписи для гостя и команды (с мгновенным откликом на экране).
import { Droplets, Fan, Flame, type LucideIcon, RefreshCw, Snowflake, Sun } from 'lucide-react-native';

import type { SmartRoom } from '@/data/types';

import { haCall, haLastMode, type HaEntity, patchEntity, useHa } from './ha';

const domainOf = (entityId: string) => entityId.split('.')[0] ?? '';

/* ─────────────────────────────── Свет ─────────────────────────────── */
// Группы света в кабинках — только вкл/выкл (без яркости).

export const LIGHT_DOMAINS = ['light', 'switch', 'input_boolean'];

export const isOn = (e?: HaEntity) => e?.state === 'on';
export const isUnavailable = (e?: HaEntity) => !e || e.state === 'unavailable' || e.state === 'unknown';

async function run(entityId: string, patch: Parameters<typeof patchEntity>[1], call: () => Promise<unknown>) {
  const revert = patchEntity(entityId, patch);
  try {
    await call();
  } catch (e) {
    revert();
    throw e;
  }
}

export function setLight(entityId: string, on: boolean) {
  const domain = domainOf(entityId);
  const target = LIGHT_DOMAINS.includes(domain) ? domain : 'homeassistant';
  return run(entityId, { state: on ? 'on' : 'off' }, () => haCall(target, on ? 'turn_on' : 'turn_off', entityId));
}

/* ─────────────────────────────── Климат ─────────────────────────────── */

export const HVAC_LABEL: Record<string, string> = {
  off: 'Выключен', cool: 'Охлаждение', heat: 'Обогрев', heat_cool: 'Тепло и холод', auto: 'Авто', dry: 'Осушение', fan_only: 'Обдув',
};

/** Короткие подписи для сегментов режимов. */
export const HVAC_SHORT: Record<string, string> = {
  cool: 'Холод', heat: 'Тепло', heat_cool: 'Т/Х', auto: 'Авто', dry: 'Сушка', fan_only: 'Обдув',
};

export const HVAC_ICON: Record<string, LucideIcon> = {
  cool: Snowflake, heat: Flame, heat_cool: Sun, auto: RefreshCw, dry: Droplets, fan_only: Fan,
};

/** Цвет режима — им подсвечены температура и активный сегмент. */
export const HVAC_TONE: Record<string, string> = {
  cool: '#8FD8F8', heat: '#FB923C', heat_cool: '#C4B5FD', auto: '#C4B5FD', dry: '#5EEAD4', fan_only: '#CBD5E1',
};

const FAN_LABEL: Record<string, string> = {
  auto: 'Авто', low: 'Тихо', quiet: 'Тихо', silent: 'Тихо', medium: 'Средне', middle: 'Средне', mid: 'Средне',
  high: 'Сильно', strong: 'Сильно', turbo: 'Турбо', focus: 'Фокус', diffuse: 'Рассеянно', on: 'Вкл', off: 'Выкл',
};
export const fanLabel = (mode: string) => FAN_LABEL[mode.toLowerCase()] ?? mode;

// Порядок кнопок режимов: самые нужные в кабинке — первыми.
const MODE_ORDER: string[] = ['cool', 'heat', 'auto', 'heat_cool', 'dry', 'fan_only'];

export function climateInfo(e?: HaEntity) {
  const a = e?.attributes ?? {};
  const modes = (Array.isArray(a.hvac_modes) ? (a.hvac_modes as string[]) : []).filter((m) => m !== 'off');
  const rank = (m: string) => (MODE_ORDER.includes(m) ? MODE_ORDER.indexOf(m) : 99);
  modes.sort((x, y) => rank(x) - rank(y));
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return {
    mode: (e?.state ?? 'off') as string,
    modes,
    current: num(a.current_temperature),
    target: num(a.temperature),
    min: num(a.min_temp) ?? 16,
    max: num(a.max_temp) ?? 30,
    step: num(a.target_temp_step) ?? 0.5,
    fanModes: Array.isArray(a.fan_modes) ? (a.fan_modes as string[]) : [],
    fanMode: typeof a.fan_mode === 'string' ? a.fan_mode : null,
    humidity: num(a.current_humidity),
  };
}

export function setHvacMode(entityId: string, mode: string) {
  return run(entityId, { state: mode }, () => haCall('climate', 'set_hvac_mode', entityId, { hvac_mode: mode }));
}

/** «Включить» возвращает последний рабочий режим (он хранится на планшете), а не «Авто». */
export function powerClimate(entityId: string, on: boolean) {
  if (!on) return setHvacMode(entityId, 'off');
  const info = climateInfo(useHa.getState().entities[entityId]);
  const remembered = haLastMode(entityId);
  const mode = remembered && info.modes.includes(remembered) ? remembered : (info.modes[0] ?? 'cool');
  return setHvacMode(entityId, mode);
}

export function setTemperature(entityId: string, temperature: number) {
  return run(entityId, { attributes: { temperature } }, () => haCall('climate', 'set_temperature', entityId, { temperature }));
}

export function setFanMode(entityId: string, fanMode: string) {
  return run(entityId, { attributes: { fan_mode: fanMode } }, () => haCall('climate', 'set_fan_mode', entityId, { fan_mode: fanMode }));
}

/** Гости ушли: гасим свет и выключаем кондиционер (настройка «Выключать после счёта»). */
export async function roomAllOff(room: SmartRoom) {
  const { entities } = useHa.getState();
  const jobs: Promise<unknown>[] = [];
  for (const l of room.lights) if (isOn(entities[l.entityId])) jobs.push(setLight(l.entityId, false));
  if (room.climate && entities[room.climate.entityId]?.state !== 'off') jobs.push(setHvacMode(room.climate.entityId, 'off'));
  await Promise.allSettled(jobs);
}

export function roomEntityIds(room: SmartRoom | null | undefined): string[] {
  if (!room) return [];
  return [...room.lights.map((l) => l.entityId), ...(room.climate ? [room.climate.entityId] : [])];
}

export const fmtTemp = (t: number) => (Number.isInteger(t) ? String(t) : t.toFixed(1).replace('.', ','));
