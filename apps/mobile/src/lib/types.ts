/**
 * Типы ответов API Titan HUB, которые использует приложение.
 * Числовые колонки Postgres (numeric) приходят строками — такие поля помечены.
 */

import type { SessionUser } from './session';

export type SubscriptionState = 'active' | 'expiring' | 'grace' | 'expired' | 'suspended' | 'none' | 'unknown';

/** GET /api/club/context — публичный, без входа. */
export type ClubContext = {
  /** `null` на основном домене titanpos.ru (одно-клубный режим). */
  club: { slug: string; name: string } | null;
  subscription: {
    state: SubscriptionState;
    blocked: boolean;
    paidUntil: string | null;
    graceUntil: string | null;
    daysLeft: number | null;
  } | null;
  /** Флаги модулей клуба; нет ключа — модуль доступен. */
  modules: Record<string, boolean>;
};

/** POST /api/auth/login/pin и /api/auth/login/password. */
export type LoginResponse = {
  token: string;
  user: SessionUser;
  needsPinSetup?: boolean;
  hasPasskey?: boolean;
};

export type Role = 'owner' | 'staff' | 'client' | 'tablet' | string;

/** GET /api/auth/me — профиль текущего пользователя. */
export type Me = {
  id: string;
  nickname: string;
  role: Role;
  photoUrl: string | null;
  /** Права сотрудника; `false` у ключа скрывает раздел. `null` — права не настраивались. */
  permissions: Record<string, boolean> | null;
  fullName?: string | null;
  phone?: string | null;
  /** 'YYYY-MM-DD' — по нему начисляется подарок на день рождения. */
  birthday?: string | null;
  tgUsername?: string | null;
  needsPinSetup?: boolean;
};

/* ─────────────────────────── Касса ─────────────────────────── */

/** numeric-колонка Postgres, приходит строкой: "1500.00". */
export type NumericString = string;

export type CheckStatus = 'open' | 'closed' | 'cancelled';
export type PaymentMethod = 'cash' | 'card' | 'transfer' | 'bonus' | 'deposit' | 'debt' | 'split' | 'certificate';

/** Строка таблицы checks. */
export type CheckRow = {
  id: string;
  playerId: string | null;
  staffId: string;
  shiftId: string;
  status: CheckStatus;
  /** Позиции + модификаторы − скидки. БЕЗ аренды и базы мероприятия. */
  totalAmount: NumericString;
  paymentMethod: PaymentMethod | null;
  bonusUsed: NumericString | null;
  discountTotal: NumericString | null;
  staffCompId: string | null;
  spaceId: string | null;
  spaceStartAt: string | null;
  /** `null` — аренда идёт, счётчик живой. */
  spaceEndAt: string | null;
  guestNames: string[] | null;
  note: string | null;
  linkedEventId: string | null;
  eventBaseAmount: NumericString | null;
  prepaidAmount: NumericString;
  tipAmount: NumericString;
  createdAt: string;
  closedAt: string | null;
};

/** GET /api/pos/checks → { checks } — открытые чеки текущей смены, новые сверху. */
export type CheckListItem = CheckRow & {
  /** Число строк позиций (не сумма количеств). */
  itemCount: number;
  /** До 5 строк по алфавиту: «Имя» или «Имя ×N». */
  items: string[];
  guestName: string | null;
  guestPhotoUrl: string | null;
  spaceName: string | null;
  spaceHourlyRate: NumericString | null;
  hasRental: boolean;
};

export type CheckItemRow = { id: string; checkId: string; itemId: string; quantity: number; priceAtTime: NumericString };

export type CheckDiscountRow = {
  id: string;
  checkId: string;
  /** `null` — ручная скидка, иначе автоматическая или по статусу. */
  discountId: string | null;
  name: string;
  type: 'percent' | 'fixed';
  value: NumericString;
  amount: NumericString;
  target: 'check' | 'item';
  itemId: string | null;
};

export type PendingOrder = {
  id: string;
  checkId: string;
  spaceId: string | null;
  status: 'pending';
  items: { itemId: string; name: string; quantity: number; price: NumericString }[];
  createdAt: string;
};

/** GET /api/pos/checks/:id → { check } */
export type CheckDetail = CheckRow & {
  items: {
    checkItem: CheckItemRow;
    item: { id: string; name: string; price: NumericString; imageUrl: string | null } | null;
    modifiers: { id: string; modifierId: string; priceAtTime: NumericString }[];
  }[];
  payments: { id: string; method: PaymentMethod; amount: NumericString }[];
  discounts: CheckDiscountRow[];
  /** Снятые с чека авто- и тировые скидки — их можно вернуть. */
  excludedDiscounts: { id: string; name: string; type: 'percent' | 'fixed'; value: NumericString }[];
  spaceHourlyRate: NumericString | null;
  guestName: string | null;
  pendingOrders: PendingOrder[];
};

/** GET /api/shifts/current → { shift } */
export type Shift = {
  id: string;
  openedBy: string;
  status: 'open' | 'closed';
  cashStart: NumericString;
  cashEnd: NumericString | null;
  eveningType: string;
  note: string | null;
  openedAt: string;
  closedAt: string | null;
};

export type ShiftForecastPerCheck = {
  checkId: string;
  name: string;
  isResident: boolean;
  /** totalAmount + база мероприятия, без аренды. */
  current: number;
  projected: number;
  avgSpend: number | null;
  samples: number;
  weekdayBased: boolean;
};

/** GET /api/pos/shift-summary — без открытой смены приходит только `{ shift: null }`. */
export type ShiftWorker = { id: string; nickname: string; photoUrl: string | null };

export type ShiftSummary =
  | { shift: null }
  | {
      shift: { id: string; openedAt: string; eveningType: string };
      /** Кто работает на смене (получат зарплату за неё). */
      staff?: ShiftWorker[];
      /** total — без аренды. */
      openChecks: { count: number; total: number };
      cashInRegister: number;
      taiEnabled: boolean;
      forecast: {
        amount: number;
        currentTotal: number;
        additional: number;
        perCheck: ShiftForecastPerCheck[];
      } | null;
    };

/* ─────────────────────────── Уведомления ─────────────────────────── */

export type AppNotification = {
  id: string;
  type: string;
  title: string;
  body: string;
  meta: { url?: string; count?: number; checkId?: string; spaceId?: string; [k: string]: unknown } | null;
  isRead: boolean;
  createdAt: string;
};
