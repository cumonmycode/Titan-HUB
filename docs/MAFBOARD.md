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
| `GET /v1/me` | Bearer | `UserAccount`. Профиль GoMafia старше суток (или с неизвестным президентом клуба) обновляется в фоне. `goMafia`: `source: password \| club`, `access: president \| host \| none`, `club.presidentID`; `titan.isShared`; `clubRequest: {nickname, createdAt} \| null` — см. «Судьи клуба»; `clubs` — см. «Клубы»; `photoURL` — см. «Игроки клуба» |
| `POST /v1/me/gomafia` `{login, password}` | Bearer | Привязать GoMafia: вход в GoMafia проверяет владение, пароль GoMafia не хранится. Если тем же паролем открывается АИМ (admin.gomafia.pro), сохраняется вход в АИМ — для турниров GoMafia. 422 `bad_credentials`, 409 `gomafia_taken`. Привязку того же игрока по заявке (без пароля) у другого аккаунта вход паролем снимает |
| `DELETE /v1/me/gomafia` | Bearer | Отвязать — останутся только фанки; сохранённый вход в АИМ стирается |
| `GET /v1/me/gomafia/aim` | Bearer | `{connected}` — подключён ли АИМ |
| `POST /v1/me/gomafia/aim` `{login, password}` | Bearer | Подключить АИМ отдельно (пароль АИМ другой или сменился). 422 `bad_credentials`, 403 `gomafia_required`; 5 попыток за 10 мин |
| `DELETE /v1/me/gomafia/aim` | Bearer | Отключить АИМ — пароль стирается |
| `GET /v1/tournaments` | Bearer | `{tournaments: [{id, title, dateStart, dateEnd, city, mainReferee, status, role}]}` — незавершённые турниры пользователя из АИМ; `role`: `editor` (АИМ открывает ему «Данные игр»), `referee`. 409 `aim_not_connected` / `aim_relogin_required`, 502 `aim_unavailable` |
| `GET /v1/tournaments/:id` | Bearer | `{tournament, role, games: [{number, stage, tables: [{number, refereeId, refereeName, isMine, win, seats: [{place, playerId, login, elo}], protocol?}]}]}`. Рассадка — с gomafia.pro. Редактор видит все столы и внесённые протоколы (`protocol`), судья — только свои столы. 404 — турнира нет в АИМ пользователя |
| `POST /v1/tournaments/:id/protocols` `{gameNumber, tableNumber, win, seats: [{place, role, firstKill, selfKill, sheriffOpen, extraPoint, fine, fineDiscipline, replacement}]}` | Bearer | Протокол стола. Редактор: сразу в АИМ (`save_game_result`; стол — по номеру игры и стола, места — по номеру) → `{status: "saved"}`. Обычный судья своего стола: в очередь ГС → `{status: "pending", submission, reviewerUsesMafBoard}`, ГС получает сообщение в боте. 403 `not_your_table`, 409 `table_mismatch`; 120 в час |
| `GET /v1/tournaments/:id/protocols/mine` | Bearer | `{protocols: [TournamentSubmission]}` — свои отправки ГС: `status` `pending`/`saved`/`rejected`, `reason` |
| `GET /v1/tournaments/:id/protocols[?status=all]` | Bearer | Очередь ГС (по умолчанию — ждущие). 403 `editor_required` — не ГС |
| `POST /v1/tournaments/:id/protocols/:pid/approve` `{protocol?}` | Bearer | ГС вносит протокол судьи (можно с правками; игра и стол — из отправки) в АИМ от своего имени, судья получает сообщение в боте. 409 `already_decided` |
| `POST /v1/tournaments/:id/protocols/:pid/reject` `{reason}` | Bearer | ГС возвращает протокол с причиной; судья видит её и отправляет заново |
| `POST /v1/shares` `{gameID, snapshot}` | Bearer | Открытая ссылка на итоги игры: `{url}`. Снимок (`title, subtitle, winner, winnerText, reason, finishedAt, seats[{place, nickname, role, team, points, details}]`) считает приложение. Для той же игры — тот же адрес с новым снимком; до 64 КБ, 60 в час |
| `GET /s/:token` | — | Страница итогов по ссылке (HTML, `noindex`). Нет ссылки — 404 |
| `POST /v1/auth/review` `{login, password, deviceName, platform}` | — | Вход проверяющего App Store (логин `appreview`, пароль — `MAFBOARD_REVIEW_PASSWORD`, есть в заметках для App Review). Аккаунт без GoMafia, удалённый создаётся заново. Без пароля в .env — 404; лимит 10 попыток/10 мин на IP |
| `DELETE /v1/me` | Bearer | Удалить аккаунт (Профиль → «Удалить аккаунт», требование App Store): сессии, билеты, идущие и личные игры удаляются, игры клуба остаются в его истории без ведущего (`host_user_id = NULL`, без `setup.host`); если он действующий президент и сам подключал клуб Titan — подключение снимается, ключ отзывается в HUB |
| `GET /v1/gomafia/players?q=` | Bearer | Поиск (от 2 символов): сначала свой клуб (`isInHostClub`), затем общий, до 30 |
| `GET /v1/gomafia/players/:id` | Bearer | Игрок GoMafia |
| `GET /v1/gomafia/clubs/:id/players?page=` | Bearer | Состав клуба |
| `POST /v1/me/titan`, `DELETE /v1/me/titan` | — | С 4в — 426 `update_required`, см. «Снятые ручки». Подключение Titan — `PUT/DELETE /v1/clubs/:id/titan` |
| `GET /v1/club/hosts` | Bearer, президент клуба (60 в минуту) | `{club, hosts: [{player: GoMafiaPlayer, isResident, grantedAt, account: {name, username, source} \| null}], requests: [{id, player, account: {name, username}, createdAt}]}` — пул судей клуба и заявки судей без пароля GoMafia. 403 `president_only` |
| `PUT /v1/club/hosts/:gomafiaId` `{requestID?}` | Bearer, президент клуба (120 изменений в час) | Дать резиденту клуба вести игры; с `requestID` — подтвердить заявку: аккаунт заявителя привязывается к этому игроку (`source: club`). Ответ — как у `GET`. 404 `not_resident`, 404 `request_not_found`, 409 `gomafia_taken` |
| `DELETE /v1/club/hosts/:gomafiaId` | Bearer, президент клуба | Забрать доступ; привязка по заявке снимается вместе с ним. Ответ — как у `GET` |
| `DELETE /v1/club/requests/:id` | Bearer, президент клуба | Отклонить заявку. Ответ — как у `GET` |
| `PUT /v1/me/club-request` `{nickname}` | Bearer (5 в час) | Заявка судьи, который не помнит пароль GoMafia: ник, под которым он играет → `UserAccount` с `clubRequest`. Президент клуба с таким резидентом узнаёт о ней в боте. 409 `gomafia_linked` |
| `DELETE /v1/me/club-request` | Bearer | Отозвать заявку → `UserAccount` |
| `GET /v1/club/players`, `GET /v1/titan/players`, `PUT/DELETE /v1/titan/players/:id/gomafia` | — | С 4в — 426 `update_required`, см. «Снятые ручки». Замена — ручки клуба `/v1/clubs/:id/players` и `/v1/clubs/:id/titan/players*` |
| `POST /v1/games` (GameRecord) | Bearer | 201 — сохранено, 200 — уже было (повтор безопасен), 409 — номер занят чужой игрой, 403 `host_access_required` — резиденту клуба президент не дал доступа |
| `GET /v1/me/games?since=` | Bearer | Все игры ведущего, включая фанки |
| `GET /v1/clubs/:id/games?since=` | Bearer, член клуба | История клуба MafBoard (`:id` — uuid), см. «Клубы без GoMafia…». Числовой `:id` (номер клуба GoMafia) с 4в — 426 `update_required` |
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

### Клубы (`mb_clubs`)

Клуб — своя запись MafBoard: на неё ссылаются игры (`mb_games.club_ref`) и подключение Titan HUB, а клуб GoMafia
(`gomafia_club_id`) — одно из её подключений. Это первый шаг к клубам без GoMafia; целевая модель и этапы —
`ios/docs/ARCHITECTURE.md` репозитория MafBoard Studio, раздел «Клубы, игроки, подключения».

- Запись заводит `setGomafiaLink` для клуба из привязки. Полный снимок (с президентом) обновляет название и город,
  неполный (страница клуба не открылась, в привязке заглушка) их не трогает.
- Права по-прежнему считаются из GoMafia: президент — по снимку клуба в привязке, пул судей — `mb_club_hosts`.
- Подключение Titan принадлежит клубу (`titan_link`, `titan_linked_by` — кто подключил) и читается из него, см.
  «Titan Connect». Запись клуба не прочиталась — `hostAccess` берёт копию из записи президента, как до клубов
  (такие копии остались только от сборок до 4в: `PUT /v1/clubs/:id/titan` их не пишет).
- `UserAccount.clubs: [{id, name, city, role: owner | judge, goMafiaClubID, titan}]` — не больше одного клуба:
  президенту `owner`, судье пула `judge`, остальным пустой список. Запись клуба не прочиталась — список пустой,
  остальные поля аккаунта и права не страдают.
- Сверка (`reconcileMafboardClubs`, `migrations.ts`) выполняется при каждом старте после миграций и только
  дозаполняет пустое: клуб на каждый клуб GoMafia из привязок, пула судей и игр и `club_ref` играм клуба; повтор
  ничего не меняет. Миграция `012` создаёт только схему: сбой сверки на кривых данных не откатывает таблицу и не
  мешает старту. Подключение Titan сверка не трогает.

Клубы вводились двумя выпусками. В первом (на проде с 2026-11-22) данные появились, а Titan читался по-старому, из
записи президента; тогда же его подключения перенесены в клубы. Со второго Titan читается из клуба. В базе, не
прошедшей первый выпуск, клуб Titan нужно подключить заново: из личных записей в клуб он больше не переезжает.

### Клубы без GoMafia, участники и приглашения (`clubs.ts`, `clubAccess.ts`)

Клуб MafBoard создаётся и без GoMafia: `POST /v1/clubs {code}` — кодом Titan Connect, который выдаёт владелец клуба в
HUB; тот, кто ввёл код, — владелец клуба (`mb_clubs.owner_user_id` и запись `owner` в `mb_club_members`). Один клуб
Titan HUB (`apiBase`) — один клуб MafBoard: повтор — 409 `club_exists`, выданный ключ сразу отзывается; так же
отвечает `PUT /v1/clubs/:id/titan`, если этот HUB уже подключён к другому клубу.

Клубы пользователя (`UserAccount.clubs`, `HostAccess.clubs`) — клуб GoMafia (президент → `owner`, судья пула →
`judge`, как раньше) плюс записи `mb_club_members`. Судья вступает по ссылке-приглашению владельца:
`https://api.mafboard.com/club/join#t=<токен>` (Universal Link, путь `/club/join*` в `apple-app-site-association`;
без приложения — страница с кнопкой `mafboard://club/join#t=…`). Токен — после `#`: эта часть не уходит на сервер и
не попадает в журналы nginx. Ссылка действует 7 дней, многоразовая, отзывается; на сервере — только SHA-256 токена.
Убранный судья теряет право загружать игры клуба: его неотправленные игры с `clubRef` получат 403 и не попадут в
историю клуба. Пригласивший получает сообщение в боте. По приглашению можно вступить и в клуб
GoMafia — судьёй без своего GoMafia.

| Метод и путь | Кому | Что делает |
|---|---|---|
| `POST /v1/clubs {code}` | любой (10 за 10 мин) | Клуб по коду Titan Connect → 201 `{club: {id, name}, account}`. 409 `club_exists`, 422 `invalid_code` |
| `GET /v1/clubs/:id/members`, `DELETE …/members/:userId` | владелец | Участники `{members: [{userId, name, username, role, addedAt}]}`; себя убрать нельзя — 422 |
| `POST /v1/clubs/:id/invites`, `GET`, `DELETE …/invites/:inviteId` | владелец (30 в час) | Ссылка-приглашение → 201 `{id, url, expiresAt}`; список действующих (без ссылок) |
| `POST /v1/clubs/join {token}` | любой (20 в час) | Вступить судьёй → `UserAccount`. 404 `invite_not_found`, 410 `invite_expired` |
| `GET /v1/clubs/:id/players` | член клуба (60 в минуту) | `{club: {id, name}, players: [ClubPlayer], partial}` — состав клуба одним списком (см. «Игроки клуба») |
| `GET /v1/clubs/:id/games?since=` | член клуба | История клуба по `mb_games.club_ref`. Членство в клубе GoMafia перепроверяется по свежему снимку (`freshAccess`): ушедший из клуба историю не читает. Не uuid — 422; номер клуба GoMafia — 426 (снятая ручка) |
| `PUT /v1/clubs/:id/titan {code}`, `DELETE` | владелец; у клуба GoMafia — президент (10 за 10 мин) | Подключить Titan (впервые или заново — прежний ключ отзывается) → `UserAccount`, или отключить (ключ отзывается в HUB, копии в личных записях стираются). Права — по свежему клубу GoMafia. Судье — 403 `owner_only`, не члену клуба — 403 `club_access_required`; 409 `club_exists`, 422 `invalid_code`, 502 `titan_unavailable` |

Игра с `setup.host.clubRef` (uuid клуба MafBoard) принимается от члена этого клуба (иначе 403
`club_access_required`) и идёт в его историю, включая фанки; в рейтинг, миникап и турнир — игроки GoMafia, свои
игроки этого клуба (вместе с убранными: игру могли начать раньше) и, если к клубу подключён Titan, клиенты клуба.
Без `clubRef` — прежние правила (клуб GoMafia ведущего или личная история).

### Клуб без подключений (`clubApplications.ts`, `clubRoster.ts`, `clubBot.ts`)

Клуб без GoMafia и без Titan HUB создаётся по заявке: `POST /v1/clubs/applications {name, city}` уходит в бота
владельцу платформы (`MAFBOARD_ADMIN_TG_ID`) с кнопками «Одобрить» / «Отклонить». Решает только он; одобрение одной
операцией создаёт клуб, запись `owner` для заявителя и ставит ссылку заявки на клуб (повторное нажатие или
одновременное второе решение — «Заявка уже решена»). Заявителю бот пишет о решении. Открытая заявка у человека одна.
Без `MAFBOARD_ADMIN_TG_ID` или бота — 503 `applications_unavailable`.

Свои игроки клуба (`mb_club_players`) — ник и номер `6d616662-6370-8000-8000-<12 hex случайно>` («mafbcp»). Заводит,
переименовывает и убирает их только владелец клуба; ник в клубе один без учёта регистра; убранный остаётся в архиве,
и его ник снова свободен. В `GET /v1/clubs/:id/players` они идут после клиентов Titan и перед резидентами GoMafia
(`source: club`; у остальных `titan` или `gomafia`).

Фото игрока, загруженное в MafBoard (`mb_player_photos`), главнее фото из Titan HUB и GoMafia. Ставят его владелец и
судьи клуба (`PUT …/players/:playerID/photo`, тело — сама картинка, до 8 МБ; в nginx для этого пути отдельный предел)
и сам игрок через бота. Тип проверяется по байтам: JPEG, PNG, WebP. Файл кладётся в MinIO Titan HUB с новым именем на
каждую загрузку, поэтому у нового фото новый адрес и кэш студии его не держит. Фото можно поставить любому игроку
клуба — своему, GoMafia или Titan: номер проверяется по виду, свой игрок — ещё и по составу клуба.

Ссылка игрока (`POST …/players/:playerID/link`, владелец и судьи) — `https://t.me/<бот>?start=p_<токен>`: одноразовая,
7 дней, на сервере только SHA-256. Игрок открывает её — его Telegram привязывается к игроку клуба (`mb_player_links`,
прежняя привязка этого Telegram в том же клубе снимается). После этого фото, присланное в бота, ставится ему во всех
клубах, где он привязан. Из размеров Telegram берётся самый большой не шире 1280.

| Метод и путь | Кому | Что делает |
|---|---|---|
| `POST /v1/clubs/applications {name, city}` | любой (3 в сутки) | Заявка → 201 `{application}`. 409 `application_pending`, 503 `applications_unavailable` |
| `GET /v1/me/club-application` | любой | Последняя заявка `{application: {id, name, city, status: pending \| approved \| rejected, createdAt, decidedAt, clubId} \| null}` |
| `POST /v1/clubs/:id/players {nickname}` | владелец | Свой игрок → 201 `{player: {playerID, nickname, createdAt}}`. 409 `nickname_taken`, 422 `too_many_players` (500) |
| `PATCH /v1/clubs/:id/players/:playerID {nickname}`, `DELETE` | владелец | Переименовать, убрать в архив (только свои игроки) |
| `PUT /v1/clubs/:id/players/:playerID/photo`, `DELETE` | член клуба (60 в час) | Фото игрока → `{playerID, photoURL}`; снять — снова фото из HUB / GoMafia. 422 `invalid_photo`, 413 `too_large` |
| `POST /v1/clubs/:id/players/:playerID/link` | член клуба (30 в час) | Ссылка игрока на бота → 201 `{url, expiresAt}` |
| `GET /v1/clubs/:id/titan/players` | член клуба (60 в минуту) | `{club: {name}, players: [TitanPlayer]}` — все клиенты клуба Titan без удалённых, резиденты первыми. 409 `titan_not_linked` — к клубу не подключён Titan, 409 `titan_revoked` — клуб отключил MafBoard в HUB |
| `PUT …/titan/players/:clientId/gomafia {goMafiaID: число \| null}`, `DELETE` | член клуба (300 в час) | Ручное сопоставление клиента с GoMafia → `TitanPlayer`; `null` — у клиента нет GoMafia (номер в HUB неверный), `DELETE` — снова действует номер из HUB. 404 — нет такого клиента или игрока GoMafia |
| `POST /v1/clubs/:id/stream {id, status: live \| ended, title?, source?: mafboard \| studio, links: [{kind: watch \| donate, label, url}]}` | член клуба, с ноутбука тоже (120 в час) | Эфир клуба: сервер молча передаёт его в HUB клуба (Titan Connect `POST /streams`, право `streams:publish`). Публиковать ли ссылки через Tai, решают в HUB → `{ok, published}`. 409 `titan_not_linked`, `titan_scope_required` (в HUB у подключения не включены «Стримы»), `titan_revoked`; 422 — для `live` нет https-ссылки на трансляцию |

### Снятые ручки (выпуск 4в, `legacy.ts`)

MafBoard с 1.0 (22) ходит только в ручки клуба `/v1/clubs/:id/...`. Пути, которыми пользовались сборки до 22, не
удалены, а отвечают `426` с телом
`{"error": {"code": "update_required", "message": "Эта версия MafBoard устарела — обновите приложение в TestFlight"}}`
— старое приложение показывает этот текст. Вход не проверяется: ответ один для всех, данные не меняются.

| Снятый путь | Замена |
|---|---|
| `GET /v1/club/players` | `GET /v1/clubs/:id/players` |
| `POST /v1/me/titan {code}`, `DELETE /v1/me/titan` | `PUT /v1/clubs/:id/titan {code}`, `DELETE /v1/clubs/:id/titan` |
| `GET /v1/titan/players` | `GET /v1/clubs/:id/titan/players` |
| `PUT/DELETE /v1/titan/players/:id/gomafia` | `PUT/DELETE /v1/clubs/:id/titan/players/:clientId/gomafia` |
| `GET /v1/clubs/<номер клуба GoMafia>/games` | `GET /v1/clubs/<uuid клуба MafBoard>/games` |

Загрузка игр не снята: `POST /v1/games` без `clubRef` принимается по прежним правилам — в офлайн-очереди старых
сборок могут лежать неотправленные игры.

### Titan Connect (`titan.ts`, `titanRoutes.ts`)

Клуб Titan HUB даёт судьям клуба своих клиентов как игроков через собственный API Titan Connect
([TITAN_CONNECT.md](TITAN_CONNECT.md)). Владелец клуба выдаёт код в HUB («Интеграции» → «Titan Connect»), президент
клуба GoMafia (владелец клуба MafBoard) вводит его в приложении — `PUT /v1/clubs/:id/titan {code}`, где `:id` — клуб
из `UserAccount.clubs` с `role: owner`; клуб без GoMafia подключается сразу при создании (`POST /v1/clubs {code}`).
Сервер меняет код на ключ (`POST <MAFBOARD_TITAN_CONNECT_URL>/exchange`, по умолчанию
`https://titanpos.ru/api/connect/v1`). `apiBase` из ответа принимается только на домене этого адреса или его
поддомене. Подключение принадлежит клубу MafBoard: ключ хранится в `mb_clubs.titan_link` шифротекстом тем же
ключом, что секреты студии, и в приложение не уходит. Ручки клуба — основные; прежние `POST/DELETE /v1/me/titan`,
`GET /v1/titan/players` и `PUT/DELETE /v1/titan/players/:id/gomafia` с 4в отвечают 426 `update_required`
(«Снятые ручки»). Копию в `mb_users.titan_link` подключившего писал только `/v1/me/titan`: старые копии ещё
читаются, если запись клуба не прочиталась, и стираются при отключении клуба и удалении аккаунта.

Подключает и отключает клуб только его владелец: у клуба GoMafia это действующий президент (судье пула — 403
`owner_only`, не члену клуба — 403 `club_access_required`). Права считаются по свежему клубу (`freshAccess`),
потому что `requireUser` снимок GoMafia не освежает: бывший президент с устаревшим снимком клуб не подключит и не
отключит. Подключение одно на клуб: судьям его пула клиенты клуба достаются без кода (`titan.isShared: true`).
Смену президента оно переживает — новый президент и судьи видят клиентов клуба дальше; подключивший, переставший
быть президентом, отключить клуб уже не может (до 4в мог через `DELETE /v1/me/titan`). Удалился аккаунт
действующего президента, который сам подключал клуб, — подключение снимается, как до клубов; в остальных случаях
клуб подключение сохраняет. Ключ при этом отзывается в HUB (в фоне), копии в личных записях стираются; так же
отзывается прежний ключ, когда клуб подключают заново. Личная запись не-президента, оставшаяся с тех времён, когда
клуб Titan подключал любой ведущий, ни на что не влияет; её ключ отзывается при удалении аккаунта, если им не
пользуется ни один клуб.

Клиенты читаются целиком (`GET /clients`, страницы по 200, до 2000), кэш на 5 минут по `apiBase`. Если Titan не
ответил, отдаётся последний состав; отозванный ключ — всегда 409 `titan_revoked`.

`TitanPlayer`: `id` (клиент HUB), `playerID`, `nickname`, `fullName`, `avatarURL`, `statusLabel`, `isResident`,
`goMafiaID`, `goMafiaSource: hub | manual | null`. `playerID` с GoMafia — `PlayerID.goMafia` (тот же игрок, что
в GoMafia); без GoMafia — `6d616662-7463-8000-8000-` + первые 12 hex SHA-256(`apiBase|id`): постоянный для
клиента клуба на всех устройствах. Ручное сопоставление (`mb_titan_matches`, ключ `apiBase + id клиента`) общее
для всех ведущих клуба и важнее номера из HUB: ник в GoMafia часто другой, а в POS бывает чужой номер.

### Игроки клуба (`clubPlayers.ts`)

`GET /v1/clubs/:id/players` (член клуба, `:id` — клуб из `UserAccount.clubs`) — клиенты клуба Titan HUB (если клуб
подключён), свои игроки клуба и резиденты клуба GoMafia (если клуб из GoMafia) одним списком, без повторов: клиент с
номером GoMafia (из HUB или ручного сопоставления) и резидент с тем же номером — один игрок. Сначала клиенты Titan
(резиденты, затем по нику), потом свои игроки клуба, потом резиденты GoMafia, которых среди клиентов нет (по ELO).
Прежний `GET /v1/club/players` (клуб GoMafia ведущего без id в адресе) с 4в отвечает 426 `update_required`.

`ClubPlayer`: `playerID` (те же правила, что у `TitanPlayer`), `nickname`, `fullName`, `photoURL`, `titanClientID`,
`goMafiaID`, `isResident`, `statusLabel`, `isVerified` (у игрока есть аккаунт MafBoard), `elo` (из GoMafia).

Фото у игрока одно: своё фото клиента в HUB, иначе аватар его игрока GoMafia (Titan отдаёт `photoUrl` уже в порядке
HUB → Telegram → GoMafia из HUB). Фото HUB при замене получает новый адрес, у аватара GoMafia адрес постоянный —
поэтому MafBoard Studio перепроверяет фото с диска условным запросом раз за запуск.

Один источник не ответил — отдаётся второй и `partial: true`; оба (или единственный) — ошибка того источника
(сначала Titan). Кэш — кэши составов Titan и GoMafia (5 минут).

`UserAccount.photoURL` — фото самого пользователя по тому же правилу: клиент Titan его клуба с его номером GoMafia
и своим фото, иначе аватар GoMafia, без GoMafia — `null`. В `GET /v1/me` состав Titan берётся только из кэша: его
нет — читается в фоне, а в ответе пока аватар GoMafia. В остальных ответах с аккаунтом — аватар GoMafia.

### Судьи клуба (`clubHosts.ts`)

Рейтинговые игры клуба GoMafia ведут его президент и судьи, которых он добавил в пул (`mb_club_hosts`).
Президента сервер берёт из GoMafia: `club.president_id` на странице клуба → `goMafia.club.presidentID`;
президент — тот, чей привязанный паролем игрок совпадает с ним. Клуб перечитывается при каждом обновлении
профиля, поэтому смена президента в GoMafia доходит за сутки. В пул попадают только резиденты клуба
(состав — со страницы клуба входом президента). Права считаются на каждый запрос (`hostAccess`):

| `goMafia.access` | Кто | Что может |
|---|---|---|
| `president` | игрок — президент своего клуба, привязка паролем | все режимы, пул судей, подключение Titan HUB |
| `host` | резидент из пула президента | все режимы; клиенты клуба Titan — если президент его подключил |
| `none` | остальные | только фанка |

**Судья без пароля GoMafia.** Он оставляет заявку с ником (`PUT /v1/me/club-request`); президент клуба, в
составе которого есть такой ник, получает сообщение в боте и видит заявку с именем и @username из Telegram.
Подтверждение (`PUT /v1/club/hosts/:id` с `requestID`) привязывает аккаунт MafBoard к игроку без входа в
GoMafia (`mb_users.gomafia_link_source = 'club'`) и добавляет его в пул: президент ручается, что это он.
Такая привязка держится на пуле — забрали доступ, и она снята; вход настоящего владельца паролем её тоже
снимает. Своего пароля у судьи нет, а GoMafia отдаёт данные только вошедшим, поэтому за судью пула сервер
ходит в GoMafia входом президента (`sessionDelegate` в `GoMafiaSessions`). Турниры GoMafia (АИМ) такому судье
недоступны: там нужен собственный вход.

### Права ведущего (проверяет `POST /v1/games`)

| Аккаунт | Режимы | Куда идёт игра |
|---|---|---|
| Без GoMafia или без клуба | только фанка (игроки — кто угодно) | личная история |
| Резидент клуба без доступа от президента (`access: none`) | только фанка; рейтинг — 403 `host_access_required` | личная история |
| Президент клуба или судья его пула | все режимы; в рейтинг, миникап и турнир — только игроки GoMafia и, если президент подключил клуб Titan HUB, его клиенты (`playerID` с префиксом `mafbtc`), гостей нет | история клуба |

Старые сборки приложения поля `access` не читают и считают права по наличию клуба: резиденту без доступа
они покажут все режимы, но рейтинговую игру сервер не примет.

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
| `mb_tournament_protocols` | Протоколы обычных судей турниров, ждущие ГС: статус, причина отказа, кто решил |
| `mb_shares` | Открытые ссылки на итоги игр: токен и снимок итогов |
| `mb_aim_credentials` | Вход в АИМ (логин и пароль шифротекстом) — для турниров GoMafia |
| `mb_users` | Telegram (`tg_id` уникален), телефон, версия соглашения, привязка GoMafia (`gomafia_id` уникален, профиль и клуб в `jsonb`) |
| `mb_login_tickets` | Билеты входа: хэш секрета устройства, шаг в боте, статус, срок |
| `mb_sessions` | Сессии устройств: имя и платформа из `start`, время входа, последней активности (не чаще раза в 5 минут и при каждом refresh), срок, отзыв |
| `mb_refresh_tokens` | SHA-256 refresh-токенов, отзыв и ротация; `session_id` — сессия, к которой выдан токен |
| `mb_studio_settings` | Настройки MafBoard Studio: ревизия, `document jsonb`, `secrets` — шифротекст (миграция `006`) |
| `mb_users.titan_link` | Копия подключения Titan у того, кто подключил клуб (действует подключение из `mb_clubs`), либо личная запись прежних времён: `apiBase`, название, права, `tokenSealed` — ключ Titan Connect шифротекстом (миграция `007`) |
| `mb_titan_matches` | Ручные сопоставления клиентов Titan с GoMafia: `api_base`, `client_id`, `gomafia_id` (`NULL` — «нет GoMafia»), кто и когда (миграция `007`) |
| `mb_club_hosts` | Пул судей клуба: `club_id` и `gomafia_id` (ключ), ник на момент выдачи, кто и когда дал доступ (миграция `011`) |
| `mb_club_requests` | Заявки судей без пароля GoMafia: одна на пользователя, ник и время (миграция `011`) |
| `mb_users.gomafia_link_source` | Как подтверждена привязка GoMafia: `password` (или `NULL` у старых) — входом, `club` — заявкой, которую подтвердил президент |
| `mb_games` | Игры: ведущий, клуб (`NULL` — личная), формат, даты, `record jsonb` — GameRecord приложения целиком |
| `mb_clubs` | Клубы MafBoard: название, город, `gomafia_club_id` (уникален; `NULL` — клуб без GoMafia), `titan_link` — подключение Titan Connect клуба (действует у президента и судей пула), `titan_linked_by` — кто подключил, `owner_user_id` — владелец клуба без GoMafia (создал его кодом Titan или по заявке) (миграция `012`) |
| `mb_games.club_ref` | Клуб MafBoard игры; заполняется по `club_id` (миграция `012`) |
| `mb_club_members` | Члены клуба: владелец клуба без GoMafia и судьи по приглашению, роль `owner` / `judge` (миграция `013`) |
| `mb_club_invites` | Приглашения в клуб: SHA-256 токена, кто и когда создал, срок, отзыв (миграция `013`) |
| `mb_club_applications` | Заявки на клуб без подключений: кто, название, город, статус, когда решена, созданный клуб; открытая заявка у человека одна (миграция `014`) |
| `mb_club_players` | Свои игроки клуба: номер «mafbcp», ник (уникален в клубе среди действующих), кто завёл, архив (миграция `014`) |
| `mb_player_photos` | Фото игроков клуба, загруженные в MafBoard: адрес в MinIO, кто поставил — аккаунт или Telegram игрока (миграция `014`) |
| `mb_player_link_tokens`, `mb_player_links` | Ссылки игрока на бота (SHA-256 токена, срок, использована) и привязки игрока клуба к Telegram (миграция `014`) |

Истёкшие билеты, сессии и токены удаляются раз в сутки, через 30 дней после истечения.
Миграция `002_mafboard_sessions` превратила существующие цепочки refresh-токенов в сессии (id — `md5` хэша первого токена цепочки, устройство — из него же).

## Безопасность

- Токен бота — только в `MAFBOARD_BOT_TOKEN` на сервере, в приложение он не попадает.
- Привязка GoMafia без пароля (`source: club`) появляется только после подтверждения президентом клуба заявки с тем же ником, что у резидента его клуба. Она не делает пользователя президентом, не даёт входа в АИМ, снимается вместе с доступом и уступает входу настоящего владельца паролем. Пул и заявки видит и меняет только президент, заявки — только своего клуба (по нику в составе).
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
