// Высота экранной клавиатуры. Киоск во весь экран (edge-to-edge, без строки
// состояния), и Android не сжимает окно под клавиатуру, хотя в манифесте стоит
// adjustResize: место под неё освобождаем сами. Одна подписка на всё приложение.
import { useSyncExternalStore } from 'react';
import { Keyboard } from 'react-native';

let height = 0;
const listeners = new Set<() => void>();

const set = (next: number) => {
  if (next === height) return;
  height = next;
  listeners.forEach((l) => l());
};

Keyboard.addListener('keyboardDidShow', (e) => set(Math.round(e.endCoordinates.height)));
Keyboard.addListener('keyboardDidHide', () => set(0));

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

/** Сколько dp снизу закрывает клавиатура; 0 — клавиатуры нет. */
export const useKeyboardHeight = () => useSyncExternalStore(subscribe, () => height);
