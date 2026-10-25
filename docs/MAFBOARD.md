# MafBoard — сервер приложения для ведущих мафии

MafBoard — отдельное приложение (iOS, затем Android) для ведущих игры «Мафия». Код приложения —
[`apps/mafboard`](../apps/mafboard/README.md) (Swift, своя сборка, вне pnpm-воркспейса и Docker-образов),
контракт API — [`apps/mafboard/docs/API.md`](../apps/mafboard/docs/API.md). **Вся серверная часть — этот модуль Titan HUB**:

- вход через своего Telegram-бота;
- привязка аккаунта GoMafia;
- подбор игроков из GoMafia;
- история игр ведущего и клуба.

Модуль **не арендатор** Titan HUB: ведущие приходят из любых клубов GoMafia. Поэтому:

| | Модули клуба | MafBoard |
|---|---|---|
| БД | клуб-БД (`c.var.db`), миграции `src/migrations/sql` на все клубы | своя БД `MAFBOARD_DATABASE_URL`, свои миграции `_mafboard_migrations` |
| Токены | `JWT_SECRET`, `requireAuth` | `MAFBOARD_JWT_SECRET` + issuer/audience: токены контуров друг друга не проходят |
| Бот | Tai клуба (`poll_bot_token`) | свой бот `MAFBOARD_BOT_TOKEN`, вебхук `/api/mafboard/tg-webhook` |
| Подписка | `requireActiveSubscription` | смонтирован до неё, клубом не гейтится |

## Устройство

```
apps/api/src/modules/mafboard/
  config.ts      — переменные окружения (лениво), константы
  types.ts       — внутренние типы и JSON-формы приложения
  repo.ts        — контракт хранилища (MafboardRepo)
  pgRepo.ts      — Postgres-реализация (raw SQL)
  migrations.ts  — схема БД, создание БД при первом старте
  tokens.ts      — access-JWT (1 ч, с id сессии) и refresh (90 дней, одноразовый)
  serialize.ts   — перевод в JSON приложения, телефон в маске
  gomafia.ts     — привязка, поиск «сначала свой клуб», состав клуба (поверх lib/gomafia.ts)
  games.ts       — проверка загружаемой игры (права ведущего, клуб, игроки GoMafia)
  bot.ts         — сценарий бота входа
  router.ts      — HTTP-ручки; зависимости приходят снаружи
  index.ts       — прод-сборка (Postgres, Redis, TgBot), старт и cron
apps/api/test/mafboard/ — тесты (node:test через tsx), хранилище и бот — в памяти
```

Подключение: `app.ts` → `app.route('/api/mafboard', mafboardRouter)` до `requireActiveSubscription`;
`index.ts` → `startMafboard()` после миграций клубов и `scheduleMafboardCron()`.
Если модуль не настроен или его БД недоступна, его ручки отвечают 503, а старт Titan HUB не падает.

## API

Базовый адрес для приложения: `https://mafboard.titanpos.ru/api/mafboard` (поддомен отдаёт только API MafBoard, страницу возврата `/auth/return`, `/terms` и `apple-app-site-association`; см. блок в `nginx/nginx.conf`). Все запросы и ответы — JSON,
даты — ISO 8601. Ошибки приходят в формате `{"error": {"code": "…", "message": "…"}}`.

| Метод и путь | Авторизация | Что делает |
|---|---|---|
| `POST /v1/auth/telegram/start` `{deviceName, platform: ios\|android, deviceSecret}` | — | Билет входа на 10 минут: `{id, deepLink: https://t.me/<бот>?start=login_<код>, expiresAt, confirmationCode}` |
| `GET /v1/auth/telegram/status?ticket=` | — | `{status: pending, opened}` / `confirmed` / `rejected, note` / `expired` |
| `POST /v1/auth/telegram/complete` `{ticket, deviceSecret}` | — | `{tokens: {accessToken, refreshToken, accessExpiresAt}, account}`. Билет одноразовый |
| `POST /v1/auth/refresh` `{refreshToken}` | — | Новая пара токенов той же сессии. Повторное предъявление уже заменённого refresh отзывает все сессии |
| `POST /v1/auth/logout` `{refreshToken}` | — | Завершает сессию устройства: её refresh и access перестают действовать |
| `GET /v1/me/sessions` | Bearer | `{sessions: [{id, deviceName, platform, createdAt, lastUsedAt, isCurrent}]}` — устройства, где выполнен вход; текущее (по сессии access-токена) первым, остальные по `lastUsedAt` |
| `DELETE /v1/me/sessions/:id` | Bearer | Завершить сессию другого устройства → `{ok: true}`. 409 `current_session` — это текущее устройство (для него `logout`), 404 — нет такой активной сессии у пользователя |
| `GET /v1/me` | Bearer | `UserAccount`. Профиль GoMafia старше суток обновляется в фоне |
| `POST /v1/me/gomafia` `{login, password}` | Bearer | Привязать GoMafia: вход в GoMafia проверяет владение, пароль не хранится. 422 `bad_credentials`, 409 `gomafia_taken` |
| `DELETE /v1/me/gomafia` | Bearer | Отвязать — останутся только фанки |
| `POST /v1/auth/review` `{login, password, deviceName, platform}` | — | Вход проверяющего App Store (логин `appreview`, пароль — `MAFBOARD_REVIEW_PASSWORD`, есть в заметках для App Review). Аккаунт без GoMafia, удалённый создаётся заново. Без пароля в .env — 404; лимит 10 попыток/10 мин на IP |
| `DELETE /v1/me` | Bearer | Удалить аккаунт (Профиль → «Удалить аккаунт», требование App Store): сессии, билеты, идущие и личные игры удаляются, игры клуба остаются в его истории без ведущего (`host_user_id = NULL`, без `setup.host`) |
| `GET /v1/gomafia/players?q=` | Bearer | Поиск (от 2 символов): сначала свой клуб (`isInHostClub`), затем общий, до 30 |
| `GET /v1/gomafia/players/:id` | Bearer | Игрок GoMafia |
| `GET /v1/gomafia/clubs/:id/players?page=` | Bearer | Состав клуба |
| `POST /v1/games` (GameRecord) | Bearer | 201 — сохранено, 200 — уже было (повтор безопасен), 409 — номер занят чужой игрой |
| `GET /v1/me/games?since=` | Bearer | Все игры ведущего, включая фанки |
| `GET /v1/clubs/:id/games?since=` | Bearer, участник клуба | История клуба |
| `POST /tg-webhook` | secret_token | Вебхук бота |

### Права ведущего (проверяет `POST /v1/games`)

| Аккаунт | Режимы | Куда идёт игра |
|---|---|---|
| Без GoMafia | только фанка (игроки — кто угодно) | личная история |
| GoMafia без клуба | только фанка | личная история |
| GoMafia + клуб | все режимы; в рейтинг, миникап и турнир — только игроки GoMafia | история клуба |

Ведущий в записи (`setup.host.userID`) должен совпадать с владельцем токена,
а клуб игры (`setup.host.clubID`) — с его текущим клубом GoMafia.

## Сценарий бота

1. Приложение вызывает `start` и открывает `deepLink`.
2. `/start login_<код>`. Первый Telegram, открывший ссылку, закрепляется за билетом; другой аккаунт по ней не войдёт.
3. **Соглашение**: кнопки «Принимаю» / «Отказаться». Шаг пропускается, если текущая версия уже принята.
4. **Номер**: reply-кнопка `request_contact`. Принимается только свой контакт (`contact.user_id == from.id`), номер хранится в E.164. Шаг пропускается, если номер уже известен.
5. **Подтверждение сверкой кода**. `start` вернул приложению `confirmationCode` (две цифры), и приложение его показывает. В боте — три кнопки с кодами: настоящий и два ложных, порядок случайный. Плюс «Это не я». Неверный код или «Это не я» отклоняют билет. Так чужая ссылка, присланная «на подтверждение», не отдаст сессию злоумышленнику.
6. **Возврат**: кнопка «Вернуться в MafBoard» ведёт на `<MAFBOARD_APP_LINK_BASE>/auth/return?ticket=<id>`. Это Universal Link: Telegram разрешает в кнопках только `http(s)` и `tg://`.
7. Приложение вызывает `complete` с тем же `deviceSecret`. Если пользователь вернулся сам, без кнопки, приложение опрашивает `status`.

## Данные (БД `mafboard`)

| Таблица | Что хранит |
|---|---|
| `mb_users` | Telegram (`tg_id` уникален), телефон, версия соглашения, привязка GoMafia (`gomafia_id` уникален, профиль и клуб в `jsonb`) |
| `mb_login_tickets` | Билеты входа: хэш секрета устройства, шаг в боте, статус, срок |
| `mb_sessions` | Сессии устройств: имя и платформа из `start`, время входа, последней активности (не чаще раза в 5 минут и при каждом refresh), срок, отзыв |
| `mb_refresh_tokens` | SHA-256 refresh-токенов, отзыв и ротация; `session_id` — сессия, к которой выдан токен |
| `mb_games` | Игры: ведущий, клуб (`NULL` — личная), формат, даты, `record jsonb` — GameRecord приложения целиком |

Истёкшие билеты, сессии и токены удаляются раз в сутки, через 30 дней после истечения.
Миграция `002_mafboard_sessions` превратила существующие цепочки refresh-токенов в сессии (id — `md5` хэша первого токена цепочки, устройство — из него же).

## Безопасность

- Токен бота — только в `MAFBOARD_BOT_TOKEN` на сервере, в приложение он не попадает.
- Вебхук проверяет `X-Telegram-Bot-Api-Secret-Token`. Секрет — HMAC от `MAFBOARD_JWT_SECRET` и токена бота, а не от `JWT_SECRET` Titan HUB. При смене любого из них вебхук перерегистрируется (при старте и раз в час).
- `MAFBOARD_JWT_SECRET`, совпадающий с `JWT_SECRET`, отклоняется при загрузке настроек.
- Ссылка из Telegram без секрета устройства бесполезна. Секрет уходит на сервер напрямую по TLS, хранится только его SHA-256, `complete` атомарно переводит билет в `claimed`.
- Все изменения билета в боте условные: «ещё pending и принадлежит этому Telegram». Гонка двух аккаунтов за одну ссылку безопасна.
- Refresh одноразовый. Повтор в течение 30 секунд (потерянный ответ) просто отклоняется. Более поздний повтор уже заменённого токена живой сессии считается кражей и отзывает все сессии пользователя. Токен завершённой сессии (выход, отзыв с другого устройства) просто не принимается.
- Access-токен несёт id сессии (claim `sid`), и каждая ручка с Bearer проверяет, что сессия не отозвана: выход и «Выйти» в списке сессий действуют сразу, не дожидаясь часа. Токены без `sid` (выданы до появления сессий) отклоняются 401 — приложение просто обновляет пару.
- Лимиты (Redis, атомарный `SET NX EX` + `INCR`); IPv6 считается по подсети /64:
  - `start` — 20 за 10 минут с одного IP;
  - `complete` — 30 за 10 минут с одного IP;
  - привязка GoMafia — 5 за 10 минут на пользователя, 5 в час на один логин GoMafia, 20 в час с одного IP. Без Redis привязка отказывает, остальное пропускается;
  - поиск — 60 в минуту;
  - загрузка игр — 100 в сутки на ведущего. Тело `POST /v1/games` ограничено 256 КБ, выдача истории — 50 игр за запрос.
- Пароль GoMafia проходит через сервер только для проверки входа, не логируется и не сохраняется. Если входили по нику, ник найденного профиля должен совпасть с введённым.
- Членство в клубе перепроверяется при загрузке игр и чтении истории клуба, если профилю больше суток. Если GoMafia недоступна дольше недели, права клуба снимаются до успешной проверки.
- Старт модуля идёт после `serve()` и в фоне, установка вебхука — с таймаутом 15 секунд. Медленный шлюз Telegram или недоступная БД MafBoard не задерживают Titan HUB.
- Номер телефона — персональные данные (152-ФЗ). Хранится только на сервере, приложение получает маску. Обработка должна быть прописана в соглашении (`MAFBOARD_TERMS_URL`).

## Запуск в проде

1. Создать бота в @BotFather. Положить в `.env` переменные `MAFBOARD_BOT_TOKEN`, `MAFBOARD_JWT_SECRET` (`openssl rand -base64 48`) и `MAFBOARD_APP_LINK_BASE`. Остальные — по [CONFIGURATION.md](CONFIGURATION.md#mafboard-приложение-ведущих-мафии).
2. Передеплоить шлюз: `cd infra/telegram-relay && wrangler deploy`. В `WEBHOOK_PATH` добавлен `/api/mafboard/tg-webhook`.
3. Задеплоить API. При старте модуль сам создаст БД `mafboard` (пользователю Postgres нужно право `CREATEDB` — у `titan` в compose оно есть), применит миграции и поставит вебхук.
4. `MAFBOARD_APP_LINK_BASE=https://mafboard.titanpos.ru`. Поддомен уже настроен в nginx: `apple-app-site-association` (`G99YH9UK8C.ru.titan.mafboard`, путь `/auth/return*`), страница возврата с кнопкой `mafboard://` и пользовательское соглашение `/terms` (файл `nginx/mafboard/terms.html`; при изменении текста поднимите `MAFBOARD_TERMS_VERSION`). В соглашении не указаны реквизиты оператора персональных данных (ФИО или наименование, адрес) — добавить их; контакты для обращений — в описании бота @mafboard_bot.

## Тесты

```bash
cd apps/api
pnpm test              # node:test через tsx: бот, HTTP-ручки, проверка игр, токены
pnpm type-check:test   # типы вместе с тестами
```

Тестам не нужны Postgres, Redis и Telegram: хранилище, бот и GoMafia подменяются в
`test/mafboard/helpers.ts`. SQL `pgRepo.ts` проверен на Postgres 17 (создание БД, миграции,
все методы хранилища).
