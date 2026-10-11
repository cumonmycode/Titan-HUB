// Визит гостя + слои экрана. Слои (меню, администратор, оплата) и панель
// «Свет и климат» закрываются сами, когда визит сменился: гость не «застрянет»
// в меню после оплаты. Корзина живёт только внутри визита.
import { create } from 'zustand';

import type { CheckView, TabletState } from '@/data/types';
import { useCart } from '@/features/menu/cart';

import { IDLE, reduceVisit, samePhase, type Phase, type VisitEvent } from './machine';

export type GuestLayer = 'menu' | 'admin' | 'pay';

type VisitState = {
  phase: Phase;
  snapshot: TabletState | null;
  /** Когда состояние пришло с сервера (0 — пока только из кэша). */
  syncedAt: number;
  layer: GuestLayer | null;
  roomOpen: boolean;
  dispatch: (event: VisitEvent) => void;
  applyState: (state: TabletState, fromCache?: boolean) => void;
  reset: () => void;
  open: (layer: GuestLayer) => void;
  close: () => void;
  setRoom: (open: boolean) => void;
};

export const useVisit = create<VisitState>()((set, get) => {
  const transition = (event: VisitEvent) => {
    const cur = get().phase;
    const next = reduceVisit(cur, event);
    if (next === cur) return;
    if (samePhase(cur, next)) {
      set({ phase: next });
      return;
    }
    set({ phase: next, layer: null, roomOpen: next.kind === 'finish' ? false : get().roomOpen });
    if (next.kind !== 'session') useCart.getState().clear();
  };

  return {
    phase: IDLE,
    snapshot: null,
    syncedAt: 0,
    layer: null,
    roomOpen: false,
    dispatch: transition,
    applyState: (state, fromCache) => {
      set(fromCache ? { snapshot: state } : { snapshot: state, syncedAt: Date.now() });
      transition({ type: 'state', openCheckId: state.check?.id ?? null, previous: state.previous });
    },
    reset: () => {
      set({ snapshot: null, syncedAt: 0 });
      transition({ type: 'reset' });
    },
    open: (layer) => set({ layer, roomOpen: false }),
    close: () => set({ layer: null }),
    // Панель «Свет и климат» вытягивается поверх любого слоя (и меню) — слой не закрываем.
    setRoom: (roomOpen) => set({ roomOpen }),
  };
});

/** Счёт текущего визита — только если снимок именно о нём. */
export function useSessionCheck(): CheckView | null {
  return useVisit((s) => (s.phase.kind === 'session' && s.snapshot?.check?.id === s.phase.checkId ? s.snapshot.check : null));
}

export const sessionCheckId = (): string | null => {
  const { phase } = useVisit.getState();
  return phase.kind === 'session' ? phase.checkId : null;
};
