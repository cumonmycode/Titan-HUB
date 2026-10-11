// Нативный модуль киоска (Kotlin, android/…/TitanKioskModule.kt). Без него
// (Expo Go, веб) все вызовы — безопасные заглушки.
import { requireOptionalNativeModule } from 'expo';

export type LockTaskState = 'none' | 'locked' | 'pinned';
export type Orientation = 'landscape' | 'portrait' | 'auto';
export type SettingsKind = 'settings' | 'wifi' | 'home';

export interface KioskStatus {
  isDeviceOwner: boolean;
  lockTask: LockTaskState;
  isDefaultHome: boolean;
  model: string;
  androidVersion: string;
  sdk: number;
}

interface NativeKiosk {
  getStatus(): KioskStatus;
  startLockTask(): Promise<LockTaskState>;
  stopLockTask(): Promise<LockTaskState>;
  clearDeviceOwner(): Promise<boolean>;
  setImmersive(enabled: boolean): Promise<void>;
  setKeepScreenOn(enabled: boolean): Promise<void>;
  setOrientation(mode: Orientation): Promise<void>;
  openSettings(kind: SettingsKind): Promise<boolean>;
  reboot(): Promise<boolean>;
  setGestureExclusion(rects: number[][]): Promise<void>;
}

/** Прямоугольник в dp: [left, top, right, bottom]. */
export type DpRect = [number, number, number, number];

const native = requireOptionalNativeModule<NativeKiosk>('TitanKiosk');

const FALLBACK: KioskStatus = {
  isDeviceOwner: false, lockTask: 'none', isDefaultHome: false, model: '—', androidVersion: '—', sdk: 0,
};

export const Kiosk = {
  available: !!native,
  getStatus: (): KioskStatus => (native ? native.getStatus() : FALLBACK),
  startLockTask: async (): Promise<LockTaskState> => (native ? native.startLockTask() : 'none'),
  stopLockTask: async (): Promise<LockTaskState> => (native ? native.stopLockTask() : 'none'),
  clearDeviceOwner: async (): Promise<boolean> => (native ? native.clearDeviceOwner() : false),
  setImmersive: async (enabled: boolean) => native?.setImmersive(enabled),
  setKeepScreenOn: async (enabled: boolean) => native?.setKeepScreenOn(enabled),
  setOrientation: async (mode: Orientation) => native?.setOrientation(mode),
  openSettings: async (kind: SettingsKind): Promise<boolean> => (native ? native.openSettings(kind) : false),
  reboot: async (): Promise<boolean> => (native ? native.reboot() : false),
  /** Здесь жест «Назад» от края не перехватывает касание; [] — снять. */
  setGestureExclusion: async (rects: DpRect[]) => native?.setGestureExclusion?.(rects),
};
