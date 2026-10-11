// Формы ответов API клуба для Titan Home 2.0 (apps/api/src/modules/tablet).

export interface BillLine { id: string; name: string; quantity: number; sum: number }

export interface PendingOrderView {
  id: string;
  createdAt: string;
  items: { name: string; quantity: number; sum: number }[];
}

export interface CheckView {
  id: string;
  openedAt: string;
  guestName: string | null;
  staffComp: boolean;
  items: BillLine[];
  itemsCount: number;
  pendingOrders: PendingOrderView[];
  rental: { startAt: string; running: boolean; minutes: number } | null;
  /** Суммы считает сервер — та же математика, что у кассы и QR. */
  totals: { items: number; discount: number; rental: number; event: number; total: number };
  unread: number;
}

export type PreviousOutcome = 'open' | 'closed' | 'cancelled' | 'moved' | 'gone';

/** Что стало с чеком, который планшет показывал до этого. */
export interface PreviousCheck { id: string; outcome: PreviousOutcome; paidTotal?: number }

export interface ClubEvent { id: string; title: string | null; startTime: string | null; endTime: string | null }

export interface TabletState {
  serverTime: string;
  space: { id: string; name: string };
  check: CheckView | null;
  previous: PreviousCheck | null;
  event: ClubEvent | null;
}

export interface MenuCategory { id: string; name: string }
export interface MenuItem { id: string; name: string; price: number; categoryId: string | null; isTop: boolean; tags: string[] }
export interface Menu { version: string; categories: MenuCategory[]; items: MenuItem[] }

export interface ChatMessage {
  id: string;
  sender: 'guest' | 'staff';
  text: string;
  createdAt: string;
  readAt: string | null;
}

export interface SmartDevice { entityId: string; name: string }
export interface SmartRoom { lights: SmartDevice[]; climate: SmartDevice | null }
export interface SmartHomeConfig { connection: { url: string; token: string } | null; room: SmartRoom }

/** Событие потока зоны (/tablet/stream). */
export type ZoneEvent =
  | { type: 'ready'; spaceId: string }
  | { type: 'zone'; event: string; checkId: string; status: string | null; sender: string | null };
