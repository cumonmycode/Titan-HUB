import { useQuery } from '@tanstack/react-query';
import * as SecureStore from 'expo-secure-store';
import { useEffect } from 'react';
import type { SFSymbol } from 'sf-symbols-typescript';
import { create } from 'zustand';

import { api } from './api';
import { plural } from './format';
import { probeHa } from './home-assistant';
import { queryClient } from './query';
import { useClubKey } from './queries';
import { useSession } from './session';

/**
 * Умный дом клуба для HUB: помещения (коридор, кабинки, зал, туалет) с выбранными
 * устройствами Home Assistant и подключение к нему — сервер `/api/smart-home`.
 *
 * Свет и кондиционеры переключаются в шторке на главной кассы; телефон ходит в Home
 * Assistant сам, по Wi‑Fi клуба (lib/home-assistant.ts). У HUB свой долгосрочный токен,
 * не тот, что у планшетов Titan Home.
 *
 * Кэш запросов пишется на диск (lib/query.ts), поэтому токен в него НЕ попадает: он
 * лежит в Keychain / Keystore (expo-secure-store). Помещения и адрес остаются в кэше —
 * если в клубе пропал интернет, а Wi‑Fi работает, свет всё равно переключается.
 */

export type ZoneDevice = { entityId: string; name: string };
export type Zone = { id: string; name: string; lights: ZoneDevice[]; climates: ZoneDevice[] };
export type DeviceKind = 'light' | 'climate';

type SmartHomeResponse = {
  url: string | null;
  /** Откуда адрес: свой у HUB или тот же, что у планшетов Titan Home. */
  urlSource: 'hub' | 'tablet' | null;
  token: string | null;
  zones: Zone[];
  /** false — владелец ещё не сохранял помещения, сервер отдал стандартный набор. */
  zonesSaved: boolean;
};

export type SmartHomeConfig = Omit<SmartHomeResponse, 'token'> & { hasToken: boolean };

export const MAX_DEVICE_NAME = 40;

/* ─────────────────────────── Токен в Keychain ─────────────────────────── */

const tokenKey = (host: string) => `titan.ha.${host.replace(/[^A-Za-z0-9._-]/g, '_')}`;

/** Токены по клубам: undefined — ещё не читали с диска, null — токена нет. */
const useTokens = create<{ byHost: Record<string, string | null | undefined> }>()(() => ({ byHost: {} }));

async function rememberToken(host: string, token: string | null) {
  useTokens.setState((s) => ({ byHost: { ...s.byHost, [host]: token } }));
  try {
    if (token) await SecureStore.setItemAsync(tokenKey(host), token);
    else await SecureStore.deleteItemAsync(tokenKey(host));
  } catch {
    // Keychain недоступен (устройство заблокировано) — токен живёт в памяти до перезапуска.
  }
}

async function loadToken(host: string) {
  if (useTokens.getState().byHost[host] !== undefined) return;
  const token = await SecureStore.getItemAsync(tokenKey(host)).catch(() => null);
  // Пока читали диск, мог прийти свежий ответ сервера — он главнее.
  if (useTokens.getState().byHost[host] === undefined) {
    useTokens.setState((s) => ({ byHost: { ...s.byHost, [host]: token } }));
  }
}

/** Токен Home Assistant для HUB этого клуба (с диска — сразу, ещё до ответа сервера). */
export function useSmartHomeToken(): string | null {
  const host = useClubKey();
  const token = useTokens((s) => s.byHost[host]);
  useEffect(() => {
    void loadToken(host);
  }, [host]);
  return token ?? null;
}

/* ─────────────────────────── Настройки с сервера ─────────────────────────── */

const host = () => useSession.getState().club?.host ?? 'none';

export function useSmartHome(enabled = true) {
  const club = useClubKey();
  return useQuery({
    queryKey: [club, 'smart-home'],
    queryFn: async (): Promise<SmartHomeConfig> => {
      const { token, ...rest } = await api.get<SmartHomeResponse>('/smart-home');
      await rememberToken(club, token);
      return { ...rest, hasToken: !!token };
    },
    enabled,
    staleTime: 5 * 60_000,
  });
}

const refresh = () => queryClient.invalidateQueries({ queryKey: [host(), 'smart-home'] });

/** Адрес и (если задан) новый токен. Только владелец. */
export async function saveHaConnection(input: { url: string; token?: string }): Promise<void> {
  await api.put('/smart-home/connection', input);
  if (input.token) await rememberToken(host(), input.token);
  await refresh();
}

/** Отключить HUB от Home Assistant: шторка на кассе пропадёт у всех. */
export async function removeHaConnection(): Promise<void> {
  await api.delete('/smart-home/connection');
  await rememberToken(host(), null);
  await refresh();
}

/** Список помещений целиком: порядок — как в шторке. Показываем сразу, откат при ошибке. */
export async function saveZones(zones: Zone[]): Promise<void> {
  const key = [host(), 'smart-home'];
  const previous = queryClient.getQueryData<SmartHomeConfig>(key);
  if (previous) queryClient.setQueryData<SmartHomeConfig>(key, { ...previous, zones, zonesSaved: true });
  try {
    await api.put('/smart-home/zones', { zones });
  } catch (error) {
    if (previous) queryClient.setQueryData(key, previous);
    throw error;
  }
  await refresh();
}

/**
 * Устройства Home Assistant для выбора в помещения — телефон спрашивает их у HA сам
 * (заодно это проверка адреса и токена). Ключ отдельный от настроек: сохранение
 * помещений не должно каждый раз заново опрашивать Home Assistant.
 */
export function useHaDevices(url: string | null, token: string | null) {
  const club = useClubKey();
  return useQuery({
    queryKey: [club, 'ha-devices', url],
    queryFn: () => probeHa(url ?? '', token ?? ''),
    enabled: !!url && !!token,
    staleTime: 60_000,
    retry: false,
  });
}

export const refreshHaDevices = () => queryClient.invalidateQueries({ queryKey: [host(), 'ha-devices'] });

/* ─────────────────────────── Помещения ─────────────────────────── */

export const zoneDevices = (zone: Zone): ZoneDevice[] => [...zone.lights, ...zone.climates];

export const zoneEntityIds = (zones: Zone[]): string[] =>
  [...new Set(zones.flatMap((zone) => zoneDevices(zone).map((device) => device.entityId)))].sort();

/** Короткая подпись устройств помещения: «2 лампы · кондиционер». */
export function zoneSummary(zone: Zone): string {
  const parts: string[] = [];
  const lights = zone.lights.length;
  const climates = zone.climates.length;
  if (lights) parts.push(lights === 1 ? 'свет' : `${lights} ${plural(lights, ['лампа', 'лампы', 'ламп'])}`);
  if (climates) parts.push(climates === 1 ? 'кондиционер' : `${climates} ${plural(climates, ['кондиционер', 'кондиционера', 'кондиционеров'])}`);
  return parts.length ? parts.join(' · ') : 'нет устройств';
}

/** Значок помещения — по названию, чтобы не заставлять выбирать его вручную. */
export function zoneSymbol(name: string): SFSymbol {
  const n = name.toLowerCase();
  if (/корид|холл|вход|прихож|лестн/.test(n)) return 'door.left.hand.open';
  if (/кабин|vip|вип|комнат/.test(n)) return 'sofa';
  if (/туал|уборн|санузел|с\/у|wc/.test(n)) return 'toilet';
  if (/кухн|бар/.test(n)) return 'wineglass';
  if (/улиц|террас|веранд|двор/.test(n)) return 'tree';
  if (/зал|сцен/.test(n)) return 'person.3';
  return 'house';
}

export function newZoneId(): string {
  return `z${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/** «192.168.1.50» → «http://192.168.1.50:8123»; https-адреса — как есть. */
export function normalizeHaUrl(input: string): string | null {
  let raw = input.trim().replace(/\/+$/, '');
  if (!raw) return null;
  if (!/^https?:\/\//i.test(raw)) raw = `http://${raw}`;
  const match = /^(https?):\/\/([^/:?#\s]+)(:\d+)?(\/[^\s?#]*)?$/i.exec(raw);
  if (!match) return null;
  const [, scheme, hostname, port, path] = match;
  const lower = scheme.toLowerCase();
  return `${lower}://${hostname}${port ?? (lower === 'http' ? ':8123' : '')}${path ?? ''}`;
}
