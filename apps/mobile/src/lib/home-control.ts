import type { SFSymbol } from 'sf-symbols-typescript';

import { haCall, haLastMode, useHa, type HaEntity } from './home-assistant';
import { haptic } from './haptics';
import type { Zone } from './smart-home-api';

/**
 * Свет и кондиционеры поверх сущностей Home Assistant: что умеет устройство, подписи
 * и команды. Результат команды виден сразу (оптимистично), при отказе HA — откат и
 * строка ошибки в шторке. Логика та же, что у планшетов Titan Home (apps/home/…/room.ts).
 */

const domainOf = (entityId: string) => entityId.split('.')[0] ?? '';

/** Свет — лампы, группы света и реле (switch, input_boolean): только вкл/выкл. */
export const LIGHT_DOMAINS = ['light', 'switch', 'input_boolean'];

export const isOn = (entity?: HaEntity) => entity?.state === 'on';
export const isUnavailable = (entity?: HaEntity) => !entity || entity.state === 'unavailable' || entity.state === 'unknown';
export const isClimateOn = (entity?: HaEntity) => !!entity && !['off', 'unavailable', 'unknown'].includes(entity.state);

const FAILURE_MS = 4_000;
let failureTimer: ReturnType<typeof setTimeout> | null = null;

function reportFailure(error: unknown) {
  haptic.error();
  useHa.setState({ failure: error instanceof Error ? error.message : String(error) });
  if (failureTimer) clearTimeout(failureTimer);
  failureTimer = setTimeout(() => useHa.setState({ failure: null }), FAILURE_MS);
}

/** Показать результат до ответа HA; вернуть откат. */
function patchEntity(entityId: string, patch: { state?: string; attributes?: Record<string, unknown> }) {
  const current = useHa.getState().entities[entityId];
  if (!current) return () => {};
  useHa.setState((s) => ({
    entities: {
      ...s.entities,
      [entityId]: { ...current, state: patch.state ?? current.state, attributes: { ...current.attributes, ...(patch.attributes ?? {}) } },
    },
  }));
  return () => useHa.setState((s) => ({ entities: { ...s.entities, [entityId]: current } }));
}

async function run(entityId: string, patch: Parameters<typeof patchEntity>[1], call: () => Promise<unknown>): Promise<void> {
  const revert = patchEntity(entityId, patch);
  try {
    await call();
  } catch (error) {
    revert();
    reportFailure(error);
  }
}

/* ─────────────────────────────── Свет ─────────────────────────────── */

export function setLight(entityId: string, on: boolean) {
  const domain = domainOf(entityId);
  const target = LIGHT_DOMAINS.includes(domain) ? domain : 'homeassistant';
  return run(entityId, { state: on ? 'on' : 'off' }, () => haCall(target, on ? 'turn_on' : 'turn_off', entityId));
}

/* ─────────────────────────────── Климат ─────────────────────────────── */

export const HVAC_LABEL: Record<string, string> = {
  off: 'Выключен',
  cool: 'Охлаждение',
  heat: 'Обогрев',
  heat_cool: 'Тепло и холод',
  auto: 'Авто',
  dry: 'Осушение',
  fan_only: 'Обдув',
};

/** Короткие подписи для кнопок режимов. */
export const HVAC_SHORT: Record<string, string> = {
  cool: 'Холод',
  heat: 'Тепло',
  heat_cool: 'Т/Х',
  auto: 'Авто',
  dry: 'Сушка',
  fan_only: 'Обдув',
};

export const HVAC_SYMBOL: Record<string, SFSymbol> = {
  cool: 'snowflake',
  heat: 'flame.fill',
  heat_cool: 'sun.max',
  auto: 'arrow.triangle.2.circlepath',
  dry: 'drop.fill',
  fan_only: 'fan',
};

/** Цвет режима: им подсвечены температура и выбранная кнопка. */
export const HVAC_TONE: Record<string, string> = {
  cool: '#32ADE6',
  heat: '#FF9500',
  heat_cool: '#AF52DE',
  auto: '#8B5CF6',
  dry: '#30B0C7',
  fan_only: '#8E8E93',
};

// Порядок кнопок режимов: самые нужные в клубе — первыми.
const MODE_ORDER = ['cool', 'heat', 'auto', 'heat_cool', 'dry', 'fan_only'];

export type ClimateInfo = {
  mode: string;
  modes: string[];
  current: number | null;
  target: number | null;
  min: number;
  max: number;
  step: number;
};

const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

export function climateInfo(entity?: HaEntity): ClimateInfo {
  const a = entity?.attributes ?? {};
  const rank = (mode: string) => (MODE_ORDER.includes(mode) ? MODE_ORDER.indexOf(mode) : 99);
  const modes = (Array.isArray(a.hvac_modes) ? (a.hvac_modes as string[]) : []).filter((m) => m !== 'off').sort((x, y) => rank(x) - rank(y));
  return {
    mode: entity?.state ?? 'off',
    modes,
    current: num(a.current_temperature),
    target: num(a.temperature),
    min: num(a.min_temp) ?? 16,
    max: num(a.max_temp) ?? 30,
    step: num(a.target_temp_step) ?? 0.5,
  };
}

export function setHvacMode(entityId: string, mode: string) {
  return run(entityId, { state: mode }, () => haCall('climate', 'set_hvac_mode', entityId, { hvac_mode: mode }));
}

/** «Включить» возвращает последний рабочий режим, а не первый попавшийся. */
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

export const fmtTemp = (t: number) => (Number.isInteger(t) ? String(t) : t.toFixed(1).replace('.', ','));

/* ─────────────────────────────── Помещения ─────────────────────────────── */

export type HomeSummary = { lightsOn: number; climatesOn: number; anyOn: boolean };

export function homeSummary(zones: Zone[], entities: Record<string, HaEntity>): HomeSummary {
  const lights = new Set<string>();
  const climates = new Set<string>();
  for (const zone of zones) {
    for (const light of zone.lights) if (isOn(entities[light.entityId])) lights.add(light.entityId);
    for (const climate of zone.climates) if (isClimateOn(entities[climate.entityId])) climates.add(climate.entityId);
  }
  return { lightsOn: lights.size, climatesOn: climates.size, anyOn: lights.size + climates.size > 0 };
}

/** Выключить свет и кондиционеры в помещениях (одно помещение или все разом). */
export async function turnOffZones(zones: Zone[]) {
  const { entities } = useHa.getState();
  const jobs: Promise<void>[] = [];
  const seen = new Set<string>();
  for (const zone of zones) {
    for (const light of zone.lights) {
      if (seen.has(light.entityId) || !isOn(entities[light.entityId])) continue;
      seen.add(light.entityId);
      jobs.push(setLight(light.entityId, false));
    }
    for (const climate of zone.climates) {
      if (seen.has(climate.entityId) || !isClimateOn(entities[climate.entityId])) continue;
      seen.add(climate.entityId);
      jobs.push(setHvacMode(climate.entityId, 'off'));
    }
  }
  await Promise.all(jobs);
}
