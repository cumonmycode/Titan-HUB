// Нативное соединение с Home Assistant (Kotlin, android/…/titanha): его держит
// foreground-сервис HaService, экран только читает состояние и шлёт команды.
// Изменения приходят точечно: статус связи и изменившиеся устройства (склейка за 100 мс).
import { requireOptionalNativeModule } from 'expo';

type Subscription = { remove: () => void };

interface NativeHa {
  getSnapshot(): string;
  configure(url: string, token: string, entityIds: string[]): void;
  stop(): void;
  reconnect(): void;
  /** Пока связь переподнимается, команда ждёт в очереди до 10 с. */
  callService(domain: string, service: string, entityId: string, dataJson: string): Promise<void>;
  getStates(): Promise<string>;
  /** Последний рабочий режим кондиционера (хранится на планшете). */
  lastMode(entityId: string): string | null;
  addListener(event: 'onStatus', listener: (e: { status: string; error: string | null }) => void): Subscription;
  addListener(event: 'onEntities', listener: (e: { json: string }) => void): Subscription;
}

export const NativeHomeAssistant = requireOptionalNativeModule<NativeHa>('TitanHa');
