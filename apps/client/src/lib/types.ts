// Ответы сервера для клиентского приложения (apps/api: /api/resident/*, /api/auth/*).

export interface Collection {
  id: string;
  name: string;
  description: string | null;
  kind: 'recurring' | 'oneoff';
  isMandatory: boolean;
  period: { key: string; label: string };
  due: number;
  topUp: number;
  paid: boolean;
  prepaid: number;
  prepaidMonths: number;
  excluded: boolean;
  contribution: { amount: number; method: string; paidAt: string } | null;
}

export interface VisitProgress {
  tier: string;
  visits: number;
  threshold: number;
  remaining: number;
  isResident: boolean;
}

export interface Prefs {
  push: boolean;
  telegram: boolean;
  news: boolean;
  /** Push «Мы в эфире» о начале трансляции. Старый сервер поле не присылает — считаем включённым. */
  streams?: boolean;
}

export interface Wallet {
  profile: {
    id: string;
    nickname: string;
    fullName: string | null;
    phone: string | null;
    birthday: string | null;
    photoUrl: string | null;
    ownPhotoUrl: string | null;
    tgUsername: string | null;
    telegramLinked: boolean;
    memberSince: string;
  };
  tier: { key: string; label: string; color: string };
  balance: number;
  deposit: number;
  debt: number;
  bonus: number;
  bonusHidden: boolean;
  bonusRules: {
    enabled: boolean;
    accrualPercent: number;
    minPurchase: number;
    maxSpendPercent: number | null;
    expiryDays: number | null;
  };
  bonusExpiring: { amount: number; date: string } | null;
  visitProgress: VisitProgress;
  collections: Collection[];
  /** 'pending' — регистрация из приложения ждёт подтверждения клуба: без бонусов и оплаты. */
  registration?: 'pending' | null;
  pay: { online: boolean; surchargePercent: number };
  unreadNotifications: number;
  prefs: Prefs;
  club: { name: string };
}

export interface FeedItem {
  id: string;
  source: 'money' | 'bonus';
  type: string;
  title: string;
  amount: number;
  sign: 1 | -1;
  unit: 'rub' | 'bonus';
  checkId: string | null;
  createdAt: string;
}

export interface FeedPage {
  items: FeedItem[];
  nextCursor: string | null;
}

export type NotificationKind = 'bonus' | 'deposit' | 'debt' | 'payment' | 'tier' | 'fund' | 'news' | 'stream' | 'system';

export interface ClientNotification {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  meta: Record<string, unknown>;
  isRead: boolean;
  createdAt: string;
}

export interface NotificationsPage {
  items: ClientNotification[];
  nextCursor: string | null;
  unread: number;
}

export interface CheckDetail {
  check: { id: string; totalAmount: number; tipAmount?: number; createdAt: string; closedAt: string | null };
  items: { name: string; quantity: number; priceAtTime: number; lineTotal: number }[];
  payments: { method: string; amount: number }[];
  discounts: { name: string | null; amount: number }[];
}

export type PayPurpose = 'deposit' | 'debt' | 'fund';

export interface CreatedPayment {
  paymentId: string;
  paymentUrl: string;
  base: number;
  charged: number;
}

export type PaymentStatus = 'pending' | 'confirmed' | 'failed' | 'not_found';

/** Вид игрового вечера — как считает сервер (apps/api lib/clientAttendance.ts). */
export type EveningKey = 'city' | 'sport' | 'board' | 'other' | 'none';

/** GET /resident/evenings — на какие вечера ходит клиент. Визит — вечер с закрытым чеком. */
export interface Evenings {
  total: number;
  firstAt: string | null;
  lastAt: string | null;
  categories: { key: EveningKey; label: string; count: number; lastAt: string | null }[];
  /** Что было в «Других ивентах»: название мероприятия или тип вечера. */
  others: { label: string; count: number }[];
  /** Последние полгода по месяцам (YYYY-MM). */
  months: ({ month: string } & Record<EveningKey, number>)[];
}

export interface StreamLink {
  kind: 'watch' | 'donate';
  label: string;
  url: string;
}

/** GET /resident/stream — эфир клуба (если идёт) и постоянные площадки клуба. */
export interface StreamView {
  live: { id: string; title: string; startedAt: string; watch: StreamLink[]; donate: StreamLink[] } | null;
  channels: StreamLink[];
  donate: StreamLink[];
  lastEndedAt: string | null;
}

/** POST /auth/app/start — вход по номеру телефона. */
export type LoginMode = 'login' | 'register';

export type LoginStart =
  | { status: 'register' }
  | { status: 'pending'; mode: LoginMode; ticket: string; botUsername: string; deepLink: string; expiresAt: string };

/** Анкета нового клиента (POST /auth/app/start, поле register). */
export interface Registration {
  nickname: string;
  fullName: string;
  /** YYYY-MM-DD */
  birthday: string;
}

/** GET /auth/app/status — ждём подтверждения в Telegram. opened — бот уже открыт по ссылке. */
export type LoginStatus =
  | { status: 'pending'; opened: boolean }
  | { status: 'expired' }
  | { status: 'rejected'; note: string | null }
  | { status: 'ok'; token: string; user: { id: string; nickname: string; role: string; photoUrl: string | null } };
