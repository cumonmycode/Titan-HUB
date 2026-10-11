import * as Network from 'expo-network';
import Storage from 'expo-sqlite/kv-store';
import { AppState, type AppStateStatus } from 'react-native';
import { create } from 'zustand';

/**
 * Связь HUB с Home Assistant клуба — WebSocket API HA, напрямую по Wi‑Fi клуба
 * (сервер Titan в локальную сеть не ходит). Тот же протокол, что у нативного клиента
 * планшетов Titan Home (apps/home/modules/titan-ha), но в JS: HUB живёт и на iOS.
 *
 * - Состояния выбранных устройств — подписка `subscribe_entities` (сжатый формат:
 *   `a` — полные состояния, `c` — изменения, `r` — удалённые).
 * - Обрыв — переподключение с паузой 1→30 с; появилась сеть или приложение вернулось
 *   на экран — сразу. «Зависшее» соединение ловит пинг HA раз в 30 с.
 * - В фоне соединение закрываем: iOS всё равно усыпит сокет, а батарея важнее.
 * - Неверный токен — без повторов, статус «нет доступа».
 * - Команда во время переподключения ждёт в очереди до 10 с, а не падает сразу.
 */

export type HaEntity = { entity_id: string; state: string; attributes: Record<string, unknown> };
export type HaStatus = 'idle' | 'connecting' | 'connected' | 'auth_failed' | 'offline';

type HaStore = {
  status: HaStatus;
  error: string | null;
  entities: Record<string, HaEntity>;
  /** Последняя не выполненная команда — шторка показывает её несколько секунд. */
  failure: string | null;
};

export const useHa = create<HaStore>()(() => ({ status: 'idle', error: null, entities: {}, failure: null }));

const COMMAND_TIMEOUT_MS = 10_000;
const CONNECT_TIMEOUT_MS = 10_000;
const PING_INTERVAL_MS = 30_000;
const PONG_TIMEOUT_MS = 10_000;
const RETRY_STEPS_MS = [1_000, 2_000, 5_000, 10_000, 20_000, 30_000];
const NO_LINK = 'Нет связи с Home Assistant';

type Config = { url: string; token: string; entityIds: string[] };
type Timer = ReturnType<typeof setTimeout>;
type Waiter = { resolve: (result: unknown) => void; reject: (error: Error) => void; timer: Timer };
type Queued = Waiter & { payload: Record<string, unknown> };

type CompressedState = { s?: string; a?: Record<string, unknown> };
type CompressedEvent = {
  a?: Record<string, CompressedState>;
  c?: Record<string, { '+'?: CompressedState; '-'?: { a?: string[] } }>;
  r?: string[];
};
type HaMessage = {
  type?: string;
  id?: number;
  success?: boolean;
  result?: unknown;
  error?: { message?: string };
  event?: CompressedEvent;
  ha_version?: string;
};

/** http://host:8123 → ws://host:8123/api/websocket (https → wss). */
export function wsUrl(url: string): string {
  const base = url.trim().replace(/\/+$/, '');
  if (/^https:\/\//i.test(base)) return `wss://${base.slice(8)}/api/websocket`;
  if (/^http:\/\//i.test(base)) return `ws://${base.slice(7)}/api/websocket`;
  return `ws://${base}/api/websocket`;
}

function parse(text: string): HaMessage | null {
  try {
    const msg = JSON.parse(text) as unknown;
    return msg && typeof msg === 'object' ? (msg as HaMessage) : null;
  } catch {
    return null;
  }
}

const sameConfig = (a: Config | null, b: Config) =>
  !!a && a.url === b.url && a.token === b.token && a.entityIds.join(',') === b.entityIds.join(',');

/* ─────────────────────────── Последний режим кондиционера ─────────────────────────── */

const MODE_KEY = 'ha.mode.';
const lastModes = new Map<string, string>();
const isWorkingMode = (state: string) => !['off', 'unavailable', 'unknown', ''].includes(state);

function rememberMode(entityId: string, state: string) {
  if (!entityId.startsWith('climate.') || !isWorkingMode(state) || lastModes.get(entityId) === state) return;
  lastModes.set(entityId, state);
  try {
    Storage.setItemSync(MODE_KEY + entityId, state);
  } catch {
    // Не записали — «включить» вернёт первый режим из списка, ничего страшного.
  }
}

/** Режим, в котором кондиционер работал последним, — «включить» вернёт его, а не «Авто». */
export function haLastMode(entityId: string): string | null {
  const cached = lastModes.get(entityId);
  if (cached) return cached;
  try {
    return Storage.getItemSync(MODE_KEY + entityId);
  } catch {
    return null;
  }
}

/* ─────────────────────────── Соединение ─────────────────────────── */

class HaConnection {
  private config: Config | null = null;
  private socket: WebSocket | null = null;
  /** Номер соединения: события уже закрытых сокетов игнорируем. */
  private generation = 0;
  private seq = 1;
  private subscriptionId = -1;
  private retry = 0;
  /** «inactive» (Пункт управления, входящий звонок) — не повод рвать связь, только фон. */
  private active = AppState.currentState !== 'background';
  private pending = new Map<number, Waiter>();
  private queue: Queued[] = [];
  private reconnectTimer: Timer | null = null;
  private connectTimer: Timer | null = null;
  private pingTimer: Timer | null = null;
  private pongTimer: Timer | null = null;

  constructor() {
    AppState.addEventListener('change', (state) => this.onAppState(state));
    Network.addNetworkStateListener((state) => {
      if (state.isConnected && useHa.getState().status === 'offline') this.reconnectNow();
    });
  }

  configure(next: Config) {
    if (sameConfig(this.config, next)) {
      if (useHa.getState().status === 'offline') this.reconnectNow();
      return;
    }
    const sameServer = this.config?.url === next.url && this.config?.token === next.token;
    this.config = next;
    if (!sameServer) useHa.setState({ entities: {} });
    this.retry = 0;
    this.reconnect();
  }

  stop() {
    this.config = null;
    this.clearReconnect();
    this.closeSocket();
    this.failQueue('Умный дом отключён');
    useHa.setState({ status: 'idle', error: null, entities: {} });
  }

  /** Сеть вернулась, приложение снова на экране или человек нажал «Повторить». */
  reconnectNow() {
    if (!this.config || !this.active || useHa.getState().status === 'connected') return;
    this.retry = 0;
    this.reconnect();
  }

  request(payload: Record<string, unknown>, timeoutMs = COMMAND_TIMEOUT_MS): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.config) {
        reject(new Error('Умный дом не настроен'));
        return;
      }
      if (this.socket && useHa.getState().status === 'connected') {
        this.dispatch(payload, timeoutMs, resolve, reject);
        return;
      }
      const queued: Queued = {
        payload,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.queue = this.queue.filter((q) => q !== queued);
          reject(new Error(NO_LINK));
        }, timeoutMs),
      };
      this.queue = [...this.queue, queued];
      if (useHa.getState().status === 'offline') this.reconnectNow();
    });
  }

  private dispatch(payload: Record<string, unknown>, timeoutMs: number, resolve: Waiter['resolve'], reject: Waiter['reject']) {
    const id = this.seq++;
    const timer = setTimeout(() => {
      if (this.pending.delete(id)) reject(new Error('Home Assistant не ответил'));
    }, timeoutMs);
    this.pending.set(id, { resolve, reject, timer });
    this.send({ ...payload, id });
  }

  private onAppState(state: AppStateStatus) {
    const active = state !== 'background';
    if (active === this.active) return;
    this.active = active;
    if (!this.config) return;
    if (active) {
      this.retry = 0;
      this.reconnect();
    } else {
      this.clearReconnect();
      this.closeSocket();
      useHa.setState({ status: 'offline', error: null });
    }
  }

  private reconnect() {
    this.clearReconnect();
    this.closeSocket();
    this.open();
  }

  private open() {
    const config = this.config;
    if (!config || !this.active) return;
    const generation = ++this.generation;
    this.setStatus('connecting', null);
    let socket: WebSocket;
    try {
      socket = new WebSocket(wsUrl(config.url));
    } catch {
      this.setStatus('offline', 'Неверный адрес Home Assistant');
      return;
    }
    this.socket = socket;
    // Адрес не отвечает (телефон не в Wi‑Fi клуба) — не ждём системный тайм-аут в минуту.
    this.connectTimer = setTimeout(() => {
      if (generation === this.generation && useHa.getState().status === 'connecting') socket.close();
    }, CONNECT_TIMEOUT_MS);
    socket.onmessage = (event) => {
      if (generation === this.generation) this.onMessage(String(event.data));
    };
    socket.onclose = () => {
      if (generation === this.generation) this.onDisconnected();
    };
  }

  private closeSocket() {
    this.generation++;
    const socket = this.socket;
    this.socket = null;
    this.subscriptionId = -1;
    this.stopTimers();
    try {
      socket?.close();
    } catch {
      // Сокет ещё не открылся — закрывать нечего.
    }
    this.failPending(NO_LINK);
  }

  private onDisconnected() {
    this.socket = null;
    this.subscriptionId = -1;
    this.stopTimers();
    this.failPending(NO_LINK);
    if (!this.config || !this.active || useHa.getState().status === 'auth_failed') return;
    this.setStatus('offline', NO_LINK);
    const delay = RETRY_STEPS_MS[Math.min(this.retry, RETRY_STEPS_MS.length - 1)];
    this.retry += 1;
    this.reconnectTimer = setTimeout(() => this.open(), delay);
  }

  private onMessage(text: string) {
    const msg = parse(text);
    if (!msg) return;
    switch (msg.type) {
      case 'auth_required':
        this.send({ type: 'auth', access_token: this.config?.token ?? '' });
        break;
      case 'auth_ok':
        this.retry = 0;
        if (this.connectTimer) clearTimeout(this.connectTimer);
        this.setStatus('connected', null);
        this.subscribe();
        this.schedulePing();
        this.flushQueue();
        break;
      case 'auth_invalid':
        this.setStatus('auth_failed', 'Home Assistant не принял токен');
        this.closeSocket();
        this.failQueue('Home Assistant не принял токен');
        break;
      case 'result':
        this.onResult(msg);
        break;
      case 'event':
        if (msg.id === this.subscriptionId && msg.event) this.applyEntities(msg.event);
        break;
      case 'pong':
        if (this.pongTimer) clearTimeout(this.pongTimer);
        break;
    }
  }

  private onResult(msg: HaMessage) {
    if (typeof msg.id !== 'number') return;
    const waiter = this.pending.get(msg.id);
    if (!waiter) return;
    this.pending.delete(msg.id);
    clearTimeout(waiter.timer);
    if (msg.success) waiter.resolve(msg.result ?? null);
    // Тексты ошибок HA — английские («Entity not found»): показываем их как пояснение.
    else waiter.reject(new Error(msg.error?.message ? `Home Assistant отклонил команду: ${msg.error.message}` : 'Home Assistant отклонил команду'));
  }

  private subscribe() {
    const ids = this.config?.entityIds ?? [];
    if (!ids.length) return;
    this.subscriptionId = this.seq++;
    this.send({ id: this.subscriptionId, type: 'subscribe_entities', entity_ids: ids });
  }

  private applyEntities(event: CompressedEvent) {
    const entities = { ...useHa.getState().entities };
    for (const [id, s] of Object.entries(event.a ?? {})) {
      entities[id] = { entity_id: id, state: s.s ?? 'unknown', attributes: s.a ?? {} };
      rememberMode(id, entities[id].state);
    }
    for (const [id, diff] of Object.entries(event.c ?? {})) {
      const current = entities[id];
      if (!current) continue;
      const attributes = { ...current.attributes, ...(diff['+']?.a ?? {}) };
      for (const key of diff['-']?.a ?? []) delete attributes[key];
      entities[id] = { ...current, state: diff['+']?.s ?? current.state, attributes };
      rememberMode(id, entities[id].state);
    }
    for (const id of event.r ?? []) delete entities[id];
    useHa.setState({ entities });
  }

  private flushQueue() {
    const queued = this.queue;
    this.queue = [];
    for (const q of queued) {
      clearTimeout(q.timer);
      this.dispatch(q.payload, COMMAND_TIMEOUT_MS, q.resolve, q.reject);
    }
  }

  private failQueue(message: string) {
    const queued = this.queue;
    this.queue = [];
    for (const q of queued) {
      clearTimeout(q.timer);
      q.reject(new Error(message));
    }
  }

  private failPending(message: string) {
    const pending = [...this.pending.values()];
    this.pending.clear();
    for (const p of pending) {
      clearTimeout(p.timer);
      p.reject(new Error(message));
    }
  }

  private schedulePing() {
    this.pingTimer = setTimeout(() => {
      if (!this.socket || useHa.getState().status !== 'connected') return;
      this.send({ id: this.seq++, type: 'ping' });
      this.pongTimer = setTimeout(() => this.socket?.close(), PONG_TIMEOUT_MS);
      this.schedulePing();
    }, PING_INTERVAL_MS);
  }

  private stopTimers() {
    for (const timer of [this.connectTimer, this.pingTimer, this.pongTimer]) if (timer) clearTimeout(timer);
    this.connectTimer = null;
    this.pingTimer = null;
    this.pongTimer = null;
  }

  private clearReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private send(payload: Record<string, unknown>) {
    try {
      this.socket?.send(JSON.stringify(payload));
    } catch {
      // Сокет закрылся между проверкой и отправкой — команда упадёт по тайм-ауту.
    }
  }

  private setStatus(status: HaStatus, error: string | null) {
    const current = useHa.getState();
    if (current.status !== status || current.error !== error) useHa.setState({ status, error });
  }
}

let connection: HaConnection | null = null;
const shared = () => (connection ??= new HaConnection());

/** Подключиться (повтор с той же конфигурацией ничего не рвёт). */
export function connectHa(config: Config) {
  shared().configure(config);
}

/** Шторку убрали (HA отключили в настройках, вышли из клуба) — закрываем связь. */
export function disconnectHa() {
  connection?.stop();
}

export function reconnectHa() {
  connection?.reconnectNow();
}

export function haCall(domain: string, service: string, entityId: string, data: Record<string, unknown> = {}): Promise<unknown> {
  return shared().request({ type: 'call_service', domain, service, target: { entity_id: entityId }, service_data: data });
}

/* ─────────────────────────── Проверка и список устройств ─────────────────────────── */

export type HaDevice = { entityId: string; domain: string; name: string; state: string; area: string | null };
export type HaProbe = { version: string | null; devices: HaDevice[] };

/** Что умеет показать шторка: свет (лампы, группы, реле) и кондиционеры. */
const PICKABLE = new Set(['light', 'switch', 'input_boolean', 'climate']);

type RegistryEntity = { entity_id: string; area_id?: string | null; device_id?: string | null; entity_category?: string | null; disabled_by?: string | null };
type RegistryDevice = { id: string; area_id?: string | null };
type RegistryArea = { area_id: string; name: string };

function listOf<T>(msg: HaMessage | undefined): T[] {
  return msg?.success && Array.isArray(msg.result) ? (msg.result as T[]) : [];
}

/**
 * Отдельное короткое подключение: проверить адрес и токен и получить устройства для
 * выбора в помещения. Помещения Home Assistant (areas) — если пользователь HA может их
 * читать; служебные сущности (настройки и диагностика устройств) в выбор не попадают.
 */
export function probeHa(url: string, token: string, timeoutMs = 9_000): Promise<HaProbe> {
  return new Promise((resolve, reject) => {
    let socket: WebSocket | null = null;
    let version: string | null = null;
    let seq = 1;
    let done = false;
    const waiters = new Map<number, (msg: HaMessage) => void>();

    const finish = (error: Error | null, value?: HaProbe) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        socket?.close();
      } catch {
        // уже закрыт
      }
      if (error) reject(error);
      else if (value) resolve(value);
    };
    const timer = setTimeout(
      () => finish(new Error('Home Assistant не ответил. Проверьте адрес и что телефон в Wi‑Fi клуба.')),
      timeoutMs,
    );

    const call = (payload: Record<string, unknown>) =>
      new Promise<HaMessage>((answer) => {
        const id = seq++;
        waiters.set(id, answer);
        socket?.send(JSON.stringify({ ...payload, id }));
      });

    const collect = async () => {
      const [states, areas, entities, devices] = await Promise.all([
        call({ type: 'get_states' }),
        call({ type: 'config/area_registry/list' }),
        call({ type: 'config/entity_registry/list' }),
        call({ type: 'config/device_registry/list' }),
      ]);
      if (!states.success || !Array.isArray(states.result)) {
        finish(new Error(states.error?.message || 'Home Assistant не отдал список устройств'));
        return;
      }
      const areaName = new Map(listOf<RegistryArea>(areas).map((a) => [a.area_id, a.name]));
      const deviceArea = new Map(listOf<RegistryDevice>(devices).map((d) => [d.id, d.area_id ?? null]));
      const registry = new Map(listOf<RegistryEntity>(entities).map((e) => [e.entity_id, e]));
      const list: HaDevice[] = [];
      for (const raw of states.result as HaEntity[]) {
        const domain = raw.entity_id.split('.')[0];
        if (!PICKABLE.has(domain)) continue;
        const entry = registry.get(raw.entity_id);
        if (entry?.entity_category || entry?.disabled_by) continue;
        const areaId = entry?.area_id ?? (entry?.device_id ? deviceArea.get(entry.device_id) : null) ?? null;
        const friendly = raw.attributes?.friendly_name;
        list.push({
          entityId: raw.entity_id,
          domain,
          name: typeof friendly === 'string' && friendly.trim() ? friendly.trim() : raw.entity_id,
          state: raw.state,
          area: areaId ? (areaName.get(areaId) ?? null) : null,
        });
      }
      list.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
      finish(null, { version, devices: list });
    };

    try {
      socket = new WebSocket(wsUrl(url));
    } catch {
      finish(new Error('Неверный адрес Home Assistant'));
      return;
    }
    socket.onmessage = (event) => {
      const msg = parse(String(event.data));
      if (!msg) return;
      if (msg.type === 'auth_required') {
        version = msg.ha_version ?? null;
        socket?.send(JSON.stringify({ type: 'auth', access_token: token }));
      } else if (msg.type === 'auth_invalid') {
        finish(new Error('Home Assistant не принял токен. Проверьте, что он скопирован целиком.'));
      } else if (msg.type === 'auth_ok') {
        void collect().catch((error: unknown) => finish(error instanceof Error ? error : new Error(String(error))));
      } else if (msg.type === 'result' && typeof msg.id === 'number') {
        waiters.get(msg.id)?.(msg);
        waiters.delete(msg.id);
      }
    };
    socket.onclose = () =>
      finish(new Error('Не удалось подключиться. Телефон должен быть в той же Wi‑Fi сети, что и Home Assistant, а адрес — открываться в браузере.'));
  });
}
