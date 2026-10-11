// Размер экрана для раскладки. После поворота Android присылает в JS новые
// размеры окна (useWindowDimensions) с опозданием до 6 секунд, а разметка
// корневого вида приходит сразу — поэтому размер берём из неё (onLayout корня
// в _layout.tsx), а событие Dimensions остаётся запасным.
import { useSyncExternalStore } from 'react';
import { Dimensions } from 'react-native';

export interface ScreenSize {
  width: number;
  height: number;
}

const initial = Dimensions.get('window');
let screen: ScreenSize = { width: initial.width, height: initial.height };
const listeners = new Set<() => void>();

/** Новый размер корневого вида (dp). Тот же размер — без перерисовки. Без
 *  округления: сетка меню делит ширину точно, лишние 0,3 dp переносят плитку. */
export function setScreenSize(width: number, height: number) {
  if (!width || !height || (Math.abs(width - screen.width) < 0.01 && Math.abs(height - screen.height) < 0.01)) return;
  screen = { width, height };
  listeners.forEach((l) => l());
}

Dimensions.addEventListener('change', ({ window }) => setScreenSize(window.width, window.height));

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

export const getScreenSize = () => screen;

/** Ширина и высота экрана в dp; обновляется сразу после поворота. */
export const useScreen = () => useSyncExternalStore(subscribe, getScreenSize);
