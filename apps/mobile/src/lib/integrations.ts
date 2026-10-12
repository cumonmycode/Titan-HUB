import { useQuery } from '@tanstack/react-query';
import type { useRouter } from 'expo-router';
import type { SFSymbol } from 'sf-symbols-typescript';

import { type IntegrationItem } from './admin-api';
import { api } from './api';
import { queryClient } from './query';
import { useClubKey } from './queries';
import { useSession } from './session';

/**
 * Интеграции клуба как магазин дополнений: в разделе — установленные, «Добавить» —
 * каталог с описаниями, у каждой интеграции свой экран (ключи, её настройки, отключение).
 * Каталог — тот же, что в веб-панели (IntegrationsTab); секреты сервер не отдаёт, только маску.
 */

export type IntegrationField = { key: string; label: string; secure?: boolean; placeholder: string; hint: string; optional?: boolean };
export type IntegrationGroup = 'tai' | 'payments' | 'fiscal' | 'players' | 'marketing' | 'maps' | 'home';
export type PayProvider = 'platega' | 'tbank' | 'yookassa' | 'sber' | 'alfa';

export type IntegrationProduct = {
  id: string;
  name: string;
  symbol: SFSymbol;
  color: string;
  group: IntegrationGroup;
  /** Одна строка в каталоге. */
  blurb: string;
  /** Что даёт интеграция — на её экране. */
  about: string;
  /** keys — ключи в хранилище; gomafia — вход на gomafia.pro; home — свой экран «Home Assistant». */
  kind: 'keys' | 'gomafia' | 'home';
  fields: IntegrationField[];
  /** СБП-эквайер: какой провайдер оплат включает. */
  provider?: PayProvider;
  /** Облачная касса 54-ФЗ. */
  fiscal?: boolean;
};

export const GROUPS: { key: IntegrationGroup; title: string }[] = [
  { key: 'tai', title: 'Telegram и ИИ' },
  { key: 'payments', title: 'Приём оплат' },
  { key: 'fiscal', title: 'Чеки 54-ФЗ' },
  { key: 'players', title: 'Игроки' },
  { key: 'marketing', title: 'Рассылки' },
  { key: 'maps', title: 'Адреса' },
  { key: 'home', title: 'Умный дом' },
];

export const CATALOG: IntegrationProduct[] = [
  {
    id: 'poll_bot',
    name: 'Tai — бот клуба',
    symbol: 'paperplane.fill',
    color: '#2AABEE',
    group: 'tai',
    blurb: 'Один Telegram-бот на всё',
    about:
      'Виртуальный администратор клуба в Telegram: опросы и команды в чатах, рабочий чат персонала, вход в My Titan и Titan HUB, уведомления клиентам и сотрудникам, разговор с гостями текстом и голосом.',
    kind: 'keys',
    fields: [
      {
        key: 'poll_bot_token',
        label: 'Токен бота',
        secure: true,
        placeholder: '123456:ABC-DEF…',
        hint: 'Откройте @BotFather в Telegram → /newbot (или /token у готового бота) → скопируйте токен вида 123456:ABC… Затем добавьте бота в чаты клуба и сделайте администратором.',
      },
    ],
  },
  {
    id: 'ai',
    name: 'Tai — ИИ',
    symbol: 'sparkles',
    color: '#8B5CF6',
    group: 'tai',
    blurb: 'Ассистент кассы, прогнозы и голос',
    about: 'Включает ИИ-функции: Tai в кассе и аналитике, прогноз выручки вечера, подсказки в кассе, поставки со слов и голосовые ответы.',
    kind: 'keys',
    fields: [{ key: 'ai_api_key', label: 'API-ключ', secure: true, placeholder: 'pza_…', hint: 'Личный кабинет Polza.ai → раздел API Keys → создайте ключ (начинается на pza_) → скопируйте целиком.' }],
  },
  {
    id: 'platega',
    name: 'Platega',
    symbol: 'qrcode',
    color: '#F59E0B',
    group: 'payments',
    blurb: 'СБП по QR на кассе',
    about: 'Эквайринг по СБП: на кассе формируется QR, гость платит через свой банк. Нужны два ключа из личного кабинета Platega.',
    kind: 'keys',
    provider: 'platega',
    fields: [
      { key: 'platega_merchant_id', label: 'Merchant ID', placeholder: 'Merchant ID', hint: 'Личный кабинет Platega → Настройки магазина → Merchant ID.' },
      { key: 'platega_secret', label: 'Секретный ключ', secure: true, placeholder: 'Секретный ключ', hint: 'Там же → раздел API / Интеграция → секретный ключ. Не путать с публичным.' },
    ],
  },
  {
    id: 'tbank',
    name: 'Т-Банк',
    symbol: 'creditcard.fill',
    color: '#E5B700',
    group: 'payments',
    blurb: 'СБП по QR через Т-Бизнес',
    about: 'Эквайринг по СБП через Т-Банк: на кассе формируется QR, гость платит через свой банк. Нужны Terminal Key и Password из кабинета Т-Бизнес.',
    kind: 'keys',
    provider: 'tbank',
    fields: [
      { key: 'tbank_terminal_key', label: 'Terminal Key', placeholder: 'Terminal Key', hint: 'Кабинет Т-Бизнес → Магазины → ваш терминал → Terminal Key.' },
      { key: 'tbank_password', label: 'Password', secure: true, placeholder: 'Пароль терминала', hint: 'Там же → пароль терминала (Password) для подписи запросов.' },
    ],
  },
  {
    id: 'yookassa',
    name: 'ЮKassa',
    symbol: 'creditcard.and.123',
    color: '#7C3AED',
    group: 'payments',
    blurb: 'СБП и чеки 54-ФЗ из коробки',
    about: 'Приём по СБП на кассе и, при желании, фискальные чеки 54-ФЗ — ЮKassa пробивает их сама. Нужны shopId и секретный ключ из кабинета ЮKassa.',
    kind: 'keys',
    provider: 'yookassa',
    fields: [
      { key: 'yookassa_shop_id', label: 'shopId', placeholder: 'shopId', hint: 'Кабинет ЮKassa → Настройки → Магазин → shopId (идентификатор магазина).' },
      { key: 'yookassa_secret_key', label: 'Секретный ключ', secure: true, placeholder: 'live_… или test_…', hint: 'Кабинет ЮKassa → Интеграция → Ключи API → секретный ключ.' },
    ],
  },
  {
    id: 'sberbusiness',
    name: 'СберБизнес',
    symbol: 'building.columns.fill',
    color: '#21A038',
    group: 'payments',
    blurb: 'Эквайринг и СБП от Сбера',
    about: 'Приём оплат через интернет-эквайринг Сбербанка: гость платит на платёжной странице по СБП или картой. Нужны API-логин и пароль из кабинета эквайринга.',
    kind: 'keys',
    provider: 'sber',
    fields: [
      { key: 'sber_username', label: 'API-логин', placeholder: 'Логин вида …-api', hint: 'Кабинет эквайринга Сбербанка → API-пользователь.' },
      { key: 'sber_password', label: 'API-пароль', secure: true, placeholder: 'API-пароль', hint: 'Пароль того же API-пользователя.' },
    ],
  },
  {
    id: 'tochka_alfa',
    name: 'Точка / Альфа',
    symbol: 'creditcard.fill',
    color: '#EF3124',
    group: 'payments',
    blurb: 'Эквайринг Альфа-Банка и Точки',
    about: 'Приём оплат через эквайринг Альфа-Банка: гость платит на платёжной странице по СБП или картой. Нужны API-логин и пароль из кабинета эквайринга.',
    kind: 'keys',
    provider: 'alfa',
    fields: [
      { key: 'alfa_username', label: 'API-логин', placeholder: 'API-логин', hint: 'Кабинет эквайринга Альфа-Банка → API-пользователь.' },
      { key: 'alfa_password', label: 'API-пароль', secure: true, placeholder: 'API-пароль', hint: 'Пароль того же API-пользователя.' },
    ],
  },
  {
    id: 'atol',
    name: 'АТОЛ Онлайн',
    symbol: 'doc.text.fill',
    color: '#06B6D4',
    group: 'fiscal',
    blurb: 'Облачная касса: чек на каждую продажу',
    about: 'Фискализация по 54-ФЗ через облачную кассу АТОЛ Онлайн — без своего кассового аппарата. Чек пробивается по каждой закрытой продаже, включая наличные.',
    kind: 'keys',
    fiscal: true,
    fields: [
      { key: 'atol_login', label: 'Логин интеграции', placeholder: 'Логин API', hint: 'Кабинет АТОЛ Онлайн → Интеграция → логин API (не логин входа в кабинет).' },
      { key: 'atol_password', label: 'Пароль интеграции', secure: true, placeholder: 'Пароль API', hint: 'Там же → пароль API интеграции.' },
      { key: 'atol_group_code', label: 'Код группы ККТ', placeholder: 'Например, ABC_group', hint: 'Кабинет АТОЛ → группы ККТ → код группы, к которой привязана касса.' },
      { key: 'atol_inn', label: 'ИНН', placeholder: 'ИНН организации', hint: 'ИНН вашей организации или ИП, как в кассе.' },
      { key: 'atol_payment_address', label: 'Адрес расчётов', placeholder: 'Сайт или адрес точки', hint: 'Место расчётов: сайт или адрес точки, как зарегистрировано в ФНС.' },
      { key: 'atol_company_email', label: 'E-mail компании', placeholder: 'shop@example.ru', hint: 'E-mail отправителя чеков.' },
      { key: 'atol_sno', label: 'Налогообложение', placeholder: 'usn_income', hint: 'Один из: osn, usn_income, usn_income_outcome, esn, patent. Не уверены — usn_income (УСН «доходы»).', optional: true },
    ],
  },
  {
    id: 'platform_ofd',
    name: 'Платформа ОФД',
    symbol: 'doc.plaintext.fill',
    color: '#3B82F6',
    group: 'fiscal',
    blurb: 'Облачная касса Ferma',
    about: 'Фискализация по 54-ФЗ через облачную кассу Платформы ОФД (Ferma) — без своего кассового аппарата. Чек пробивается по каждой закрытой продаже, включая наличные.',
    kind: 'keys',
    fiscal: true,
    fields: [
      { key: 'ferma_login', label: 'Логин', placeholder: 'Логин ОФД', hint: 'Кабинет Платформы ОФД → доступ к API → логин.' },
      { key: 'ferma_password', label: 'Пароль', secure: true, placeholder: 'Пароль ОФД', hint: 'Там же → пароль для API.' },
      { key: 'ferma_inn', label: 'ИНН', placeholder: 'ИНН организации', hint: 'ИНН вашей организации или ИП, как в кассе.' },
      { key: 'ferma_taxation', label: 'Налогообложение', placeholder: 'SimpleIn', hint: 'Один из: Common, SimpleIn, SimpleInOut, Unified, Patent. Не уверены — SimpleIn (УСН «доходы»).', optional: true },
    ],
  },
  {
    id: 'gomafia',
    name: 'GoMafia',
    symbol: 'person.3.fill',
    color: '#EC4899',
    group: 'players',
    blurb: 'Игроки клуба с gomafia.pro',
    about: 'При создании клиента подбирает игроков из состава вашего клуба и со всего gomafia.pro — ник, имя и фото подставляются сами.',
    kind: 'gomafia',
    fields: [
      { key: 'login', label: 'Логин', placeholder: 'Ник или e-mail', hint: 'Ник или e-mail владельца клуба на gomafia.pro.' },
      { key: 'password', label: 'Пароль', secure: true, placeholder: 'Пароль на GoMafia', hint: 'Хранится зашифрованно и нужен только чтобы определить ваш клуб.' },
      { key: 'clubUrl', label: 'Ссылка на клуб', placeholder: 'gomafia.pro/club/49', hint: 'Если клуб не определится сам.', optional: true },
    ],
  },
  {
    id: 'whatsapp',
    name: 'WhatsApp Business',
    symbol: 'message.fill',
    color: '#25D366',
    group: 'marketing',
    blurb: 'Поздравления клиентам в WhatsApp',
    about: 'Сообщения клиентам через WhatsApp (Meta Cloud API), например поздравления с днём рождения. Первым можно писать только одобренным шаблоном — создайте его в Meta Business Manager.',
    kind: 'keys',
    fields: [
      { key: 'whatsapp_phone_id', label: 'Phone Number ID', placeholder: 'Например, 1029384756', hint: 'Meta for Developers → ваше WhatsApp-приложение → API Setup → Phone number ID.' },
      { key: 'whatsapp_token', label: 'Постоянный токен', secure: true, placeholder: 'EAAB…', hint: 'Постоянный (System User) токен с правом whatsapp_business_messaging. Временный на 24 часа не подойдёт.' },
    ],
  },
  {
    id: 'yandex_geosuggest',
    name: 'Яндекс Геосаджест',
    symbol: 'mappin.and.ellipse',
    color: '#FF3B30',
    group: 'maps',
    blurb: 'Подсказки адресов при вводе',
    about: 'Подсказки адресов из Яндекс Карт во всех полях адреса: онлайн-бронь выезда, мероприятия. Вводите первые буквы — система предлагает точные адреса.',
    kind: 'keys',
    fields: [
      { key: 'yandex_geosuggest_key', label: 'API-ключ', secure: true, placeholder: 'API-ключ', hint: 'developer.tech.yandex.ru → Кабинет разработчика → подключите «Geosuggest API» → создайте ключ.' },
    ],
  },
  {
    id: 'home_assistant_hub',
    name: 'Home Assistant · касса',
    symbol: 'lightbulb.fill',
    color: '#18BCF2',
    group: 'home',
    blurb: 'Свет и климат помещений в HUB',
    about: 'Свет и кондиционеры зала, кабинок и коридора — в шторке на главной кассы. Помещения и устройства настраиваются здесь же.',
    kind: 'home',
    fields: [],
  },
  {
    id: 'home_assistant',
    name: 'Home Assistant · кабинки',
    symbol: 'house.fill',
    color: '#0EA5E9',
    group: 'home',
    blurb: 'Свет и климат на планшетах Titan Home',
    about:
      'Гость управляет светом и кондиционером кабинки с планшета Titan Home. Планшет подключается к Home Assistant напрямую по Wi-Fi клуба, поэтому адрес — локальный. Устройства кабинки выбираются на самом планшете: «Сотрудник» → «Свет и климат».',
    kind: 'keys',
    fields: [
      { key: 'ha_url', label: 'Адрес в сети клуба', placeholder: 'http://192.168.1.50:8123', hint: 'Адрес Home Assistant в Wi-Fi клуба: IP сервера и порт 8123. Лучше закрепить за сервером постоянный IP.' },
      { key: 'ha_token', label: 'Долгосрочный токен', secure: true, placeholder: 'eyJhbGciOi…', hint: 'Home Assistant → профиль → «Безопасность» → «Долгосрочные токены доступа» → «Создать токен».' },
    ],
  },
];

export const productById = (id: string) => CATALOG.find((p) => p.id === id) ?? null;

/** Экран интеграции: Home Assistant для кассы — свой экран с помещениями, остальные — общий. */
export function openIntegration(router: ReturnType<typeof useRouter>, product: IntegrationProduct) {
  if (product.kind === 'home') router.push('/manage/settings/home');
  else router.push({ pathname: '/manage/settings/integration', params: { id: product.id } });
}

export type GomafiaStatus = { connected: boolean; source: string | null; clubId: string | null; clubTitle: string | null; loginMasked: string | null };
export type IntegrationStatus = { installed: boolean; complete: boolean; detail: string };

/** Установлена ли интеграция и всё ли введено. home — по ключу HUB, gomafia — по входу. */
export function statusOf(product: IntegrationProduct, items: IntegrationItem[], gomafia?: GomafiaStatus | null): IntegrationStatus {
  if (product.kind === 'gomafia') {
    if (!gomafia?.connected) return { installed: false, complete: false, detail: '' };
    return { installed: true, complete: !!gomafia.clubId, detail: gomafia.clubTitle ? `Клуб «${gomafia.clubTitle}»` : gomafia.clubId ? `Клуб #${gomafia.clubId}` : 'Клуб не указан' };
  }
  const keys = product.kind === 'home' ? ['hub_ha_token'] : product.fields.map((f) => f.key);
  const configured = keys.map((key) => items.find((i) => i.key === key));
  const count = configured.filter((i) => i?.configured).length;
  if (count === 0) return { installed: false, complete: false, detail: '' };
  const complete = product.kind === 'home' || product.fields.every((f, i) => f.optional || configured[i]?.configured);
  const masked = configured.find((i) => i?.configured)?.masked;
  return { installed: true, complete, detail: complete ? (masked ? `Ключ ${masked}` : 'Подключено') : 'Введены не все ключи' };
}

export function useGomafiaStatus(enabled = true) {
  const club = useClubKey();
  return useQuery({ queryKey: [club, 'gomafia', 'status'], queryFn: () => api.get<GomafiaStatus>('/gomafia/status'), enabled, staleTime: 60_000 });
}

function refresh() {
  const host = useSession.getState().club?.host ?? 'none';
  for (const key of [
    ['system', 'integrations'],
    ['system', 'payment-config'],
    ['gomafia', 'status'],
    ['ai', 'chat-config'],
  ])
    void queryClient.invalidateQueries({ queryKey: [host, ...key] });
}

/** Сохранить введённые ключи; пустые поля — «не менять». */
export async function saveIntegrationKeys(values: Record<string, string>): Promise<void> {
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value.trim()) await api.patch(`/system/integrations/${key}`, { value: value.trim() });
    }
  } finally {
    refresh();
  }
}

/** Отключить: удалить все ключи интеграции. */
export async function removeIntegration(product: IntegrationProduct): Promise<void> {
  try {
    if (product.kind === 'gomafia') await api.delete('/gomafia/disconnect');
    else for (const field of product.fields) await api.delete(`/system/integrations/${field.key}`);
  } finally {
    refresh();
  }
}

export async function connectGomafia(values: Record<string, string>): Promise<void> {
  const login = values.login?.trim() ?? '';
  const password = values.password?.trim() ?? '';
  const clubUrl = values.clubUrl?.trim() ?? '';
  try {
    if (login && password) await api.post('/gomafia/connect', { login, password, clubUrl: clubUrl || undefined });
    else if (clubUrl) await api.post('/gomafia/club', { clubUrl });
  } finally {
    refresh();
  }
}

/** Адрес уведомлений эквайера — вписать в кабинет банка. */
export const webhookUrl = (host: string, provider: PayProvider) => `https://${host}/api/pay/${provider}/webhook`;
