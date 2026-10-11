// Home Assistant на планшете кабинки. Соединение держит нативный слой Android
// (модуль titan-ha, foreground-сервис) — здесь только состояние для экрана и команды.
// Устройства хранятся по одному: изменилось одно — перерисуется только его плитка.
import { create } from 'zustand';

import { NativeHomeAssistant as native } from '../../../modules/titan-ha';

export type HaEntity = { entity_id: string; state: string; attributes: Record<string, unknown> };
export type HaStatus = 'idle' | 'connecting' | 'connected' | 'auth_failed' | 'offline';

type HaStore = { status: HaStatus; error: string | null; entities: Record<string, HaEntity> };

function parseSnapshot(json: string | null | undefined): HaStore | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as HaStore;
  } catch {
    return null;
  }
}

const initial = parseSnapshot(native?.getSnapshot());

export const useHa = create<HaStore>()(() => ({
  status: initial?.status ?? 'idle',
  error: initial?.error ?? null,
  entities: initial?.entities ?? {},
}));

native?.addListener('onStatus', ({ status, error }) => {
  useHa.setState({ status: status as HaStatus, error });
});

native?.addListener('onEntities', ({ json }) => {
  let patch: Record<string, HaEntity | null>;
  try {
    patch = JSON.parse(json) as Record<string, HaEntity | null>;
  } catch {
    return;
  }
  useHa.setState((s) => {
    const entities = { ...s.entities };
    for (const [id, entity] of Object.entries(patch)) {
      if (entity) entities[id] = entity;
      else delete entities[id];
    }
    return { entities };
  });
});

/** «192.168.1.50» → «http://192.168.1.50:8123»; https-адреса — как есть. */
export function normalizeHaUrl(input: string): string | null {
  let raw = input.trim().replace(/\/+$/, '');
  if (!raw) return null;
  if (!/^https?:\/\//i.test(raw)) raw = `http://${raw}`;
  const m = /^(https?):\/\/([^/:]+)(:\d+)?(\/.*)?$/i.exec(raw);
  if (!m) return null;
  const [, scheme, host, port, path] = m;
  const p = port ?? (scheme!.toLowerCase() === 'http' ? ':8123' : '');
  return `${scheme!.toLowerCase()}://${host}${p}${path ?? ''}`;
}

/** Передать адрес, токен и устройства в натив; та же конфигурация связь не рвёт. */
export function connectHa(url: string, token: string, entityIds: string[]) {
  const normalized = normalizeHaUrl(url);
  if (!native || !normalized) return;
  native.configure(normalized, token.trim(), entityIds);
}

/** Home Assistant отключили в Titan HUB или планшет отвязали от клуба. */
export function disconnectHa() {
  native?.stop();
}

export function kickHa() {
  native?.reconnect();
}

export function haCall(domain: string, service: string, entityId: string, data: Record<string, unknown> = {}) {
  if (!native) return Promise.reject(new Error('Умный дом недоступен на этом устройстве'));
  return native.callService(domain, service, entityId, JSON.stringify(data));
}

export function haLastMode(entityId: string): string | null {
  return native?.lastMode(entityId) ?? null;
}

/** Все сущности HA — для выбора устройств кабинки в панели сотрудника. */
export async function haGetStates(): Promise<HaEntity[]> {
  if (!native) throw new Error('Умный дом недоступен на этом устройстве');
  return JSON.parse(await native.getStates()) as HaEntity[];
}

/** Оптимистично показать результат команды до подтверждения от HA. */
export function patchEntity(entityId: string, patch: { state?: string; attributes?: Record<string, unknown> }) {
  const cur = useHa.getState().entities[entityId];
  if (!cur) return () => {};
  useHa.setState((s) => ({
    entities: {
      ...s.entities,
      [entityId]: { ...cur, state: patch.state ?? cur.state, attributes: { ...cur.attributes, ...(patch.attributes ?? {}) } },
    },
  }));
  // Откат, если HA не выполнил команду.
  return () => useHa.setState((s) => ({ entities: { ...s.entities, [entityId]: cur } }));
}
