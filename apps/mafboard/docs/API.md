# API сервера MafBoard — контракт

Контракт между iOS-приложением (`MafBoardClient`) и сервером MafBoard.

**Сервер — модуль Titan HUB** в этом же монорепозитории: `apps/api/src/modules/mafboard`,
документация модуля — [docs/MAFBOARD.md](../../../docs/MAFBOARD.md). Приложение (`apps/mafboard`) —
отдельная сборка и общается с сервером только по этому контракту.

Зачем нужен сервер:
- **токен бота** можно держать только на сервере, из приложения его легко извлечь;
- **у GoMafia нет публичного API**: запросы, кэш и защита от изменений вёрстки — на сервере, тогда при поломке GoMafia чинится сервер, а не выпускается новая версия приложения;
- **история клуба** общая для всех ведущих клуба.

## Общее

- Базовый адрес: `https://mafboard.titanpos.ru/api/mafboard` (`MafBoardAPIClient(baseURL:)`). Все пути ниже начинаются с `/v1`.
- Ссылка возврата из бота: `https://mafboard.titanpos.ru/auth/return?ticket=<id>`. В приложении — bundle ID `ru.titan.mafboard` (команда `G99YH9UK8C`, как у ru.titan.hub), entitlement `applinks:mafboard.titanpos.ru`, URL-схема `mafboard` и `LoginReturnLink.ticketID(from:allowedHosts: ["mafboard.titanpos.ru"])`. Файл `/.well-known/apple-app-site-association` уже отдаётся на поддомене; если Universal Link не сработал, страница возврата ведёт на `mafboard://auth/return`.
- Тела запросов и ответов — JSON, `camelCase`. Даты — ISO 8601 с миллисекундами (`2026-10-16T21:00:00.000Z`).
- Авторизация: `Authorization: Bearer <accessToken>`. Access-токен живёт 1 час, refresh-токен — 90 дней (каждое обновление выдаёт новый refresh). Приложение хранит токены в Keychain.
- Формат ошибки: `{"error": {"code": "bad_credentials", "message": "Неверный логин или пароль GoMafia"}}`.
  Ответы Titan HUB вне модуля (404 неизвестного пути, 500) приходят как `{"error": "текст"}` — клиент понимает оба.
  Коды HTTP: 400/422 — неверные данные, 401 — нужен новый токен, 403 — нет прав, 404, 409 — конфликт, 429 — лимит запросов.

## Вход через Telegram-бота

```
Приложение                     Сервер                          Бот (Telegram)
    │ POST /auth/telegram/start  │                                  │
    │  {deviceName, platform,    │ билет на 10 мин,                 │
    │   deviceSecret}            │ хэш секрета устройства           │
    │◄── {id, deepLink, expiresAt}                                  │
    │ открыть t.me/<бот>?start=login_<код> ───────────────────────► │
    │                            │◄──────── /start login_<код> ─────│
    │                            │  1. Пользовательское соглашение  │
    │                            │     [Принимаю] [Отказаться]      │
    │                            │  2. [📱 Поделиться номером]      │
    │                            │     (request_contact)            │
    │ показать код сверки «47»   │  3. «Нажмите код из приложения»  │
    │                            │     [18] [47] [93] [Это не я]    │
    │                            │  билет подтверждён ─────────────►│
    │                            │  4. [Вернуться в MafBoard] =     │
    │◄─── https://<домен>/auth/return?ticket=<id>  (Universal Link) │
    │ POST /auth/telegram/complete {ticket, deviceSecret}           │
    │◄── {tokens, account}                                          │
```

Если пользователь вернулся в приложение сам, без кнопки, приложение спрашивает
`GET /auth/telegram/status` при каждом выходе на экран и завершает вход по статусу `confirmed`.
Логику на стороне приложения ведёт `TelegramLoginFlow` в ядре.

### Требования к боту

1. **`/start login_<код>`.** `<код>` — случайная строка до 64 символов `[A-Za-z0-9_-]`, не совпадающая с id билета. Первый Telegram-аккаунт, открывший код, закрепляется за билетом. Если тот же код откроют с другого аккаунта, вход отклоняется.
2. **Соглашение.** Бот присылает текст со ссылкой на полную версию и кнопки «Принимаю» / «Отказаться». Сохраняются версия соглашения и время согласия. Если версия уже принята, шаг пропускается.
3. **Номер телефона.** Бот показывает reply-клавиатуру с одной кнопкой `request_contact: true`. Принимается только свой контакт: `message.contact.user_id == message.from.id`, иначе можно переслать чужой. Номер приводится к E.164 и хранится только на сервере. Приложение получает его в маске. После шага клавиатура убирается.
4. **Подтверждение сверкой кода.** `start` возвращает `confirmationCode` — две цифры, приложение показывает их крупно. Бот пишет «Подтвердите вход на устройстве «<deviceName>»: нажмите код, который показан в приложении». Под сообщением три кнопки с кодами (настоящий и два ложных, порядок случайный) и «Это не я».
   - Неверный код или «Это не я» переводят билет в `rejected`.
   - Зачем: иначе злоумышленник может прислать свою ссылку входа, и жертва одним нажатием отдаст ему сессию.
   - `deviceName` очищается от ссылок и служебных символов.
5. **Возврат в приложение.** Бот присылает inline-кнопку с URL `https://<домен>/auth/return?ticket=<id>`. Telegram разрешает в кнопках только `http(s)` и `tg://`, поэтому нужен Universal Link: файл `/.well-known/apple-app-site-association` с путём `/auth/return*` и entitlement `applinks:<домен>` в приложении. Если приложение не установлено, по этому адресу должна открываться страница со ссылкой на App Store.

### Безопасность

- Токен бота хранится только в переменной окружения сервера (`MAFBOARD_BOT_TOKEN`). Webhook проверяет заголовок `X-Telegram-Bot-Api-Secret-Token`.
- Билет одноразовый, живёт 10 минут. `complete` требует тот же `deviceSecret`, что был в `start` (на сервере хранится его SHA-256). Перехваченная ссылка из Telegram без секрета бесполезна.
- Лимит: не больше 20 вызовов `start` за 10 минут с одного IP.
- Номер телефона — персональные данные (152-ФЗ): хранить на серверах в РФ, обработка должна быть прописана в соглашении.
- Из российских дата-центров `api.telegram.org` может быть недоступен. Готовое решение — relay через Cloudflare, как `infra/telegram-relay` в Titan-HUB.

### Эндпоинты входа

| Метод и путь | Авторизация | Тело | Ответ |
|---|---|---|---|
| `POST /v1/auth/telegram/start` | — | `{deviceName, platform, deviceSecret}` | `LoginTicket {id, deepLink, expiresAt}` |
| `GET /v1/auth/telegram/status?ticket=` | — | — | `{status: pending\|confirmed\|rejected\|expired, opened?, note?}` |
| `POST /v1/auth/telegram/complete` | — | `{ticket, deviceSecret}` | `AuthSession {tokens, account}` |
| `POST /v1/auth/refresh` | — | `{refreshToken}` | `AuthTokens`. Refresh одноразовый; повтор старого отзывает все сессии |
| `POST /v1/auth/logout` | — | `{refreshToken}` | `{ok: true}` |
| `GET /v1/me` | Bearer | — | `UserAccount` |

## GoMafia

### Привязка аккаунта

`POST /v1/me/gomafia {login, password}` → `UserAccount`.

1. Сервер вызывает `POST https://gomafia.pro/api/user/login {login, password}`. Ответ: `result`, `sessionToken`, `user.id`, `user.club_id`, при ошибке — `errorDesc`.
2. Так подтверждается владение аккаунтом. Пароль не сохраняется, `sessionToken` выбрасывается: в Titan-HUB его так же не хранят.
3. Сервер подтягивает профиль и клуб, сохраняет `gomafiaId`, клуб и время синхронизации.
4. Если этот `gomafiaId` уже привязан к другому пользователю — 409 `gomafia_taken`. Неверный пароль — 422 `bad_credentials`.

`DELETE /v1/me/gomafia` отвязывает аккаунт. После этого ведущему доступна только фанка.

Профиль и клуб обновляются при входе в приложение, если с прошлой синхронизации прошло больше 24 часов. Если игрок сменил клуб, меняется и история, в которую уходят его игры.

### Подбор игроков

| Метод и путь | Ответ |
|---|---|
| `GET /v1/gomafia/players?q=<2+ символа>` | `{players: [GoMafiaPlayer]}`: сначала участники клуба ведущего (`isInHostClub: true`), затем общий поиск, без повторов, до 30 |
| `GET /v1/gomafia/players/{id}` | `GoMafiaPlayer` |
| `GET /v1/gomafia/clubs/{id}/players?page=` | `{players}` — состав клуба |

`GoMafiaPlayer`: `id, nickname, fullName?, avatarURL?, elo?, clubID?, clubTitle?, city?, tournamentsPlayed?, isInHostClub`.

### Как сервер ходит в GoMafia

Готовая реализация — `apps/api/src/lib/gomafia.ts` в Titan-HUB. Её стоит перенести целиком.

| Что | Запрос | Откуда берутся поля |
|---|---|---|
| `buildId` Next.js | `GET https://gomafia.pro/` (HTML, `"buildId":"…"`) | кэш 10 мин; при 404 — перечитать |
| Поиск | `POST /api/user/getTop {search, limit: 20, offset: 0, sortType: "elo", sortOrder: "DESC"}` | `data[]` |
| Профиль | `GET /_next/data/{buildId}/stats/{id}.json` + `x-nextjs-data: 1` | `pageProps.serverData.user` |
| Клуб и состав | `GET /_next/data/{buildId}/club/{id}.json?page=N` | `pageProps.serverData.{club, residents, residentsTotal}` |

Заголовки: User-Agent десктопного Chrome, `Origin`/`Referer: https://gomafia.pro`, таймаут 12 с.
Перевод полей: `id→id`, `login→nickname`, `first_name + last_name→fullName`, `avatar_link→avatarURL`, `club_id→clubID`, `title`/`club_title→clubTitle`, `tournaments_played→tournamentsPlayed`.
Кэш: состав клуба — 5 минут, профили — 30 минут. Если GoMafia ответила ошибкой, отдаётся последнее закэшированное значение.

Статистики по ролям в известных ответах GoMafia нет: Titan-HUB берёт только ELO и число турниров. Если нужна статистика по ролям, придётся изучить полный JSON страницы `stats/{id}`.

## История игр

| Метод и путь | Авторизация | Тело / ответ |
|---|---|---|
| `POST /v1/games` | Bearer | `GameRecord` → 201. Повтор с тем же `setup.gameID` — 200 без изменений: офлайн-очередь можно повторять |
| `GET /v1/me/games?since=` | Bearer | `{games: [GameRecord]}` — все игры, которые провёл ведущий, включая фанки |
| `GET /v1/clubs/{id}/games?since=` | Bearer, участник клуба | `{games}` — история клуба |

Что сервер проверяет при `POST /v1/games`:
- `setup.host.userID` совпадает с владельцем токена;
- если формат не фанка, у ведущего привязан GoMafia, `setup.host.clubID` — его текущий клуб, и у всех игроков есть `PlayerID`, выведенный из GoMafia (`PlayerID.goMafia`);
- `schemaVersion` поддерживается.

Сервер на Swift может дополнительно переиграть `log` движком `MafBoardCore` и сверить итог.

Фанки без GoMafia уходят в личную историю ведущего, в историю клуба — нет.
