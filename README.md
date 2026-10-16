<!-- generated-by: gsd-doc-writer -->

<div align="center">

# TITAN HUB

**Система управления игровым клубом / антикафе: PWA и нативное приложение**

Касса, склад, клиенты, лояльность, смены и касса, аналитика, AI-ассистент — полный операционный цикл заведения в одном монорепо.

Веб работает как PWA, для iOS и Android есть нативное приложение на Expo.

[![Next.js](https://img.shields.io/badge/Next.js_15-000000?style=for-the-badge&logo=nextdotjs&logoColor=white)](https://nextjs.org)
[![React](https://img.shields.io/badge/React_19-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Hono](https://img.shields.io/badge/Hono-E36002?style=for-the-badge&logo=hono&logoColor=white)](https://hono.dev)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL_16-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)](https://www.postgresql.org)
[![Drizzle](https://img.shields.io/badge/Drizzle_ORM-C5F74F?style=for-the-badge&logo=drizzle&logoColor=black)](https://orm.drizzle.team)
[![Redis](https://img.shields.io/badge/Redis_7-DC382D?style=for-the-badge&logo=redis&logoColor=white)](https://redis.io)
[![Docker](https://img.shields.io/badge/Docker_Compose-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://www.docker.com)
[![PWA](https://img.shields.io/badge/PWA-5A0FC8?style=for-the-badge&logo=pwa&logoColor=white)](https://web.dev/progressive-web-apps/)
[![Turborepo](https://img.shields.io/badge/Turborepo-EF4444?style=for-the-badge&logo=turborepo&logoColor=white)](https://turbo.build)
[![pnpm](https://img.shields.io/badge/pnpm_11-F69220?style=for-the-badge&logo=pnpm&logoColor=white)](https://pnpm.io)

**Продакшн: [https://titanpos.ru](https://titanpos.ru)**

</div>

---

## Содержание

- [Продукты](#продукты)
- [О проекте](#о-проекте)
- [Ключевые возможности](#ключевые-возможности)
- [Технологический стек](#технологический-стек)
- [Структура монорепо](#структура-монорепо)
- [Мобильное приложение](#мобильное-приложение)
- [Навигация и маршруты](#навигация-и-маршруты)
- [Доменные механизмы](#доменные-механизмы)
- [Аутентификация и безопасность](#аутентификация-и-безопасность)
- [PWA и Service Worker](#pwa-и-service-worker)
- [Быстрый старт](#быстрый-старт)
- [Деплой](#деплой)
- [Документация](#документация)

---

## Продукты

| Продукт | Для кого | Что это | Где в коде |
|---|---|---|---|
| **Titan HUB** | персонал | основное кассовое ПО: касса, «Управление», аналитика, Tai | `apps/web` (PWA), `apps/mobile` (iOS/Android) |
| **My Titan** | клиенты клуба | бонусы, депозит и долг, история, оплата через СБП, уведомления | `apps/client` (iOS/Android), `apps/wallet` (веб-версия, `/residents`); вход и уведомления — бот Tai |
| **Titan Home** | гости в кабинке | счёт, меню и заказ, оплата по QR, оценка вечера и управление светом и кондиционером (Home Assistant) на Android-планшете | `apps/home` (Android, см. [docs/HOME_APP.md](docs/HOME_APP.md)), веб-версия `apps/web/src/app/tablet` (`/tablet`) |
| **Titan Menu** | гости в зале | меню на телевизоре (AbleSign) | `apps/web/public/tv-menu.html` (`/menu`) |
| **MafBoard** | ведущие мафии из любых клубов GoMafia | компаньон ведущего: рассадка, роли, фазы, голосования, фолы, рейтинги; вход через бота @mafboard_bot | `apps/mafboard` (iOS, Swift), сервер — `apps/api/src/modules/mafboard`, см. [docs/MAFBOARD.md](docs/MAFBOARD.md) |

Технические идентификаторы (bundle ID, пакеты, пути, имена папок) остались прежними — меняются только названия.

---

## О проекте

**Titan HUB** — система автоматизации антикафе / игрового пространства, реализованная как PWA (Progressive Web App) с полноценной offline-поддержкой. Охватывает весь операционный цикл:

- кассир открывает чеки, пробивает тарифы по времени и позиции бара;
- клиенты копят бонусы, растут по тирам лояльности, пополняют депозит в приложении My Titan;
- планшеты в зонах работают как киоски Titan Home (`/tablet`) с IDOR-защитой на уровне зоны;
- владелец видит склад, зарплаты, депозиты/долги и аналитику в реальном времени;
- ИИ-ассистент Tai отвечает на вопросы по данным заведения (read-only SQL).

Интерфейс адаптирован под iPhone/планшеты: тач-таргеты >= 44 px, зум отключён, тёмная premium-тема (glassmorphism, акцент violet).

---

## Ключевые возможности

### Касса (POS) — `/pos`

Открытие и закрытие чеков. Добавление позиций меню и тарифов. Применение скидок, бонусных баллов и сертификатов. Смешанная оплата: наличные, безнал, депозит, бонусы, сертификат. Полноэкранный планшет-киоск на маршруте `/tablet`.

**Сетка открытых чеков** построена по принципу masonry (компонент `MasonryColumns`, `apps/web/src/app/pos/page.tsx`): flex-колонки со смещением нечётных колонок на 34 px. Количество колонок определяется по ширине контейнера через `ResizeObserver` (не по ширине окна — это важно для split-layout): пороги ≥ 980 px → 4 колонки, ≥ 620 px → 3, ≥ 280 px → 2, иначе 1. На десктопе (≥ 1024 px) новый чек открывается в правой панели сплита (`setActiveCheckId`), на телефоне — через роут `/pos/[checkId]`.

**Карточка смены** (`ShiftCard`) занимает предпоследнюю ячейку masonry-сетки перед «Новым чеком» и заменила полноэкранный оверлей «смена не открыта». Поведение:
- смена закрыта → «Открыть смену»;
- смена открыта, есть открытые чеки → три суммы (открыто чеков / **ПРОГНОЗ ВЕЧЕРА с логотипом Tai** / в кассе) + тап открывает `ShiftDetailSheet`;
- смена открыта, чеков нет → «Закрыть смену» + остаток кассы.

**ИИ-прогноз смены (Tai)** — эндпоинт `GET /pos/shift-summary` возвращает `{ shift, openChecks, cashInRegister, forecast }`. Логика прогноза в `apps/api/src/lib/shiftForecast.ts` (`computeShiftForecast`): для каждого открытого чека смены берётся история закрытых чеков игрока за 120 дней (до 40 записей), при наличии ≥ 3 записей за тот же день недели применяется поправка на день; `projected = max(текущая сумма чека, средний чек)`. Гость или игрок без истории — прогноз равен текущей сумме. Итоговый прогноз: `amount` (сумма спроецированных), `currentTotal` (факт), `additional` (разница), `perCheck[]` (по каждому чеку).

### Склад — иммутабельный леджер

Все изменения количества товара фиксируются в таблице `stock_movements` (типы: `opening`, `receipt`, `sale`, `return`, `adjustment`, `write_off`, `count`, `transfer`). Единственная точка записи — функция `recordMovement()` в `apps/api/src/modules/inventory/ledger.ts`. Операция блокирует строку `FOR UPDATE`, вычисляет `qty_after`, пересчитывает средневзвешенную себестоимость (WAC) при каждом приходе и обновляет кэш `inventory.stock_quantity` / `cost_price`. Инвариант: `stock_quantity == SUM(delta)`. Реализовано в миграции `044_stock_ledger.sql`.

### Поставки и ревизии

Документы `supplies` и `revisions` поддерживают статус `draft` (данные черновика в колонке `draft_data`, миграция `046_drafts.sql`). Применение черновика создаёт `supply_items` / `revision_items` и соответствующие движения склада через `recordMovement()`. На фронте при выходе с несохранённым черновиком срабатывает `UnsavedGuard`.

Эндпоинты: `POST /supplies`, `POST /supplies/draft`, `POST /supplies/:id/apply`; `POST /inventory/revisions`, `POST /inventory/revisions/draft`, `POST /inventory/revisions/:id/apply`.

### Депозиты и долги

Авторитетное поле баланса: `profiles.balance` (> 0 — депозит, < 0 — долг). Пополнение и списание — только через `POST /clients/:id/balance` с блокировкой `FOR UPDATE`, идемпотентностью (`idempotencyKey`, миграция `045_tx_idempotency.sql`) и проверкой лимита долга `app_settings.max_client_debt`. Фильтрация клиентов: `GET /clients?filter=balances|deposits|debtors`. Транзакции хранятся в таблице `transactions` (типы: `deposit`, `withdrawal`, `payment`, `refund`, `bonus_*`).

### Сбор средств — `/manage/collections`

Взносы резидентов мимо кассы (Фонд клуба и разовые сборы). Таблицы: `collections`, `collection_periods`, `collection_contributions`, `collection_members` (миграция `053_collections.sql`).

- **Виды сборов:** `recurring` (ежемесячный, период = `YYYY-MM`) и `oneoff` (разовый, период = `single`).
- **Способы взноса:** `cash`, `transfer`, `sbp` — копилка мимо баланса; `deposit` и `debt` — изменяют `profiles.balance` и создают запись в `transactions` (видно в истории игрока).
- **Ростер:** только резиденты (тиры `resident`, `student`, `newbie`). Исключения: 1 мес / 3 мес / навсегда; персональная сумма взноса.
- **API:** `GET|POST /api/collections`, `GET /api/collections/:id`, `POST /api/collections/:id/pay`, `DELETE /api/collections/:id/contributions/:contribId`, `POST /api/collections/:id/exclude|include|member-amount`. Роутер использует `requireAuth` перед `requireRole` (иначе 500 вместо 401).

### Смены и касса / инкассация

Таблицы: `shifts` (поля `cashStart`, `cashEnd`, `eveningType`) и `cash_operations` (типы: `deposit`, `withdrawal`, `salary`, привязка к открытой смене). Живой остаток кассы рассчитывается в `getShiftCashBalance()` (`apps/api/src/modules/shifts/shifts.service.ts`): `cashStart` + наличные платежи по чекам + внесения − изъятия − зарплаты наличными − возвраты наличными.

Эндпоинты: `/shifts/current`, `/shifts/open`, `/shifts/close`, `/shifts/cash-balance`, `/shifts/history`, `/shifts/:id/analytics`, `/cashops`, `/salary/pay`.

### Лояльность

- **Скидки** — таблицы `discounts` и `client_discount_rules`; маршрут `/manage/loyalty`, вкладка «Скидки».
- **Бонусы** — `profiles.bonusPoints`, история в `bonusHistory`, партии `bonus_lots` с FIFO-сгоранием.
- **Сертификаты** — таблица `certificates` (поля `code`, `nominal`, `balance`); маршрут `/manage/loyalty`, вкладка «Сертификаты».

### Тарифы, аренда и зоны

Таблицы: `tariffs` (с backing-позицией в `inventory` категории «Тарифы», флаг `isService`), `evening_types` (типы вечеров: `key` + `label`), `event_hourly_rates` (почасовые ставки мероприятий), `spaces` (зоны / столы: тип `small_booth | large_booth | hall | table | vr | ps5 | zone`, `capacity`, `hourlyRate`, `isActive`).

Модуль `pricing` (`/pricing/tariffs`, `/pricing/evening-types`, `/pricing/event-rates`) + `spaces` (`/spaces` CRUD, soft-delete через `isActive = false`, `/spaces/:id/tablet-link-code`).

### Клиенты — счётчик посещений для новичков

На вкладке транзакций карточки клиента счётчик «Новичок → Резидент» (`visits / threshold`) отображается **только** для тира `newbie`. При достижении порога (по умолчанию 10 посещений) статус повышается до «Резидент». Ручная правка счётчика — кнопками +1 / −1 (`POST /clients/:id/visits/adjust`). У прочих тиров (резидент, студент, гость) счётчик не показывается.

### Права сотрудников

Поле `profiles.permissions` — jsonb `Record<string, boolean>`. Ключи разрешений: `menu`, `inventory`, `clients`, `debtors` и другие. Выдаются владельцем (роль `owner`) через `/staff` (owner-only CRUD, `/staff/:id/reset-pin`, `/staff/:id/telegram-link`, `/staff/:id/passkeys`). Фронт `ManageMenu.tsx` скрывает пункты меню на основе ролей и разрешений.

### Уведомления

Два канала доставки:
- **Web Push** — VAPID, таблица `push_subscriptions`, эндпоинты `/notifications/push/subscribe`, `/notifications/push/test`.
- **Telegram** — через Telegram-боты, поле `profiles.tgId`, привязка через `/notifications/tg-link` (6-значный код, таблица `tg_link_requests`).

Настройки типов уведомлений: `GET/PUT /notifications/settings` (таблица `user_notification_settings`). Поддерживаемые типы: `staff_call`, `request_bill`, `low_stock`, `supply_received`, `deposit_topup`, `debt_created`, `shift_open`, `shift_close` и другие.

### Опросы явки и @-команды — `/manage/polls`

Бот опросов (интеграция `poll_bot`) публикует опросы в Telegram-чате клуба и разбирает входящие сообщения. Поддерживаемые команды:
- **`@all`** — упоминание всех известных участников чата.
- **`@tvari`** / **`@твари`** — упоминание тех, кто не проголосовал или выбрал «Думаю» в последнем опросе.

Команды доступны только администраторам чата; ответ бота подставляет ники клиентов из профилей (поле `nickname`). Голоса хранятся в Redis (`apps/api/src/lib/pollState.ts`). Настройка прав команд: `POST /system/polls/commands`.

### Tai (ИИ-ассистент) — `/ai`

Экран `/ai` (файлы `apps/web/src/app/ai/page.tsx`; компонент `TaiLogo` — `apps/web/src/components/TaiLogo.tsx`). Точки входа в навигации: мобильный FAB на `/dashboard` и кнопка в `Sidebar`. Название экрана — **Tai** («Ассистент Titan AI на данных клуба»).

Бэкенд: `POST /ai/chat` (`apps/api/src/modules/ai/ai.router.ts`). Провайдер Polza (`POLZA_*` из окружения), модель `anthropic/claude-sonnet-4.6`. Режим работы: text-to-SQL по схеме БД в READ ONLY транзакции (DDL и DML заблокированы) плюс набор готовых аналитических отчётов.

### Аналитика

Маршрут `/dashboard`. Дашборд: выручка, средний чек (только по клубным чекам, без мероприятий), топ позиций, расходы по вкладкам, период день/неделя/месяц. Детальная аналитика смены — `/shifts/:id/analytics`.

**Вкладка «Мероприятия»** (`GET /analytics/events?from=YYYY-MM-DD&to=YYYY-MM-DD`): окно фильтрации — по календарной дате события (`events.date`), а не по бизнес-дню. Возвращает: кол-во, общие часы, кол-во дней с событиями, выручку, гостей, средние (длительность / чек / выручка за час), отменённые, разбивку по категориям (Титан / Выезд / Миникап), загрузку по дням недели (Пн–Вс), топ-8 заказчиков, топ-6 зон.

### Интеграции — `/manage/settings` (вкладка «Интеграции»)

Экран интеграций доступен в настройках (`/manage/settings?tab=integrations`). Логика: установленные интеграции отображаются карточками (иконка + имя, статус, маскированный ключ `••••XXXX`), кнопка «Добавить интеграцию» открывает **каталог** доступных интеграций с кратким описанием (`blurb`) и пошаговым мастером настройки.

Каталог интеграций (`apps/web/src/app/manage/settings/IntegrationsTab.tsx`):

| Интеграция | Назначение |
|---|---|
| Бот опросов (`poll_bot`) | Опросы явки в Telegram-чате; `@all` / `@tvari` упоминания ников клиентов |
| Админ-бот (`admin_bot`) | Уведомления сотрудникам в Telegram |
| Бот My Titan (`wallet_bot`) | Telegram-бот клиентов: вход в My Titan, баланс, бонусы |
| Tai — ИИ-ассистент (`ai`) | Прогноз смены, аналитика (ключ Polza.ai) |
| Platega — СБП (`platega`) | Приём оплат по СБП (QR) на кассе |
| GoMafia.pro (`gomafia`) | Подбор игроков при создании клиента |

Эндпоинты: `GET /system/integrations`, `PATCH /system/integrations/:key`, `DELETE /system/integrations/:key`.

---

## Технологический стек

| Слой | Технологии |
|---|---|
| Фронтенд | Next.js 15 (App Router, standalone), React 19, TanStack Query 5, Zustand 5, framer-motion 12 |
| Стили / UI | Tailwind CSS 4, Radix UI (Dialog, Tabs, Select, Switch и др.), CVA, inline design tokens |
| Формы / валидация | react-hook-form 7, Zod 3 |
| DnD | @dnd-kit/core, @dnd-kit/sortable |
| Жесты | @use-gesture/react |
| PWA | next-pwa, `public/sw.js` с версионированием `CACHE_VERSION` |
| Бэкенд | Hono 4 (`@hono/node-server`), `@hono/zod-validator` |
| ORM / БД | Drizzle ORM 0.43, PostgreSQL 16-alpine |
| Кэш / очереди | Redis 7-alpine (AOF), BullMQ 5, ioredis 5 |
| Хранилище файлов | MinIO RELEASE.2023-06-29 (S3-совместимое) |
| JWT / auth | jose 5 (HMAC-256), bcryptjs 3 |
| WebAuthn | @simplewebauthn/server 13, @simplewebauthn/browser 13 |
| Web Push | web-push 3 (VAPID) |
| Telegram-боты | grammY 1 |
| AI | @anthropic-ai/sdk 0.52 (через Polza) |
| Сборка монорепо | pnpm 11 + Turborepo |
| Среда выполнения | Node.js >= 22 |
| Контейнеры | Docker Compose (9 сервисов) |
| Прокси | nginx alpine, TLS, bind-mount `nginx/nginx.conf` |

---

## Структура монорепо

```
titan-hub/
├── apps/
│   ├── web/          # @titan/web      — фронтенд PWA (Next.js 15, порт 3000)
│   ├── api/          # @titan/api      — REST API (Hono, порт 3001)
│   ├── wallet/       # @titan/wallet   — My Titan, веб-версия и Telegram WebApp (Next.js, basePath /residents, порт 3002)
│   ├── mobile/       # titan-mobile     — Titan HUB для iOS и Android (Expo SDK 57, вне pnpm-воркспейса)
│   ├── client/       # titan-resident   — My Titan для iOS и Android (Expo SDK 57, вне pnpm-воркспейса)
│   └── mafboard/     # MafBoard         — приложение ведущих мафии (Swift-пакет MafBoardCore, вне pnpm-воркспейса)
├── packages/
│   ├── database/     # @titan/database — Drizzle ORM: схема, клиент БД, реэкспорт операторов
│   ├── auth/         # @titan/auth     — signToken/verifyToken (JWT), hashPassword/hashPin, verifyTelegramInitData
│   ├── types/        # @titan/types    — общие TypeScript-типы и Zod-схемы (фронт + бэк)
│   ├── ui/           # @titan/ui       — UI-примитивы (Radix UI, lucide-react, CVA, tailwind-merge)
│   └── config/       # @titan/config   — shared tsconfig/* и eslint-конфиг
├── scripts/
│   ├── deploy.sh       # деплой на VPS
│   ├── backup-db.sh    # бэкап PostgreSQL (pg_dump + rclone)
│   ├── setup-vps.sh    # первичная настройка сервера
│   └── renew-ssl.sh    # обновление TLS-сертификата
├── nginx/
│   └── nginx.conf      # конфигурация nginx (bind-mount в контейнер)
├── docker-compose.yml  # сервисы: api, web, wallet, site, nginx, postgres, redis, minio (Telegram-бот Tai живёт в api: modules/tg)
├── turbo.json
├── pnpm-workspace.yaml
└── package.json
```

### apps/web — фронтенд

Next.js 15 App Router, сборка standalone. Корневой маршрут `/` редиректит на `/pos`.

```
apps/web/src/
├── app/
│   ├── ai/               # Tai — ИИ-ассистент
│   ├── dashboard/        # аналитика, расходы (вкладки)
│   ├── events/           # мероприятия (свой PullToRefreshContainer, сегмент-вкладки Предстоящие/Прошедшие)
│   ├── login/            # вход (PIN, пароль, Telegram, passkey)
│   ├── manage/           # раздел «Управление» (split-layout на десктопе)
│   │   ├── about/          # о системе, бэкап из интерфейса
│   │   ├── balances/       # депозиты и долги (вкладки: Все / Депозиты / Долги)
│   │   ├── clients/        # клиенты (счётчик посещений только для новичков)
│   │   ├── collections/    # сбор средств (Фонд клуба и разовые сборы)
│   │   ├── customers/      # заказчики
│   │   ├── inventory/      # склад (вкладки: Остатки / Поставки / Ревизия)
│   │   ├── loyalty/        # лояльность (вкладки: Скидки / Бонусы / Сертификаты)
│   │   ├── menu/           # позиции меню
│   │   ├── polls/          # опросы явки (owner-only)
│   │   ├── pricing/        # тарифы, типы вечеров, зоны/аренда, мероприятия
│   │   ├── salary/         # зарплата
│   │   ├── settings/       # настройки системы (вкладки: заведение / поведение / интеграции)
│   │   ├── shifts/         # смена и касса (split-layout)
│   │   ├── spaces/         # зоны и столы
│   │   └── staff/          # Пользователи (owner) / Мой профиль (staff); уведомления + passkey
│   ├── pos/              # касса (masonry-сетка чеков, ShiftCard, ShiftDetailSheet)
│   ├── reports/          # отчёты
│   ├── shifts/           # история смен
│   ├── superadmin/       # панель суперадмина (мультитенантность)
│   └── tablet/           # Titan Home — планшет-киоск
├── components/
│   ├── BottomNav.tsx               # мобильная навигация
│   ├── Sidebar.tsx                 # боковое меню десктоп/планшет
│   ├── GlobalPullToRefresh.tsx     # pull-to-refresh (.layout-content, не перехватывает Sheet/Modal)
│   ├── PullToRefreshContainer.tsx  # изолированный PTR для страниц с собственным скроллом (events, pos)
│   ├── TaiLogo.tsx                 # анимированный логотип Tai (ИИ-ассистент)
│   ├── Icon.tsx                    # SVG-спрайт (собственная иконка titan_ai и др.)
│   └── manage/
│       ├── ManageMenu.tsx          # меню «Управление» с gate по ролям и разрешениям
│       └── DesignSystem.tsx        # общие UI-компоненты раздела управления
├── lib/
│   └── nav.ts              # описание пунктов навигации
└── store/
    └── auth.store.ts   # Zustand — состояние аутентификации
```

### apps/api — бэкенд

Hono v4 на Node.js >= 22. Порт `3001` (настраивается через `API_PORT`). Миграции применяются **автоматически** при старте через `src/migrations/runner.ts` (таблица `_migrations`, SQL-файлы `src/migrations/sql/001_*.sql` … `053_*.sql`, идемпотентно в транзакции). Сервер стартует только после успешного завершения миграций.

```
apps/api/src/
├── index.ts             # assertEnv → runMigrations → serve + cron (дни рождения 09:00 МСК)
├── app.ts               # Hono-приложение, монтирование роутеров
├── middleware/
│   └── auth.ts          # requireAuth / requireRole
├── modules/             # бизнес-модули (<name>/<name>.router.ts + <name>.service.ts)
│   ├── ai/              # POST /ai/chat
│   ├── analytics/       # GET /analytics/* (dashboard, overview, revenue, events, tariffs, clients, …)
│   ├── auth/            # /auth/login/pin|telegram|passkey; /auth/me; /auth/pin/set
│   ├── cashops/         # /cashops
│   ├── certificates/    # /certificates
│   ├── clients/         # /clients
│   ├── collections/     # /collections (сборы средств, взносы резидентов)
│   ├── customers/       # /customers
│   ├── discounts/       # /discounts
│   ├── events/          # /events
│   ├── expenses/        # /expenses
│   ├── gomafia/         # /gomafia (поиск игроков)
│   ├── inventory/       # /inventory; ledger.ts (recordMovement)
│   ├── menu/            # /menu
│   ├── notifications/   # /notifications/push/*; /notifications/tg-link; /notifications/settings
│   ├── platega/         # платёжный шлюз (СБП)
│   ├── pos/             # /pos (чеки, оплата, /pos/shift-summary)
│   ├── pricing/         # /pricing/tariffs|evening-types|event-rates
│   ├── refunds/         # /refunds
│   ├── salary/          # /salary
│   ├── shifts/          # /shifts/*
│   ├── spaces/          # /spaces
│   ├── staff/           # /staff
│   ├── superadmin/      # /superadmin (мультитенантность)
│   ├── supplies/        # /supplies
│   ├── system/          # /system (настройки, интеграции, бэкап, здоровье)
│   ├── tg/              # /tg (вебхук бота, @all/@tvari команды)
│   └── upload/          # /upload (MinIO)
└── migrations/
    ├── runner.ts
    └── sql/             # 001_*.sql … 053_*.sql
```

### packages/database — схема и клиент БД

Drizzle ORM + `postgres` (pg-wire). Файлы схемы в `src/schema/*.ts`. Основные группы таблиц:

| Группа | Таблицы |
|---|---|
| Профили | `profiles` |
| Меню / склад | `inventory`, `menu_categories`, `tariffs`, `stock_movements` |
| Чеки | `checks`, `check_items`, `check_payments`, `check_discounts` |
| Финансы | `transactions`, `supplies`, `supply_items`, `supply_corrections`, `revisions`, `revision_items`, `salary_payments`, `cash_operations`, `expenses`, `refunds`, `bonus_lots`, `certificates`, `discounts` |
| Лояльность | `client_discount_rules`, `bonus_lots` |
| Пространства | `spaces` |
| Уведомления | `user_notification_settings`, `push_subscriptions`, `passkeys`, `tg_link_requests` |
| Смены | `shifts` |
| Мероприятия | `evening_types`, `event_hourly_rates`, `events` |
| Клиенты | `customers` |
| Сборы средств | `collections`, `collection_periods`, `collection_contributions`, `collection_members` |

### packages/auth — аутентификационные хелперы

Функции: `signToken` / `verifyToken` (JWT через `jose`), `hashPassword` / `verifyPassword` (bcryptjs), `hashPin` / `verifyPin`, `verifyTelegramInitData`.

### packages/types — общие типы

TypeScript-типы и Zod-схемы, импортируемые как фронтендом (`@titan/web`), так и бэкендом (`@titan/api`).

### packages/ui — UI-примитивы

Radix UI (Dialog, Tabs, Select, Switch, Popover, Tooltip и др.), lucide-react, CVA, clsx, tailwind-merge. Peer-зависимость: React 19.

### packages/config — общие конфиги

Shared `tsconfig/*.json` и конфигурация ESLint 9 + typescript-eslint.

---

## Мобильное приложение

Titan HUB для iOS и Android — `apps/mobile`. Не обёртка над PWA: интерфейс собран из нативных компонентов, данные идут через тот же REST API.

| | |
|---|---|
| Стек | Expo SDK 57, React Native 0.86, expo-router |
| Состав | касса, «Управление», мероприятия, аналитика, Tai |
| iOS | `ru.titan.hub`, распространение через TestFlight |
| Android | `ru.titanpos.hub`, APK для arm64-v8a |

Интерфейс писался под iOS 26 — контролы SwiftUI, SF Symbols, Liquid Glass, Swift Charts. На Android их заменяет слой совместимости `src/compat/android`, который подключается подменой модулей в `metro.config.js`, поэтому экраны общие для обеих платформ.

```bash
cd apps/mobile && npm install

npm run ios:device        # собрать и поставить на iPhone/iPad
npm run android:device    # собрать APK и поставить на Android
npm run ios:testflight    # загрузить билд в TestFlight
```

Приложение ставит зависимости своим `npm` и исключено из pnpm-воркспейса: серверные Docker-сборки не должны тянуть React Native.

Подробности — установка, публикация, устройство слоя совместимости и различия платформ — в [docs/MOBILE.md](docs/MOBILE.md).

---

## Навигация и маршруты

### Основная навигация (`lib/nav.ts`)

| Маршрут | Описание |
|---|---|
| `/pos` | Касса |
| `/events` | Мероприятия |
| `/dashboard` | Аналитика (расходы на отдельной вкладке) |
| `/ai` | Tai — ИИ-ассистент |
| `/manage` | Раздел управления |

Мобильная навигация — `BottomNav.tsx`. Десктопная/планшетная — `Sidebar.tsx`. Pull-to-refresh на основном контенте — `GlobalPullToRefresh.tsx` (цепляется к `.layout-content`, не перехватывает Sheet и Modal). Страницы `/events` и `/pos` используют собственный `PullToRefreshContainer` и исключены из глобального PTR.

### Меню «Управление» (4 группы, `ManageMenu.tsx`)

**Меню и склад**
- `/manage/menu` — позиции меню
- `/manage/inventory` — склад (вкладки: Остатки / Поставки / Ревизия)
- `/manage/pricing` — тарифы, типы вечеров, зоны/аренда, мероприятия

**Клиенты**
- `/manage/clients` — клиенты (счётчик посещений только для новичков → Резидент)
- `/manage/customers` — заказчики
- `/manage/balances` — депозиты и долги (вкладки: Все / Депозиты / Долги)
- `/manage/loyalty` — лояльность (вкладки: Скидки / Бонусы / Сертификаты)
- `/manage/collections` — сбор средств (Фонд клуба / разовые взносы резидентов)

**Персонал и смены**
- `/manage/staff` — Пользователи (owner) / Мой профиль (staff); внутри: уведомления и passkey
- `/manage/shifts` — смена и касса (split-layout)
- `/manage/salary` — зарплата

**Система**
- `/manage/settings` — настройки системы (вкладки: заведение / поведение / интеграции)
- `/manage/polls` — опросы явки, `@all`/`@tvari` (только owner)
- `/manage/about` — о системе (бэкап БД из интерфейса)

Пункты «Управление» скрываются по ролям и разрешениям через gate в `ManageMenu.tsx`. Раздел `/manage` на десктопе использует split-layout (`apps/web/src/app/manage/layout.tsx`).

### Страница мероприятий (`/events`)

Сегмент-вкладки **Предстоящие** / **Прошедшие** (иконка над подписью). Прошедшие: события текущего месяца — плоским списком; события прошлых месяцев — папками (`folder_open`, раскрытие по клику). Свой `PullToRefreshContainer` (глобальный PTR на `/events` отключён).

---

## Доменные механизмы

### Складской леджер

Все изменения количества товара проходят через `recordMovement()` (`apps/api/src/modules/inventory/ledger.ts`). Операция: блокировка строки `FOR UPDATE` → вычисление `qty_after` → пересчёт WAC при приходах → обновление кэша `inventory.stock_quantity` / `cost_price`. Все write-сайты (POS-продажа/возврат, приёмка поставки, ревизия, ручная правка, возвраты) используют исключительно `recordMovement()`. Реализовано в `044_stock_ledger.sql`.

### Атомарность операций с балансом клиента

Балансовые операции проходят через `POST /clients/:id/balance` с `FOR UPDATE` и `idempotencyKey` (`045_tx_idempotency.sql`). Лимит долга задаётся в `app_settings.max_client_debt`.

### Черновики документов (поставки / ревизии)

Документы хранятся в статусе `draft` с сериализованными данными в колонке `draft_data` (`046_drafts.sql`). Применение черновика атомарно создаёт позиции и движения склада.

### Сборы средств

Взносы резидентов хранятся в `collections` / `collection_periods` / `collection_contributions` / `collection_members` (миграция `053_collections.sql`). Методы `deposit` и `debt` изменяют `profiles.balance` атомарно через `FOR UPDATE` с проверкой лимита долга (`max_client_debt`). Ключ: `requireAuth` монтируется на `collectionsRouter.use('*', ...)` перед `requireRole`, иначе 500 вместо 401.

### Миграции БД

`apps/api/src/migrations/runner.ts` применяет SQL-файлы из `src/migrations/sql/` по возрастанию номера в единой транзакции. Имена применённых файлов записываются в таблицу `_migrations`. Запускается до старта HTTP-сервера. Текущий максимум: `053_collections.sql`.

### Titan Home (планшет-киоск)

Сессия планшета (`/auth/tablet-session`) привязывается к зоне (`linkedSpaceId`). Все операции проверяются на соответствие зоне — IDOR-защита на уровне каждого запроса.

Нативное приложение `apps/home` — режим киоска (владелец устройства), панель «Свет и климат» через Home Assistant в локальной сети, оценка вечера после оплаты. Подробно — [docs/HOME_APP.md](docs/HOME_APP.md).

---

## Аутентификация и безопасность

Роли: `owner`, `staff`, `tablet`, `client`. Каждый эндпоинт защищён `requireRole()` из `apps/api/src/middleware/auth.ts`.

**Способы входа:**

| Метод | Эндпоинт |
|---|---|
| PIN (fan-out по staff / owner) | `POST /auth/login/pin` |
| Пароль | `POST /auth/login` |
| Passkey / WebAuthn | `/auth/passkey/register`, `/auth/passkey/authenticate`, `/auth/passkey/list`, `/auth/passkey/:id` |
| Telegram initData | `POST /auth/login/telegram` |
| Планшет-киоск | `/auth/tablet-session` |

**Прочие меры:**
- JWT HMAC-256 (`jose 5`), секрет >= 32 символов, blacklist отозванных токенов в Redis.
- Rate limiting: Redis sliding window, 120 rpm (анонимные) / 600 rpm (авторизованные).
- PIN-вход: rate limit 5 попыток / 15 мин на IP + глобальный потолок неудач.
- SSE-тикеты: одноразовые, 60-секундные, вместо JWT в URL.
- AI-модуль: только READ ONLY транзакция, DDL и DML заблокированы, чувствительные колонки скрыты.
- Все запросы к БД — через Drizzle (параметризованные), прямой SQL не используется.

---

## PWA и Service Worker

Service Worker (`apps/web/public/sw.js`, версионирование `CACHE_VERSION`):

| Тип ресурса | Стратегия |
|---|---|
| `/_next/static/*` | cache-first (неизменяемые хэши сборки) |
| HTML / JSON / медиа | network-first (таймаут 8 с) → fallback к кэшу |
| `/api/*` | network-only (данные не кэшируются в киоске) |
| SSE | не перехватывается |

При каждом деплое фронта необходимо поднять `CACHE_VERSION` в `sw.js` — это инициирует `skipWaiting` и `clients.claim`.

---

## Быстрый старт

Подробная инструкция с пошаговой установкой: [docs/GETTING-STARTED.md](docs/GETTING-STARTED.md).

**Требования:** Node.js >= 22, pnpm >= 11, Docker + Docker Compose.

```bash
# 1. Клонировать репозиторий
git clone <repo-url>
cd titan-hub

# 2. Настроить окружение
cp .env.example .env
# Заполнить: DATABASE_URL, JWT_SECRET, REDIS_URL, токены ботов, POLZA_*, VAPID и др.

# 3. Установить зависимости
pnpm install

# 4. Поднять инфраструктуру (PostgreSQL, Redis, MinIO)
docker compose up -d postgres redis minio

# 5. Запустить все сервисы в dev-режиме
pnpm dev
```

| Сервис | URL |
|---|---|
| Web (PWA) | http://localhost:3000 |
| API | http://localhost:3001 |
| My Titan (веб) | http://localhost:3002 |

> Миграции применяются автоматически при старте `api`-сервиса (`src/migrations/runner.ts`), отдельный шаг не нужен.

**Команды монорепо:**

| Команда | Описание |
|---|---|
| `pnpm dev` | Запуск всех сервисов в режиме разработки (turbo) |
| `pnpm build` | Сборка всех пакетов и приложений |
| `pnpm build:wallet` | Сборка только `@titan/wallet` |
| `pnpm lint` | Линтинг всего монорепо |
| `pnpm type-check` | Проверка TypeScript-типов |
| `pnpm format` | Форматирование кода (Prettier) |
| `pnpm db:generate` | Генерация Drizzle-миграций по изменениям схемы |
| `pnpm db:migrate` | Применение Drizzle-миграций |
| `pnpm db:push` | Быстрый push схемы без генерации миграции |
| `pnpm db:studio` | Drizzle Studio — браузерный GUI для БД |
| `pnpm clean` | Удаление всех артефактов сборки |

---

## Деплой

Подробная инструкция: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

Продакшн работает на VPS `/opt/titan-hub` через `docker compose`. Контейнеры: `api`, `web`, `wallet`, `site`, `nginx:alpine`, `postgres:16-alpine`, `redis:7-alpine`, `minio`.

```bash
# На VPS из /opt/titan-hub
bash scripts/deploy.sh
```

`scripts/deploy.sh` выполняет последовательно:

1. `git fetch origin main && git reset --hard origin/main`
2. `pnpm install --frozen-lockfile`
3. Проверка наличия `.env`
4. `docker compose build` (с кешем слоёв)
5. Бэкап БД (`scripts/backup-db.sh`) — перед применением миграций
6. `docker compose up -d --remove-orphans`
7. Миграции применяются автоматически при старте `api`-контейнера
8. `docker exec titan-nginx nginx -s reload` — обновление upstream-IP после пересоздания контейнеров
9. Healthcheck: `curl -sf https://titanpos.ru/api/health`

**nginx** стартует только после перехода `api` в состояние `healthy` (healthcheck ждёт завершения миграций) — исключает окно 502 при холодном старте.

**Бэкапы:** `pg_dump --clean --if-exists` + gzip, ротация 14 дней локально, опционально выгрузка в Google Drive через rclone. Бэкап снимается автоматически перед каждым деплоем.

---

## Документация

| Файл | Содержание |
|---|---|
| [docs/GETTING-STARTED.md](docs/GETTING-STARTED.md) | Требования, установка, первый запуск, типичные проблемы |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | Локальная разработка, команды, code style, процесс PR |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Архитектурный обзор, диаграммы, ключевые абстракции |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Деплой на VPS, Docker Compose, окружение, откат |
| [docs/TESTING.md](docs/TESTING.md) | Тестирование: фреймворки, запуск, покрытие |
| [docs/API.md](docs/API.md) | Эндпоинты, форматы запросов/ответов, аутентификация |
| [docs/CONFIGURATION.md](docs/CONFIGURATION.md) | Переменные окружения, значения по умолчанию |
| [docs/MOBILE.md](docs/MOBILE.md) | Мобильное приложение: сборка, публикация в TestFlight, слой совместимости с Android |

---

<div align="center">

**Titan HUB** — сделано для антикафе

</div>
