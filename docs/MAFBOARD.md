# MafBoard — сервер приложения для ведущих мафии

MafBoard — отдельное приложение (iOS, затем Android) для ведущих игры «Мафия». Код приложения —
[`ios/` в репозитории MafBoardStudio](https://github.com/cumonmycode/MafBoardStudio/blob/main/ios/README.md) (Swift; до 2026-11-15 жил здесь в `apps/mafboard`,
перенесён вместе с историей — там же MafBoard Studio и общий протокол пульта),
контракт API — [`ios/docs/API.md`](https://github.com/cumonmycode/MafBoardStudio/blob/main/ios/docs/API.md). **Вся серверная часть — этот модуль Titan HUB**:

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

Базовый адрес для приложения: `https://api.mafboard.com` (пути `/v1/...`; nginx передаёт их серверу как `/api/mafboard/v1/...`). Домены (блоки в `nginx/nginx.conf`, маршруты в `nginx/mafboard/*.conf`): `mafboard.com` — лендинг и страницы `/terms`, `/privacy`, `/support`; `api.mafboard.com` — API, релей пульта, страницы `/auth/return` и `/studio/login`, `apple-app-site-association`, а также прежние пути `/api/mafboard/...`; `mafboard.titanpos.ru` — старый адрес, отвечает как раньше, пока им пользуются приложения прошлых версий. Все запросы и ответы — JSON,
даты — ISO 8601. Ошибки приходят в формате `{"error": {"code": "…", "message": "…"}}`.

| Метод и путь | Авторизация | Что делает |
|---|---|---|
| `POST /v1/auth/telegram/start` `{deviceName, platform: ios\|android, deviceSecret}` | — | Билет входа на 10 минут: `{id, deepLink: https://t.me/<бот>?start=login_<код>, expiresAt, confirmationCode}` |
| `GET /v1/auth/telegram/status?ticket=` | — | `{status: pending, opened}` / `confirmed` / `rejected, note` / `expired` |
| `POST /v1/auth/telegram/complete` `{ticket, deviceSecret}` | — | `{tokens: {accessToken, refreshToken, accessExpiresAt}, account}`. Билет одноразовый |
| `POST /v1/auth/qr/start` `{deviceName, platform: macos\|windows, deviceSecret}` | — (20 за 10 мин с IP) | Вход в MafBoard Studio: билет на 3 минуты `{id, scanCode, confirmationCode, expiresAt}`. Настольные платформы входят только так |
| `GET /v1/auth/qr/status?ticket=` | — | `{status: pending\|confirmed\|rejected\|expired}` |
| `GET /v1/auth/qr/ticket?scan=` | Bearer | Что показать на телефоне: `{deviceName, platform, codes: [3 числа], expiresAt}`. Варианты кода хранятся в билете и не меняются между запросами. 404 — билет истёк или уже решён |
| `POST /v1/auth/qr/approve` `{scan, code}` | Bearer (30 за 10 мин) | `{ok: true}` или `{ok: false}`, если код неверный: билет сразу становится `rejected`. 422 `invalid_ticket` — решать уже нечего. Новый пользователь здесь не создаётся |
| `POST /v1/auth/qr/complete` `{ticket, deviceSecret}` | — (30 за 10 мин с IP) | `{tokens, account}`. Билет одноразовый, 422 `invalid_ticket` — не подтверждён, истёк или секрет не тот |
| `POST /v1/auth/refresh` `{refreshToken}` | — | Новая пара токенов той же сессии. Повторное предъявление уже заменённого refresh через 30 с и позже отзывает все сессии, а для `macos` и `windows` только свою: уснувший ноутбук не должен выкидывать телефон ведущего |
| `POST /v1/auth/logout` `{refreshToken}` | — | Завершает сессию устройства: её refresh и access перестают действовать |
| `GET /v1/me/sessions` | Bearer | `{sessions: [{id, deviceName, platform, createdAt, lastUsedAt, isCurrent}]}` — устройства, где выполнен вход; текущее (по сессии access-токена) первым, остальные по `lastUsedAt` |
| `DELETE /v1/me/sessions/:id` | Bearer | Завершить сессию другого устройства → `{ok: true}`. 409 `current_session` — это текущее устройство (для него `logout`), 404 — нет такой активной сессии у пользователя |
| `GET /v1/me` | Bearer | `UserAccount`. Профиль GoMafia старше суток обновляется в фоне |
| `POST /v1/me/gomafia` `{login, password}` | Bearer | Привязать GoMafia: вход в GoMafia проверяет владение, пароль GoMafia не хранится. Если тем же паролем открывается АИМ (admin.gomafia.pro), сохраняется вход в АИМ — для турниров GoMafia. 422 `bad_credentials`, 409 `gomafia_taken` |
| `DELETE /v1/me/gomafia` | Bearer | Отвязать — останутся только фанки; сохранённый вход в АИМ стирается |
| `GET /v1/me/gomafia/aim` | Bearer | `{connected}` — подключён ли АИМ |
| `POST /v1/me/gomafia/aim` `{login, password}` | Bearer | Подключить АИМ отдельно (пароль АИМ другой или сменился). 422 `bad_credentials`, 403 `gomafia_required`; 5 попыток за 10 мин |
| `DELETE /v1/me/gomafia/aim` | Bearer | Отключить АИМ — пароль стирается |
| `GET /v1/tournaments` | Bearer | `{tournaments: [{id, title, dateStart, dateEnd, city, mainReferee, status, role}]}` — незавершённые турниры пользователя из АИМ; `role`: `editor` (АИМ открывает ему «Данные игр»), `referee`. 409 `aim_not_connected` / `aim_relogin_required`, 502 `aim_unavailable` |
| `GET /v1/tournaments/:id` | Bearer | `{tournament, role, games: [{number, stage, tables: [{number, refereeId, refereeName, isMine, win, seats: [{place, playerId, login, elo}], protocol?}]}]}`. Рассадка — с gomafia.pro. Редактор видит все столы и внесённые протоколы (`protocol`), судья — только свои столы. 404 — турнира нет в АИМ пользователя |
| `POST /v1/auth/review` `{login, password, deviceName, platform}` | — | Вход проверяющего App Store (логин `appreview`, пароль — `MAFBOARD_REVIEW_PASSWORD`, есть в заметках для App Review). Аккаунт без GoMafia, удалённый создаётся заново. Без пароля в .env — 404; лимит 10 попыток/10 мин на IP |
| `DELETE /v1/me` | Bearer | Удалить аккаунт (Профиль → «Удалить аккаунт», требование App Store): сессии, билеты, идущие и личные игры удаляются, игры клуба остаются в его истории без ведущего (`host_user_id = NULL`, без `setup.host`) |
| `GET /v1/gomafia/players?q=` | Bearer | Поиск (от 2 символов): сначала свой клуб (`isInHostClub`), затем общий, до 30 |
| `GET /v1/gomafia/players/:id` | Bearer | Игрок GoMafia |
| `GET /v1/gomafia/clubs/:id/players?page=` | Bearer | Состав клуба |
| `POST /v1/games` (GameRecord) | Bearer | 201 — сохранено, 200 — уже было (повтор безопасен), 409 — номер занят чужой игрой |
| `GET /v1/me/games?since=` | Bearer | Все игры ведущего, включая фанки |
| `GET /v1/clubs/:id/games?since=` | Bearer, участник клуба | История клуба |
| `POST /tg-webhook` | secret_token | Вебхук бота |
| `WS /v1/studio/relay` | Токен первым сообщением | Облачный канал пульта MafBoard Studio, см. ниже |
| `GET /v1/studio/settings` | Bearer | Настройки MafBoard Studio ведущего: `{revision, updatedAt, document, secrets}`. Ничего не сохранено — `revision: 0` и `null` |
| `PUT /v1/studio/settings` `{baseRevision, document, secrets}` | Bearer (600 записей в час) | `{revision}`. Сохранённая ревизия не равна `baseRevision` — 409 `revision_conflict` с `current` для слияния. До 512 КБ, секреты до 64 КБ |

Сессии `macos` и `windows` (MafBoard Studio) могут только читать `GET /v1/me` и читать и писать `/v1/studio/settings`, всё остальное отвечает 403 `desktop_session`. Это запрет по умолчанию в `requireUser` (`desktopAllowed`).

### Настройки MafBoard Studio (`studio.ts`)

`document` — коллекция профилей ведущего, как её видит MBS (качество, сцены, площадки, темы, каналы чатов, устройства); сервер хранит его как есть. `secrets` — ключи потоков площадок и ключ YouTube Data API: сервер шифрует их AES-256-GCM (`v1.<iv>.<tag>.<шифротекст>`) и отдаёт только самому ведущему. Ключ — `MAFBOARD_STUDIO_SECRETS_KEY` (32 байта в base64) или, если его нет, выведенный HKDF из `MAFBOARD_JWT_SECRET`. При смене JWT-секрета без своего ключа сохранённые секреты перестанут читаться (`secrets: null`), и MBS попросит ввести ключи заново. Это защита от утечки базы, но не от доступа к серверу: сквозное шифрование потребует хранить ключ в приложении на телефоне.

### Облачный канал пульта

WebSocket идёт мимо Hono: обработчик `upgrade` на HTTP-сервере в `relay.ts`, подключается из `apps/api/src/index.ts`. Сервер пересылает двоичные кадры между телефоном и ноутбуком одного ведущего и содержимое не читает: кадры зашифрованы сквозным ключом, который есть только у них. Адрес токена не содержит: первое сообщение `{"type":"auth","token","studioId","role"}`. Ответ `{"type":"ready","peerOnline"}`, затем `{"type":"peer","online"}` при появлении и пропаже второй стороны.

Комната — `userId:studioId`, по одному соединению на роль, роль следует из платформы сессии. Лимиты: кадр 64 КБ, 60 кадров в секунду на соединение, 60 подключений за 10 минут с адреса. Коды закрытия: 4400, 4401, 4403, 4409, 4429. Комнаты живут в памяти, поэтому при нескольких экземплярах API понадобится Redis. Сейчас контейнер `titan-api` один. Протокол и шифрование описаны в `docs/login-and-remote.md` репозитория MafBoard Studio.

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
| `mb_aim_credentials` | Вход в АИМ (логин и пароль шифротекстом) — для турниров GoMafia |
| `mb_users` | Telegram (`tg_id` уникален), телефон, версия соглашения, привязка GoMafia (`gomafia_id` уникален, профиль и клуб в `jsonb`) |
| `mb_login_tickets` | Билеты входа: хэш секрета устройства, шаг в боте, статус, срок |
| `mb_sessions` | Сессии устройств: имя и платформа из `start`, время входа, последней активности (не чаще раза в 5 минут и при каждом refresh), срок, отзыв |
| `mb_refresh_tokens` | SHA-256 refresh-токенов, отзыв и ротация; `session_id` — сессия, к которой выдан токен |
| `mb_studio_settings` | Настройки MafBoard Studio: ревизия, `document jsonb`, `secrets` — шифротекст (миграция `006`) |
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
- Пароль GoMafia проходит через сервер только для проверки входа, не логируется и не сохраняется. Исключение — вход в АИМ для турниров: протоколы в АИМ вносит сервер, поэтому логин и пароль АИМ хранятся в `mb_aim_credentials` шифротекстом AES-256-GCM (ключ выводится HKDF из ключа секретов студии, `aim.ts`), не попадают в ответы и логи и стираются при отвязке GoMafia и удалении аккаунта. Сессия АИМ живёт только в памяти сервера. Если входили по нику, ник найденного профиля должен совпасть с введённым.
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
