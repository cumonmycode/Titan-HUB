import { ScreenCapture } from '../../modules/titan-screen-capture';

/**
 * Идёт ли показ экрана (FaceTime, запись, AirPlay, дублирование). Значение хранится здесь:
 * обработчик AppState читает его сразу, а нативный модуль шлёт изменения событием.
 * На Android модуля нет — значение всегда false, да и состояния «inactive» там не бывает.
 */
let captured = false;
const listeners = new Set<(captured: boolean) => void>();

ScreenCapture?.addListener('onChange', (event) => {
  captured = event.captured;
  listeners.forEach((listener) => listener(captured));
});

export function isScreenCaptured(): boolean {
  return captured;
}

export function subscribeScreenCapture(listener: (captured: boolean) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
