// Демо-режим: приложение целиком работает на локальных данных, без сервера.
// Нужен для проверки в App Store / Google Play (вход только через Telegram-бота
// клуба — у проверяющего его нет), для скриншотов и знакомства с приложением.
// Оплата в демо проходит сама через пару секунд и меняет баланс.
import type {
  CheckDetail, ClientNotification, Collection, FeedItem, Wallet,
} from './types';

const DAY = 86_400_000;
const now = () => Date.now();
const iso = (msAgo: number) => new Date(now() - msAgo).toISOString();

function uid(prefix: string, n: number) {
  return `${prefix}-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

const fund: Collection = {
  id: uid('c0000001', 1),
  name: 'Фонд клуба',
  description: 'Ежемесячный взнос резидента: турниры, призы, обновление зала',
  kind: 'recurring',
  isMandatory: true,
  period: { key: '2026-09', label: 'Сентябрь 2026' },
  due: 1000,
  topUp: 1000,
  paid: false,
  prepaid: 0,
  prepaidMonths: 0,
  excluded: false,
  contribution: null,
};

const cup: Collection = {
  id: uid('c0000002', 2),
  name: 'Кубок Titan',
  description: 'Призовой фонд осеннего кубка',
  kind: 'oneoff',
  isMandatory: false,
  period: { key: 'single', label: 'Сбор' },
  due: 500,
  topUp: 0,
  paid: true,
  prepaid: 0,
  prepaidMonths: 0,
  excluded: false,
  contribution: { amount: 500, method: 'sbp', paidAt: iso(6 * DAY) },
};

function initialWallet(): Wallet {
  return {
    profile: {
      id: uid('d0000000', 0),
      nickname: 'Демо',
      fullName: 'Демо-клиент',
      phone: '+79990000000',
      birthday: '1995-10-12',
      photoUrl: null,
      ownPhotoUrl: null,
      tgUsername: 'titan_demo',
      telegramLinked: true,
      memberSince: iso(210 * DAY),
    },
    tier: { key: 'resident', label: 'Резидент', color: '#8B5CF6' },
    balance: 2400,
    deposit: 2400,
    debt: 0,
    bonus: 1240,
    bonusHidden: false,
    bonusRules: { enabled: true, accrualPercent: 5, minPurchase: 0, maxSpendPercent: 50, expiryDays: 90 },
    bonusExpiring: { amount: 180, date: new Date(now() + 9 * DAY).toISOString() },
    visitProgress: { tier: 'resident', visits: 27, threshold: 10, remaining: 0, isResident: true },
    collections: [fund, cup],
    pay: { online: true, surchargePercent: 8 },
    unreadNotifications: 2,
    prefs: { push: true, telegram: true, news: true },
    club: { name: 'Titan' },
  };
}

function initialFeed(): FeedItem[] {
  const rows: Omit<FeedItem, 'id'>[] = [
    { source: 'bonus', type: 'bonus_accrual', title: '5% начисление за чек', amount: 64, sign: 1, unit: 'bonus', checkId: null, createdAt: iso(2 * 3600_000) },
    { source: 'money', type: 'payment', title: 'Оплата чека', amount: 1280, sign: -1, unit: 'rub', checkId: uid('e0000001', 1), createdAt: iso(2 * 3600_000 + 60_000) },
    { source: 'money', type: 'deposit', title: 'Пополнение депозита онлайн', amount: 3000, sign: 1, unit: 'rub', checkId: null, createdAt: iso(1 * DAY + 5 * 3600_000) },
    { source: 'bonus', type: 'bonus_spend', title: 'Оплата бонусами', amount: 300, sign: -1, unit: 'bonus', checkId: null, createdAt: iso(3 * DAY) },
    { source: 'money', type: 'payment', title: 'Оплата чека', amount: 940, sign: -1, unit: 'rub', checkId: uid('e0000002', 2), createdAt: iso(3 * DAY + 60_000) },
    { source: 'bonus', type: 'bonus_accrual', title: '5% начисление за чек', amount: 47, sign: 1, unit: 'bonus', checkId: null, createdAt: iso(3 * DAY + 90_000) },
    { source: 'money', type: 'withdrawal', title: 'Взнос: Кубок Titan · Сбор', amount: 500, sign: -1, unit: 'rub', checkId: null, createdAt: iso(6 * DAY) },
    { source: 'bonus', type: 'bonus_accrual', title: 'Бонус ко дню рождения', amount: 500, sign: 1, unit: 'bonus', checkId: null, createdAt: iso(9 * DAY) },
    { source: 'money', type: 'payment', title: 'Оплата чека', amount: 1650, sign: -1, unit: 'rub', checkId: uid('e0000003', 3), createdAt: iso(10 * DAY) },
    { source: 'bonus', type: 'bonus_accrual', title: '5% начисление за чек', amount: 82, sign: 1, unit: 'bonus', checkId: null, createdAt: iso(10 * DAY + 60_000) },
    { source: 'money', type: 'deposit', title: 'Пополнение депозита', amount: 5000, sign: 1, unit: 'rub', checkId: null, createdAt: iso(14 * DAY) },
    { source: 'money', type: 'payment', title: 'Оплата чека', amount: 720, sign: -1, unit: 'rub', checkId: uid('e0000004', 4), createdAt: iso(17 * DAY) },
    { source: 'bonus', type: 'bonus_accrual', title: '5% начисление за чек', amount: 36, sign: 1, unit: 'bonus', checkId: null, createdAt: iso(17 * DAY + 60_000) },
    { source: 'money', type: 'refund', title: 'Возврат по чеку', amount: 250, sign: 1, unit: 'rub', checkId: null, createdAt: iso(21 * DAY) },
    { source: 'money', type: 'payment', title: 'Оплата чека', amount: 2100, sign: -1, unit: 'rub', checkId: uid('e0000005', 5), createdAt: iso(24 * DAY) },
    { source: 'bonus', type: 'bonus_accrual', title: '5% начисление за чек', amount: 105, sign: 1, unit: 'bonus', checkId: null, createdAt: iso(24 * DAY + 60_000) },
    { source: 'money', type: 'withdrawal', title: 'Взнос: Фонд клуба · Август 2026', amount: 1000, sign: -1, unit: 'rub', checkId: null, createdAt: iso(33 * DAY) },
  ];
  return rows.map((r, i) => ({ ...r, id: `${r.source === 'bonus' ? 'b' : 'm'}:${uid('f0000000', i)}` }));
}

function initialNotifications(): ClientNotification[] {
  return [
    { id: uid('a0000001', 1), kind: 'bonus', title: '+64 бонуса', body: 'Начислены за покупку на 1 280 ₽', meta: { screen: 'check', checkId: uid('e0000001', 1) }, isRead: false, createdAt: iso(2 * 3600_000) },
    { id: uid('a0000002', 2), kind: 'news', title: 'Турнир в субботу', body: 'Открыта запись на субботний турнир — начало в 19:00, призовой фонд 15 000 ₽.', meta: { screen: 'notifications' }, isRead: false, createdAt: iso(20 * 3600_000) },
    { id: uid('a0000003', 3), kind: 'payment', title: 'Депозит пополнен', body: '+3 000 ₽ · баланс 3 680 ₽', meta: { screen: 'history' }, isRead: true, createdAt: iso(1 * DAY + 5 * 3600_000) },
    { id: uid('a0000004', 4), kind: 'fund', title: 'Взнос за сентябрь', body: 'Фонд клуба: 1 000 ₽. Оплатить можно в приложении.', meta: { screen: 'pay', purpose: 'fund' }, isRead: true, createdAt: iso(4 * DAY) },
    { id: uid('a0000005', 5), kind: 'bonus', title: 'С днём рождения!', body: 'Дарим 500 бонусов — ждём вас в клубе.', meta: { screen: 'history' }, isRead: true, createdAt: iso(9 * DAY) },
    { id: uid('a0000006', 6), kind: 'tier', title: 'Вы — Резидент Titan!', body: 'Поздравляем с новым статусом — спасибо, что вы с нами.', meta: { screen: 'home' }, isRead: true, createdAt: iso(120 * DAY) },
  ];
}

const CHECK_ITEMS: Record<string, CheckDetail['items']> = {
  default: [
    { name: 'Резидент — вечер игры', quantity: 1, priceAtTime: 600, lineTotal: 600 },
    { name: 'Капучино', quantity: 2, priceAtTime: 220, lineTotal: 440 },
    { name: 'Чизкейк', quantity: 1, priceAtTime: 290, lineTotal: 290 },
  ],
};

let state = { wallet: initialWallet(), feed: initialFeed(), notifications: initialNotifications() };
const payments = new Map<string, { createdAt: number; purpose: string; amount: number; collectionId?: string; applied: boolean }>();
let paySeq = 0;

export function resetDemo() {
  state = { wallet: initialWallet(), feed: initialFeed(), notifications: initialNotifications() };
  payments.clear();
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function unread() {
  return state.notifications.filter((n) => !n.isRead).length;
}

function pushNotification(n: Omit<ClientNotification, 'id' | 'createdAt' | 'isRead'>) {
  state.notifications.unshift({ ...n, id: uid('a1000000', state.notifications.length + 10), createdAt: new Date().toISOString(), isRead: false });
}

function applyPayment(id: string) {
  const p = payments.get(id);
  if (!p || p.applied) return;
  p.applied = true;
  const w = state.wallet;
  if (p.purpose === 'fund') {
    const coll = w.collections.find((c) => c.id === p.collectionId) ?? w.collections[0];
    if (coll) {
      const paidNow = p.amount;
      const pool = paidNow - coll.topUp;
      coll.topUp = Math.max(0, coll.topUp - paidNow);
      coll.paid = coll.topUp <= 0;
      if (pool > 0 && coll.kind === 'recurring') {
        coll.prepaid += pool;
        coll.prepaidMonths = Math.floor(coll.prepaid / coll.due);
      }
      coll.contribution = { amount: (coll.contribution?.amount ?? 0) + paidNow, method: 'sbp', paidAt: new Date().toISOString() };
      state.feed.unshift({ id: `m:${uid('f1000000', state.feed.length)}`, source: 'money', type: 'withdrawal', title: `Взнос «${coll.name}» онлайн`, amount: paidNow, sign: -1, unit: 'rub', checkId: null, createdAt: new Date().toISOString() });
      pushNotification({ kind: 'payment', title: 'Взнос получен', body: `${paidNow.toLocaleString('ru')} ₽ · ${coll.name}. Спасибо!`, meta: { screen: 'history' } });
    }
  } else {
    w.balance += p.amount;
    w.deposit = Math.max(0, w.balance);
    w.debt = Math.max(0, -w.balance);
    const title = p.purpose === 'debt' ? 'Погашение долга онлайн' : 'Пополнение депозита онлайн';
    state.feed.unshift({ id: `m:${uid('f1000000', state.feed.length)}`, source: 'money', type: 'deposit', title, amount: p.amount, sign: 1, unit: 'rub', checkId: null, createdAt: new Date().toISOString() });
    pushNotification({ kind: 'payment', title: p.purpose === 'debt' ? 'Долг погашен' : 'Депозит пополнен', body: `+${p.amount.toLocaleString('ru')} ₽ · баланс ${w.balance.toLocaleString('ru')} ₽`, meta: { screen: 'history' } });
  }
  w.unreadNotifications = unread();
}

function page<T extends { createdAt: string; id: string }>(list: T[], cursor: string | null, limit: number) {
  let start = 0;
  if (cursor) {
    const idx = list.findIndex((x) => `${x.createdAt}|${x.id}` === cursor);
    start = idx >= 0 ? idx + 1 : 0;
  }
  const slice = list.slice(start, start + limit);
  const last = slice[slice.length - 1];
  return { items: slice, nextCursor: start + limit < list.length && last ? `${last.createdAt}|${last.id}` : null };
}

class DemoError extends Error {
  status = 400;
}

export async function demoRequest<T>(method: string, fullPath: string, body?: unknown): Promise<T> {
  await sleep(250);
  const [path, qs = ''] = fullPath.split('?');
  const q = new URLSearchParams(qs);
  const b = (body ?? {}) as Record<string, unknown>;
  const w = state.wallet;
  const out = (v: unknown) => JSON.parse(JSON.stringify(v)) as T;

  if (method === 'GET' && path === '/resident/wallet') {
    w.unreadNotifications = unread();
    return out(w);
  }
  if (method === 'GET' && path === '/resident/feed') {
    const kind = q.get('kind');
    const list = state.feed
      .filter((f) => (kind === 'money' ? f.source === 'money' : kind === 'bonus' ? f.source === 'bonus' : true))
      .sort((a, z) => z.createdAt.localeCompare(a.createdAt));
    return out(page(list, q.get('cursor'), Number(q.get('limit') ?? 30)));
  }
  if (method === 'GET' && path === '/resident/notifications') {
    return out({ ...page(state.notifications, q.get('cursor'), Number(q.get('limit') ?? 30)), unread: unread() });
  }
  if (method === 'POST' && path === '/resident/notifications/read') {
    const ids = b['ids'] as string[] | undefined;
    state.notifications.forEach((n) => { if (!ids || ids.includes(n.id)) n.isRead = true; });
    w.unreadNotifications = unread();
    return out({ unread: unread() });
  }
  if (method === 'PATCH' && path === '/resident/prefs') {
    w.prefs = { ...w.prefs, ...(b as Partial<Wallet['prefs']>) };
    return out(w.prefs);
  }
  if (path === '/resident/devices') return out({ ok: true });
  if (method === 'POST' && path === '/resident/session/refresh') return out({ token: 'demo' });
  if (method === 'GET' && path.startsWith('/auth/me/checks/')) {
    const id = path.split('/').pop()!;
    const row = state.feed.find((f) => f.checkId === id);
    const items = CHECK_ITEMS.default;
    const total = row?.amount ?? items.reduce((s, i) => s + i.lineTotal, 0);
    const discount = Math.max(0, items.reduce((s, i) => s + i.lineTotal, 0) - total);
    return out({
      check: { id, totalAmount: total, tipAmount: 0, createdAt: row?.createdAt ?? new Date().toISOString(), closedAt: row?.createdAt ?? null },
      items,
      payments: [{ method: 'deposit', amount: total }],
      discounts: discount > 0 ? [{ name: 'Резидент', amount: discount }] : [],
    } satisfies CheckDetail);
  }
  if (method === 'POST' && path === '/auth/me/payments') {
    const amount = Number(b['amount']) || 0;
    const id = uid('b0000000', ++paySeq);
    payments.set(id, { createdAt: now(), purpose: String(b['purpose']), amount, collectionId: b['collectionId'] as string | undefined, applied: false });
    return out({ paymentId: id, paymentUrl: 'demo://pay', base: amount, charged: Math.round(amount * 108) / 100 });
  }
  if (method === 'GET' && path.startsWith('/auth/me/payments/')) {
    const id = path.split('/').pop()!;
    const p = payments.get(id);
    if (!p) return out({ status: 'not_found' });
    if (now() - p.createdAt > 2500) {
      applyPayment(id);
      return out({ status: 'confirmed' });
    }
    return out({ status: 'pending' });
  }
  if (method === 'PATCH' && path === '/auth/me') {
    const nick = typeof b['nickname'] === 'string' ? b['nickname'] : w.profile.nickname;
    w.profile = {
      ...w.profile,
      nickname: nick,
      fullName: (b['fullName'] as string | null | undefined) ?? w.profile.fullName,
      phone: (b['phone'] as string | null | undefined) ?? w.profile.phone,
      birthday: (b['birthday'] as string | null | undefined) ?? w.profile.birthday,
    };
    return out({ ok: true });
  }
  if (method === 'POST' && path === '/auth/logout') return out({ ok: true });
  if (method === 'POST' && path === '/resident/account/delete') return out({ ok: true });
  const err = new DemoError('В демо-режиме это недоступно');
  throw err;
}
