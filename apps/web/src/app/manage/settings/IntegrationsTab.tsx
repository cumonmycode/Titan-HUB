'use client'
/**
 * Вкладка «Интеграции».
 *
 * Экран = только УСТАНОВЛЕННЫЕ интеграции (карточки: иконка+имя, статус, маскированный
 * ключ ••••XXXX, кнопка «Настроить»). Карточка «Добавить интеграцию» (как «Новый чек»
 * в кассе) открывает «Магазин» — доступные к установке интеграции с описанием и
 * пошаговым мастером настройки. Удаление — внутри окна «Настроить».
 *
 * Безопасность (как раньше): сам секрет наружу не отдаётся, видно только masked-значение;
 * замена — отдельным полем (не префиллится), пустое поле = не менять.
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Icon } from '@/components/Icon'
import { INP, LBL, Button, Sheet, ConfirmDialog } from '@/components/manage/DesignSystem'
import { StateView } from '@/components/StateView'
import { useToast } from '@/components/Toast'

interface IntegrationItem { key: string; label: string; configured: boolean; masked: string | null }
interface Field { key: string; label: string; type: 'text' | 'password'; placeholder: string; hint: string; optional?: boolean }
interface Product {
  id: string
  name: string
  icon: string
  color: string
  blurb: string // короткое описание для магазина
  about: string // что даёт интеграция (детально)
  kind: 'keys' | 'gomafia'
  fields: Field[]
  comingSoon?: boolean // карточка-витрина «Скоро» (без установки)
}

const CATALOG: Product[] = [
  {
    id: 'poll_bot', name: 'Бот опросов', icon: 'fact_check', color: '#8B5CF6',
    blurb: 'Опросы явки в Telegram-чате клуба',
    about: 'Бот в вашем Telegram-чате: публикует опросы «придёте сегодня?», отмечает игроков командами @all / @tvari и собирает явку — она подтягивается в кассу предчеками.',
    kind: 'keys',
    fields: [{ key: 'poll_bot_token', label: 'Токен бота', type: 'password', placeholder: '123456:ABC-DEF…', hint: 'Откройте @BotFather в Telegram → /newbot (или /token у готового бота) → скопируйте токен вида 123456:ABC… Затем добавьте бота в чат клуба и сделайте администратором.' }],
  },
  {
    id: 'admin_bot', name: 'Админ-бот', icon: 'badge', color: '#4cd7f6',
    blurb: 'Уведомления владельцу и сотрудникам',
    about: 'Telegram-бот для команды: уведомления о сменах, инкассации, расхождениях кассы; привязка аккаунта сотрудника.',
    kind: 'keys',
    fields: [{ key: 'admin_bot_token', label: 'Токен бота', type: 'password', placeholder: '123456:ABC-DEF…', hint: 'В @BotFather создайте отдельного бота (/newbot) → скопируйте токен. Это НЕ тот же бот, что для опросов.' }],
  },
  {
    id: 'wallet_bot', name: 'Бот My Titan', icon: 'account_balance_wallet', color: '#10B981',
    blurb: 'Telegram-бот клиентов',
    about: 'Бот для клиентов: вход в My Titan, баланс, бонусы и депозит прямо в Telegram.',
    kind: 'keys',
    fields: [{ key: 'wallet_bot_token', label: 'Токен бота', type: 'password', placeholder: '123456:ABC-DEF…', hint: 'В @BotFather создайте бота → скопируйте токен.' }],
  },
  {
    id: 'ai', name: 'Tai — ИИ-ассистент', icon: 'auto_awesome', color: '#A78BFA',
    blurb: 'Аналитика и прогнозы на ИИ',
    about: 'Включает ИИ-функции: прогноз выручки вечера, подсказки в кассе, помощник в аналитике.',
    kind: 'keys',
    fields: [{ key: 'ai_api_key', label: 'API-ключ', type: 'password', placeholder: 'pza_…', hint: 'Личный кабинет Polza.ai → раздел API Keys → создайте ключ (начинается на pza_) → скопируйте целиком.' }],
  },
  {
    id: 'platega', name: 'Platega — СБП', icon: 'credit_card', color: '#F59E0B',
    blurb: 'Приём оплат по СБП (QR) на кассе',
    about: 'Эквайринг по СБП: на кассе формируется QR, клиент платит через банк. Нужны два ключа из личного кабинета Platega.',
    kind: 'keys',
    fields: [
      { key: 'platega_merchant_id', label: 'Merchant ID', type: 'text', placeholder: 'Введите Merchant ID', hint: 'Личный кабинет Platega → Настройки магазина → Merchant ID.' },
      { key: 'platega_secret', label: 'Секретный ключ', type: 'password', placeholder: 'Введите секретный ключ', hint: 'Там же → раздел API / Интеграция → секретный ключ. Не путать с публичным.' },
    ],
  },
  {
    id: 'gomafia', name: 'GoMafia.pro', icon: 'sports_esports', color: '#EC4899',
    blurb: 'Подбор игроков из вашего клуба',
    about: 'При создании клиента подбирает игроков из состава вашего клуба и со всего gomafia.pro — ник, имя и фото подставляются автоматически.',
    kind: 'gomafia',
    fields: [
      { key: 'login', label: 'Логин на GoMafia', type: 'text', placeholder: 'Ник или e-mail', hint: 'Ваш ник или e-mail владельца клуба на gomafia.pro.' },
      { key: 'password', label: 'Пароль', type: 'password', placeholder: 'Пароль на GoMafia', hint: 'Пароль аккаунта владельца. Хранится зашифрованно, используется только для определения вашего клуба.' },
      { key: 'clubUrl', label: 'Ссылка на клуб', type: 'text', placeholder: 'gomafia.pro/club/49', hint: 'Необязательно: ссылка на ваш клуб, если он не определится автоматически.', optional: true },
    ],
  },

  // ─── СБП-эквайеры (приём оплат на кассе). После ввода ключей выберите активного
  // эквайера в блоке «Приём оплат» ниже. ─────────────────────────────────────────
  {
    id: 'tbank', name: 'Т-Банк (СБП)', icon: 'credit_card', color: '#FFDD2D', kind: 'keys',
    blurb: 'Приём оплат по СБП (QR) на кассе',
    about: 'Эквайринг по СБП через Т-Банк (Тинькофф): на кассе формируется QR, клиент платит через банк. Нужны Terminal Key и Password из кабинета Т-Бизнес. В кабинете укажите адрес уведомлений (NotificationURL) — он показан в мастере.',
    fields: [
      { key: 'tbank_terminal_key', label: 'Terminal Key', type: 'text', placeholder: 'Введите Terminal Key', hint: 'Кабинет Т-Бизнес → Магазины → ваш терминал → Terminal Key.' },
      { key: 'tbank_password', label: 'Password', type: 'password', placeholder: 'Введите пароль терминала', hint: 'Там же → пароль терминала (Password) для подписи запросов.' },
    ],
  },
  {
    id: 'yookassa', name: 'ЮKassa', icon: 'account_balance_wallet', color: '#8B5CF6', kind: 'keys',
    blurb: 'СБП + чеки 54-ФЗ из коробки',
    about: 'ЮKassa (ЮMoney): приём по СБП (QR) на кассе и, при желании, фискальные чеки 54-ФЗ — ЮKassa пробивает их сама. Нужны shopId и секретный ключ из кабинета. Чтобы включить чеки, в блоке «Приём оплат» выберите ЮKassa фискальным провайдером.',
    fields: [
      { key: 'yookassa_shop_id', label: 'shopId', type: 'text', placeholder: 'Введите shopId', hint: 'Кабинет ЮKassa → Настройки → Магазин → shopId (идентификатор магазина).' },
      { key: 'yookassa_secret_key', label: 'Секретный ключ', type: 'password', placeholder: 'Введите секретный ключ', hint: 'Кабинет ЮKassa → Интеграция → Ключи API → секретный ключ (live_… или test_…).' },
    ],
  },
  {
    id: 'sberbusiness', name: 'СберБизнес', icon: 'account_balance', color: '#21A038', kind: 'keys',
    blurb: 'Эквайринг и СБП от Сбера',
    about: 'Приём оплат через интернет-эквайринг Сбербанка (СБП/карты): гость оплачивает на платёжной странице. Нужны API-логин и пароль из кабинета СберБизнес / Сбербанк Эквайринг.',
    fields: [
      { key: 'sber_username', label: 'API-логин', type: 'text', placeholder: 'Введите API-логин', hint: 'Кабинет эквайринга Сбербанка → API-пользователь (логин вида …-api).' },
      { key: 'sber_password', label: 'API-пароль', type: 'password', placeholder: 'Введите API-пароль', hint: 'Пароль того же API-пользователя.' },
    ],
  },
  {
    id: 'tochka_alfa', name: 'Точка / Альфа', icon: 'credit_card', color: '#EF3124', kind: 'keys',
    blurb: 'Эквайринг Альфа-Банка / Точки',
    about: 'Приём оплат через эквайринг Альфа-Банка (та же платёжная платформа использует и ряд других банков): гость оплачивает на платёжной странице по СБП/картой. Нужны API-логин и пароль из кабинета эквайринга.',
    fields: [
      { key: 'alfa_username', label: 'API-логин', type: 'text', placeholder: 'Введите API-логин', hint: 'Кабинет эквайринга Альфа-Банка → API-пользователь.' },
      { key: 'alfa_password', label: 'API-пароль', type: 'password', placeholder: 'Введите API-пароль', hint: 'Пароль того же API-пользователя.' },
    ],
  },
  // ─── Фискализация 54-ФЗ (отдельные кассы — пробивают чек на ЛЮБУЮ оплату) ──────
  {
    id: 'atol', name: 'АТОЛ Онлайн', icon: 'receipt_long', color: '#4cd7f6', kind: 'keys',
    blurb: 'Облачная касса 54-ФЗ',
    about: 'Фискализация чеков по 54-ФЗ через облачную кассу АТОЛ Онлайн — без своего кассового аппарата. После подключения система сама пробивает чек по каждой закрытой продаже (включая наличные). Данные берутся из кабинета АТОЛ Онлайн.',
    fields: [
      { key: 'atol_login', label: 'Логин интеграции', type: 'text', placeholder: 'Логин API', hint: 'Кабинет АТОЛ Онлайн → Интеграция → логин (не логин входа в ЛК, а логин API).' },
      { key: 'atol_password', label: 'Пароль интеграции', type: 'password', placeholder: 'Пароль API', hint: 'Там же → пароль API интеграции.' },
      { key: 'atol_group_code', label: 'Код группы ККТ', type: 'text', placeholder: 'Напр. ABC_group', hint: 'Кабинет АТОЛ → группы ККТ → код группы, к которой привязана касса.' },
      { key: 'atol_inn', label: 'ИНН', type: 'text', placeholder: 'ИНН организации', hint: 'ИНН вашей организации/ИП (как в кассе).' },
      { key: 'atol_payment_address', label: 'Адрес расчётов', type: 'text', placeholder: 'titanpos.ru или адрес точки', hint: 'Место расчётов: сайт или физический адрес точки (как зарегистрировано в ФНС).' },
      { key: 'atol_company_email', label: 'E-mail компании', type: 'text', placeholder: 'shop@example.ru', hint: 'E-mail отправителя чеков (для копий чеков от ОФД).' },
      { key: 'atol_sno', label: 'СНО (режим налогообложения)', type: 'text', placeholder: 'usn_income', hint: 'Один из: osn, usn_income, usn_income_outcome, envd, esn, patent. Если не уверены — usn_income (УСН «доходы»).', optional: true },
    ],
  },
  {
    id: 'platform_ofd', name: 'Платформа ОФД', icon: 'receipt', color: '#3B82F6', kind: 'keys',
    blurb: 'Облачная касса 54-ФЗ (Ferma)',
    about: 'Фискализация по 54-ФЗ через облачную кассу Платформы ОФД (ИС «Ferma») — без своего кассового аппарата. После подключения система сама пробивает чек по каждой закрытой продаже (включая наличные). Данные — из личного кабинета ОФД.',
    fields: [
      { key: 'ferma_login', label: 'Логин', type: 'text', placeholder: 'Логин ОФД', hint: 'Личный кабинет Платформы ОФД → доступ к API → логин.' },
      { key: 'ferma_password', label: 'Пароль', type: 'password', placeholder: 'Пароль ОФД', hint: 'Там же → пароль для API.' },
      { key: 'ferma_inn', label: 'ИНН', type: 'text', placeholder: 'ИНН организации', hint: 'ИНН вашей организации/ИП (как в кассе).' },
      { key: 'ferma_taxation', label: 'Система налогообложения', type: 'text', placeholder: 'SimpleIn', hint: 'Один из: Common, SimpleIn, SimpleInOut, Unified, UnifiedAgricultural, Patent. Если не уверены — SimpleIn (УСН «доходы»).', optional: true },
    ],
  },
  // ─── Витрина «Скоро» (в разработке) ──────────────────────────────────────────
  { id: 'evotor', name: 'Эвотор', icon: 'point_of_sale', color: '#F59E0B', kind: 'keys', fields: [], comingSoon: true,
    blurb: 'Смарт-терминалы Эвотор', about: 'Эвотор — это физические смарт-терминалы: чек печатается на самом устройстве (не через облако), поэтому интеграция отличается от облачных касс и появится отдельно.' },
  { id: 'kontur_ofd', name: 'Бизнес.Ру / Контур.ОФД', icon: 'receipt_long', color: '#10B981', kind: 'keys', fields: [], comingSoon: true,
    blurb: 'Альтернативные ОФД/кассы', about: 'Альтернативные операторы фискальных данных и кассовые сервисы (Бизнес.Ру, Контур.ОФД) на выбор.' },
  // Маркетинг и коммуникации
  {
    id: 'whatsapp', name: 'WhatsApp Business', icon: 'chat', color: '#25D366', kind: 'keys',
    blurb: 'Уведомления клиентам в WhatsApp',
    about: 'Отправка уведомлений клиентам через WhatsApp (Meta Cloud API): поздравления с днём рождения и др. ВАЖНО: проактивные сообщения идут только ОДОБРЕННЫМ шаблоном — создайте его в Meta Business Manager. Нужны Phone Number ID и постоянный токен из кабинета Meta for Developers. Поведение (шаблон, поздравления) — во вкладке «Поведение».',
    fields: [
      { key: 'whatsapp_phone_id', label: 'Phone Number ID', type: 'text', placeholder: 'Напр. 1029384756', hint: 'Meta for Developers → ваше WhatsApp-приложение → API Setup → Phone number ID.' },
      { key: 'whatsapp_token', label: 'Постоянный токен', type: 'password', placeholder: 'EAAB…', hint: 'Постоянный (System User) access token с правом whatsapp_business_messaging. Временный 24-часовой не подойдёт.' },
    ],
  },
  // Карты и адреса
  {
    id: 'yandex_geosuggest', name: 'Яндекс Геосаджест', icon: 'location_on', color: '#FF3333', kind: 'keys',
    blurb: 'Подсказки адресов из Яндекс.Карт',
    about: 'Поиск и автодополнение адресов от Яндекс.Карт во ВСЕХ полях ввода адреса (онлайн-бронирование выезда, мероприятия). После установки клиент и сотрудник вводят первые буквы — система предлагает точные адреса. Нужен API-ключ Геосаджеста.',
    fields: [{ key: 'yandex_geosuggest_key', label: 'API-ключ', type: 'password', placeholder: 'Введите API-ключ', hint: 'developer.tech.yandex.ru → Кабинет разработчика → подключите сервис «Geosuggest API» (Геосаджест) → создайте ключ и вставьте сюда. Ключ хранится зашифрованно и используется только на сервере.' }],
  },
  // Умный дом
  {
    id: 'home_assistant', name: 'Home Assistant', icon: 'home', color: '#18BCF2', kind: 'keys',
    blurb: 'Свет и кондиционеры кабинок в Titan Home',
    about: 'Гость управляет светом и кондиционером кабинки прямо с планшета Titan Home: две группы света и климат с температурой и режимом. Планшет подключается к Home Assistant напрямую по Wi-Fi клуба (сервер Titan в локальную сеть не ходит), поэтому адрес — локальный. Какие устройства стоят в кабинке, сотрудник выбирает на самом планшете: «Сотрудник» → «Свет и климат». Совет: создайте в Home Assistant отдельного пользователя без прав администратора и выпустите токен от его имени.',
    fields: [
      { key: 'ha_url', label: 'Адрес в локальной сети', type: 'text', placeholder: 'http://192.168.1.50:8123', hint: 'Адрес, по которому Home Assistant открывается с планшета в Wi-Fi клуба: IP сервера и порт 8123. Лучше закрепить за сервером постоянный IP в роутере.' },
      { key: 'ha_token', label: 'Долгосрочный токен', type: 'password', placeholder: 'eyJhbGciOi…', hint: 'Home Assistant → профиль пользователя (слева внизу) → вкладка «Безопасность» → «Долгосрочные токены доступа» → «Создать токен». Токен показывается один раз — скопируйте его сюда.' },
    ],
  },
  {
    id: 'home_assistant_hub', name: 'Home Assistant · Titan HUB', icon: 'lightbulb', color: '#18BCF2', kind: 'keys',
    blurb: 'Свет и кондиционеры всех помещений на кассе',
    about: 'Кассир включает свет и кондиционеры в коридоре, кабинках, зале и туалете прямо с главной кассы приложения Titan HUB: шторка вытягивается сверху. Телефон или iPad подключается к Home Assistant сам, по Wi-Fi клуба. Помещения и их устройства настраиваются в приложении: «Управление» → «Настройки клуба» → «Интеграции» → «Home Assistant» — там же можно ввести адрес и токен. Токен отдельный от планшетов Titan Home: его можно отозвать, не трогая кабинки.',
    fields: [
      { key: 'hub_ha_url', label: 'Адрес', type: 'text', placeholder: 'http://192.168.1.50:8123', hint: 'Можно не заполнять, если адрес тот же, что у Home Assistant для Titan Home. Для работы вне клуба подойдёт внешний https-адрес (например, Nabu Casa).', optional: true },
      { key: 'hub_ha_token', label: 'Долгосрочный токен', type: 'password', placeholder: 'eyJhbGciOi…', hint: 'Home Assistant → профиль пользователя → «Безопасность» → «Долгосрочные токены доступа» → «Создать токен». Лучше от отдельного пользователя без прав администратора.' },
    ],
  },
  // Прочее
  { id: 'music', name: 'Музыка для бизнеса', icon: 'campaign', color: '#EC4899', kind: 'keys', fields: [], comingSoon: true,
    blurb: 'Лицензионная фоновая музыка', about: 'Лицензионная фоновая музыка для зала (Звук Бизнес / Я.Музыка для бизнеса) — без рисков по авторским правам.' },
]

type GmStatus = { connected: boolean; source: string | null; clubId: string | null; clubTitle: string | null; loginMasked: string | null }

interface Status { installed: boolean; ok: boolean; partial: boolean; masked: string | null; detail: string }
function statusOf(p: Product, items: IntegrationItem[], gm?: GmStatus): Status {
  if (p.kind === 'gomafia') {
    if (!gm?.connected) return { installed: false, ok: false, partial: false, masked: null, detail: '' }
    return { installed: true, ok: !!gm.clubId, partial: !gm.clubId, masked: gm.loginMasked ?? null, detail: gm.clubTitle ? `клуб «${gm.clubTitle}»` : gm.clubId ? `клуб #${gm.clubId}` : 'клуб не указан' }
  }
  const cfg = p.fields.map(f => items.find(i => i.key === f.key))
  const n = cfg.filter(i => i?.configured).length
  if (n === 0) return { installed: false, ok: false, partial: false, masked: null, detail: '' }
  // Необязательные поля (адрес HA для HUB, СНО кассы) не делают настройку «неполной».
  const full = p.fields.every((f, i) => f.optional || cfg[i]?.configured)
  const primary = cfg.find(i => i?.configured)
  return { installed: true, ok: full, partial: !full, masked: primary?.masked ?? '••••', detail: full ? '' : 'неполная настройка' }
}

export function IntegrationsTab() {
  const qc = useQueryClient()
  const { show } = useToast()

  const { data, isLoading, error } = useQuery<{ items: IntegrationItem[] }>({ queryKey: ['integrations'], queryFn: () => api.get('/system/integrations') })
  const { data: gm } = useQuery<GmStatus>({ queryKey: ['gomafia-status'], queryFn: () => api.get('/gomafia/status') })

  const [storeOpen, setStoreOpen] = useState(false)
  const [storeProduct, setStoreProduct] = useState<Product | null>(null) // карточка в магазине (инфо)
  const [wizard, setWizard] = useState<Product | null>(null) // мастер установки
  const [step, setStep] = useState(0)
  const [vals, setVals] = useState<Record<string, string>>({})
  const [settings, setSettings] = useState<Product | null>(null) // окно «Настроить» установленной
  const [confirmDel, setConfirmDel] = useState<Product | null>(null)

  const refresh = () => { qc.invalidateQueries({ queryKey: ['integrations'] }); qc.invalidateQueries({ queryKey: ['gomafia-status'] }) }

  const save = useMutation({
    mutationFn: async ({ p, values }: { p: Product; values: Record<string, string> }) => {
      if (p.kind === 'gomafia') {
        const login = (values.login ?? '').trim(), password = (values.password ?? '').trim(), clubUrl = (values.clubUrl ?? '').trim()
        // Полный вход (логин+пароль) либо только смена клуба (без пароля).
        if (login && password) await api.post('/gomafia/connect', { login, password, clubUrl: clubUrl || undefined })
        else if (clubUrl) await api.post('/gomafia/club', { clubUrl })
        else throw new Error('Введите логин и пароль или ссылку на клуб')
      } else {
        for (const f of p.fields) {
          const v = (values[f.key] ?? '').trim()
          if (v) await api.patch(`/system/integrations/${f.key}`, { value: v })
        }
      }
    },
    onSuccess: () => { refresh(); show('Интеграция сохранена', 'success'); closeWizard(); setSettings(null) },
    onError: (e: any) => show(e?.message || 'Не удалось сохранить', 'error'),
  })

  const uninstall = useMutation({
    mutationFn: async (p: Product) => {
      if (p.kind === 'gomafia') await api.delete('/gomafia/disconnect')
      else for (const f of p.fields) await api.delete(`/system/integrations/${f.key}`)
    },
    onSuccess: () => { refresh(); show('Интеграция удалена', 'success'); setConfirmDel(null); setSettings(null) },
    onError: () => show('Не удалось удалить', 'error'),
  })

  function startWizard(p: Product) { setStoreProduct(null); setStoreOpen(false); setWizard(p); setStep(0); setVals({}) }
  function closeWizard() { setWizard(null); setStep(0); setVals({}) }
  function openSettings(p: Product) { setSettings(p); setVals({}) }

  if (isLoading && !data) return <StateView state="loading" />
  if (error) return <StateView state="error" description="Не удалось загрузить интеграции" />

  const items = data?.items ?? []
  const withStatus = CATALOG.map(p => ({ p, st: statusOf(p, items, gm) }))
  const installed = withStatus.filter(x => x.st.installed)
  const available = CATALOG.filter(p => !withStatus.find(x => x.p.id === p.id)!.st.installed)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <p style={{ fontSize: 12, color: 'var(--on-surface-variant)', margin: 0, lineHeight: 1.5 }}>
        Установленные интеграции. Ключи хранятся в зашифрованном виде — показывается только маскированное значение.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
        {installed.map(({ p, st }) => (
          <button key={p.id} onClick={() => openSettings(p)} className="glass-l2"
            style={{ textAlign: 'left', borderRadius: 18, padding: 16, border: '1px solid rgba(255,255,255,0.08)', cursor: 'pointer', color: 'var(--on-surface)', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 42, height: 42, borderRadius: 12, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: `${p.color}1f`, border: `1px solid ${p.color}3a` }}>
                <Icon name={p.icon} size={22} color={p.color} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 15, fontWeight: 700, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</p>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700, marginTop: 3, color: st.ok ? '#10B981' : '#F59E0B' }}>
                  <Icon name={st.ok ? 'check_circle' : 'error'} size={12} color={st.ok ? '#10B981' : '#F59E0B'} />
                  {st.ok ? 'Подключено' : 'Ошибка настройки'}
                </span>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--on-surface-variant)', fontFamily: "'JetBrains Mono',monospace", overflow: 'hidden' }}>
              <Icon name="badge" size={13} color="var(--on-surface-variant)" style={{ flexShrink: 0 }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{st.masked ?? (st.detail || '••••')}</span>
            </div>
            <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '10px 0', borderRadius: 12, background: 'rgba(139,92,246,0.14)', border: '1px solid rgba(139,92,246,0.3)', color: '#a78bfa', fontSize: 13, fontWeight: 700 }}>
              <Icon name="settings" size={16} color="#a78bfa" /> Настроить
            </span>
          </button>
        ))}

        {/* Карточка «Добавить интеграцию» — как «Новый чек» в кассе */}
        <button onClick={() => { setStoreOpen(true); setStoreProduct(null) }}
          style={{ borderRadius: 18, padding: 16, cursor: 'pointer', background: 'rgba(139,92,246,0.03)', border: '1.5px dashed rgba(139,92,246,0.35)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, minHeight: 140 }}>
          <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'linear-gradient(135deg, rgba(139,92,246,0.25), rgba(76,215,246,0.25))', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="add" size={24} color="#A78BFA" />
          </div>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#A78BFA' }}>Добавить интеграцию</span>
          {available.length > 0 && <span style={{ fontSize: 11, color: 'var(--on-surface-variant)' }}>Доступно: {available.length}</span>}
        </button>
      </div>

      {/* ─── Магазин ─── */}
      <Sheet open={storeOpen} onClose={() => { setStoreOpen(false); setStoreProduct(null) }} title={storeProduct ? storeProduct.name : 'Магазин интеграций'} desktopSize="md">
        {storeProduct ? (
          // Детальная карточка интеграции
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <button onClick={() => setStoreProduct(null)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, alignSelf: 'flex-start', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--on-surface-variant)', fontSize: 13, padding: 0 }}>
              <Icon name="chevron_left" size={16} /> Все интеграции
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{ width: 56, height: 56, borderRadius: 16, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: `${storeProduct.color}1f`, border: `1px solid ${storeProduct.color}3a` }}>
                <Icon name={storeProduct.icon} size={30} color={storeProduct.color} />
              </div>
              <div style={{ minWidth: 0 }}>
                <p style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>{storeProduct.name}</p>
                <p style={{ fontSize: 12, color: 'var(--on-surface-variant)', margin: '3px 0 0' }}>{storeProduct.blurb}</p>
              </div>
            </div>
            <p style={{ fontSize: 14, color: 'var(--on-surface)', lineHeight: 1.55, margin: 0 }}>{storeProduct.about}</p>
            {!storeProduct.comingSoon && storeProduct.fields.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '12px 14px', borderRadius: 12, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
                <span style={{ ...LBL, margin: 0 }}>Что понадобится</span>
                {storeProduct.fields.map(f => (
                  <p key={f.key} style={{ fontSize: 12, color: 'var(--on-surface-variant)', margin: 0, lineHeight: 1.4 }}>• {f.label}{f.optional ? ' (необязательно)' : ''}</p>
                ))}
              </div>
            )}
            {storeProduct.comingSoon ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '14px 0', borderRadius: 14, background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', color: '#F59E0B', fontSize: 14, fontWeight: 700 }}>
                <Icon name="schedule" size={18} color="#F59E0B" /> Скоро
              </div>
            ) : (
              <Button variant="primary" fullWidth icon="add" onClick={() => startWizard(storeProduct)}>Установить</Button>
            )}
          </div>
        ) : available.length === 0 ? (
          <StateView state="empty" icon="check_circle" title="Все интеграции установлены" description="Доступных к установке интеграций больше нет." />
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
            {available.map(p => (
              <button key={p.id} onClick={() => setStoreProduct(p)} className="glass-l2"
                style={{ textAlign: 'left', borderRadius: 16, padding: 14, border: '1px solid rgba(255,255,255,0.08)', cursor: 'pointer', color: 'var(--on-surface)', display: 'flex', flexDirection: 'column', gap: 10, position: 'relative', opacity: p.comingSoon ? 0.94 : 1 }}>
                {p.comingSoon && (
                  <span style={{ position: 'absolute', top: 10, right: 10, fontSize: 9, fontWeight: 800, padding: '2px 7px', borderRadius: 6, background: 'rgba(245,158,11,0.18)', color: '#F59E0B', border: '1px solid rgba(245,158,11,0.35)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Скоро</span>
                )}
                <div style={{ width: 40, height: 40, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', background: `${p.color}1f`, border: `1px solid ${p.color}3a` }}>
                  <Icon name={p.icon} size={21} color={p.color} />
                </div>
                <div>
                  <p style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>{p.name}</p>
                  <p style={{ fontSize: 11.5, color: 'var(--on-surface-variant)', margin: '3px 0 0', lineHeight: 1.4 }}>{p.blurb}</p>
                </div>
                {p.comingSoon
                  ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 12, fontWeight: 700, color: '#F59E0B', marginTop: 'auto' }}><Icon name="schedule" size={13} color="#F59E0B" /> Скоро</span>
                  : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 12, fontWeight: 700, color: '#a78bfa', marginTop: 'auto' }}>Подробнее <Icon name="chevron_right" size={14} color="#a78bfa" /></span>}
              </button>
            ))}
          </div>
        )}
      </Sheet>

      {/* ─── Мастер установки (step-by-step) ─── */}
      {wizard && (() => {
        const steps = wizard.fields
        const f = steps[step]!
        const val = vals[f.key] ?? ''
        const canNext = f.optional || val.trim().length > 0
        const isLast = step === steps.length - 1
        // Для установки нужны все обязательные поля.
        const allRequiredFilled = steps.every(s => s.optional || (vals[s.key] ?? '').trim().length > 0)
        return (
          <Sheet open onClose={closeWizard} title={`Установка · ${wizard.name}`} desktopSize="sm">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Прогресс шагов */}
              <div style={{ display: 'flex', gap: 6 }}>
                {steps.map((_, i) => (
                  <div key={i} style={{ flex: 1, height: 4, borderRadius: 2, background: i <= step ? wizard.color : 'rgba(255,255,255,0.1)', transition: 'background 0.2s' }} />
                ))}
              </div>
              <p style={{ fontSize: 11, color: 'var(--on-surface-variant)', margin: 0 }}>Шаг {step + 1} из {steps.length}</p>

              <div>
                <label style={LBL}>{f.label}{f.optional ? ' · необязательно' : ''}</label>
                <input
                  type={f.type}
                  autoComplete={f.type === 'password' ? 'new-password' : 'off'}
                  autoFocus
                  style={INP}
                  value={val}
                  onChange={e => setVals(v => ({ ...v, [f.key]: e.target.value }))}
                  placeholder={f.placeholder}
                  onKeyDown={e => { if (e.key === 'Enter' && canNext && !isLast) setStep(s => s + 1) }}
                />
              </div>

              {/* Инструкция: где найти ключ */}
              <div style={{ display: 'flex', gap: 10, padding: 14, borderRadius: 12, background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.22)' }}>
                <Icon name="info" size={18} color="#a78bfa" style={{ flexShrink: 0, marginTop: 1 }} />
                <p style={{ fontSize: 12.5, margin: 0, color: 'var(--on-surface)', lineHeight: 1.5 }}>{f.hint}</p>
              </div>

              <div style={{ display: 'flex', gap: 10 }}>
                {step > 0
                  ? <Button variant="secondary" onClick={() => setStep(s => s - 1)} icon="chevron_left">Назад</Button>
                  : <Button variant="secondary" onClick={closeWizard}>Отмена</Button>}
                {isLast
                  ? <Button variant="primary" fullWidth icon="check_circle" loading={save.isPending} disabled={!allRequiredFilled} onClick={() => save.mutate({ p: wizard, values: vals })}>Установить</Button>
                  : <Button variant="primary" fullWidth iconRight="chevron_right" disabled={!canNext} onClick={() => setStep(s => s + 1)}>Далее</Button>}
              </div>
            </div>
          </Sheet>
        )
      })()}

      {/* ─── Окно «Настроить» установленной интеграции (замена + удаление) ─── */}
      {settings && (() => {
        const p = settings
        const st = statusOf(p, items, gm)
        const anyFilled = p.fields.some(f => (vals[f.key] ?? '').trim().length > 0)
        return (
          <Sheet open onClose={() => setSettings(null)} title={`Настроить · ${p.name}`} desktopSize="sm">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: st.ok ? '#10B981' : '#F59E0B', fontWeight: 600 }}>
                <Icon name={st.ok ? 'check_circle' : 'error'} size={16} color={st.ok ? '#10B981' : '#F59E0B'} />
                {st.ok ? 'Подключено' : 'Неполная настройка'}{st.detail ? ` · ${st.detail}` : ''}
              </div>
              <p style={{ fontSize: 12, color: 'var(--on-surface-variant)', margin: 0, lineHeight: 1.5 }}>
                Введите новое значение, чтобы заменить. Пустое поле — оставить как есть.
              </p>
              {p.fields.map(f => {
                const cur = p.kind === 'gomafia'
                  ? (f.key === 'login' ? gm?.loginMasked : null)
                  : items.find(i => i.key === f.key)?.masked
                return (
                  <div key={f.key}>
                    <label style={LBL}>{f.label}{f.optional ? ' · необязательно' : ''}</label>
                    <input
                      type={f.type}
                      autoComplete={f.type === 'password' ? 'new-password' : 'off'}
                      style={INP}
                      value={vals[f.key] ?? ''}
                      onChange={e => setVals(v => ({ ...v, [f.key]: e.target.value }))}
                      placeholder={cur ? `Сейчас: ${cur} — введите новое, чтобы заменить` : f.placeholder}
                    />
                    <p style={{ fontSize: 11, color: 'var(--on-surface-variant)', margin: '6px 2px 0', lineHeight: 1.4 }}>{f.hint}</p>
                  </div>
                )
              })}
              <Button variant="primary" fullWidth icon="save" loading={save.isPending} disabled={!anyFilled} onClick={() => save.mutate({ p, values: vals })}>Сохранить</Button>
              <button onClick={() => setConfirmDel(p)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '12px 0', borderRadius: 12, border: '1px solid rgba(244,63,94,0.3)', background: 'rgba(244,63,94,0.08)', color: '#F43F5E', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                <Icon name="delete" size={16} color="#F43F5E" /> Удалить интеграцию
              </button>
            </div>
          </Sheet>
        )
      })()}

      <ConfirmDialog
        open={!!confirmDel}
        onClose={() => setConfirmDel(null)}
        onConfirm={() => confirmDel && uninstall.mutate(confirmDel)}
        title={confirmDel ? `Удалить «${confirmDel.name}»?` : ''}
        message="Ключи будут удалены, интеграция перестанет работать, пока вы не настроите её заново."
        confirmLabel="Удалить"
        danger
        loading={uninstall.isPending}
      />
    </div>
  )
}
