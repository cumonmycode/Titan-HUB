# Клиентское приложение My Titan

Приложение для клиентов клуба на iOS и Android: бонусы, депозит и долг, история операций, онлайн-оплата через СБП (депозит, долг, фонд клуба и разовые сборы) и уведомления. Expo SDK 57 (React Native 0.86), без WebView.

- **Код:** `apps/client`
- **iOS:** `ru.titan.resident` (только iPhone), команда Apple `G99YH9UK8C`, App Store Connect app id `6816426909`, TestFlight-группа «Titan Team»
- **Android:** `ru.titan.resident`
- **Сервер:** основной клуб `https://titanpos.ru` (`extra.apiUrl` в `app.json`)
- **Вход:** Telegram-бот My Titan `@titanwalletrobot`
- **Название:** My Titan (до октября 2026 — Titan Resident). Технические идентификаторы прежние, чтобы не ломать установленные приложения и ссылки: bundle ID и пакет `ru.titan.resident`, scheme `titanresident`, slug `titan-resident`, веб-версия по пути `/residents`.

Оформление — фирменное тёмное Titan (фиолетово-чёрный фон, violet-акцент, голо-карта, как у веб-версии `apps/wallet`), всегда тёмное. С версии 1.1.0 (октябрь 2026) интерфейс собран из нативных элементов iOS 26 — Liquid Glass в цветах Titan (см. «Интерфейс» ниже). Приложение, как и `apps/mobile`, ставит зависимости своим `npm` и исключено из pnpm-воркспейса и Docker-контекста.

## Интерфейс (1.1.0)

- **Логика (1.1.0, по просьбе владельца — без дублей):** три вкладки — Главная, История, Профиль; у каждого действия одно место. Бонусная программа — нажатие на голо-карту (срок сгорания — строкой на карте). Пополнение — кнопка «Пополнить» у депозита. Долг и взносы — блок «К оплате», у каждого своя кнопка (оплаченный ежемесячный взнос — «Вперёд»). Уведомления — колокольчик с бейджем в шапке главной (шторка `notifications`). Правка профиля — «Изменить» в шапке профиля. Шторка оплаты открывается под конкретный платёж, выбора назначения в ней нет.
- **Вкладки (iOS):** системный таб-бар `NativeTabs` (Liquid Glass, сворачивается при прокрутке вниз), выбранная вкладка — лавандовая.
- **Вкладки (Android):** своя плавающая капсула `components/tab-bar.tsx`.
- **Шапки:** у каждой вкладки свой `Stack` (`components/tab-stack.tsx`): прозрачная шапка с крупным заголовком и размытием края (`scrollEdgeEffects`), кнопки — `Stack.Toolbar` (например, «Изменить» в профиле). На Android заголовок рисуется в контенте (`ScreenTitle`).
- **Фон:** статичные пятна света `backdrop` из `lib/theme.ts` — стилем контейнера экрана (`contentStyle`), не отдельным слоем: размытие края iOS ищет ScrollView первым ребёнком экрана.
- **Стекло — только слой управления** (правило iOS 26): `components/glass.tsx` — `GlassButton`, `GlassIconButton`, `GlassChip`, кнопка камеры в профиле; плюс системные таб-бар, шапки и шторки. Карточки, группы списков, чек — `Surface` из `components/ui.tsx` (полупрозрачная поверхность с мягким бликом и `tone` для смыслового цвета). Стекло на контенте и особенно внутри стеклянных шторок выглядело мутным — убрано в 1.1.0 (8). Внутри шторок чипы — `GlassChip flat`. Без iOS 26 (Android, старые iPhone) стекло кнопок заменяется полупрозрачными поверхностями бренда.
- **Углы** — `borderCurve: 'continuous'` (squircle iOS) у поверхностей, плашек значков и голо-карты.
- **Шторки:** `formSheet` с ручкой (`components/sheet.tsx`); на iOS 26 фон — системное стекло с фиолетовым отсветом. Высота: `pay` — во весь экран (клавиатура суммы), `check/[id]` и `notifications` — 70 % с подъёмом до полной, `bonus-rules` и `profile-edit` — `fitToContents` (по содержимому: без `flex: 1` и прокрутки в корне). На Android — полноэкранное окно снизу.
- **Иконки:** `components/icon.tsx` — смысловые имена, SF Symbols на iOS (не новее SF Symbols 4), Ionicons на Android.
- **Списки и формы:** `components/list.tsx` — секции как «Настройки» iOS на стекле, системный `Switch`; сегмент «Все / Деньги / Бонусы» — `UISegmentedControl`.

---

## Экраны

| Экран | Что делает |
| --- | --- |
| `login` | Вход через Telegram, запасной 4-значный код, демо-режим |
| `(tabs)/(home)/index` — Главная | Голо-карта с бонусами (→ бонусная программа), депозит с кнопкой «Пополнить», «К оплате» (долг и взносы), прогресс до «Резидента», 3 последние операции; колокольчик уведомлений в шапке |
| `(tabs)/history/index` — История | Все операции по дням, фильтр «Все / Деньги / Бонусы», догрузка |
| `(tabs)/profile/index` — Профиль | Фото, личные данные (правка — «Изменить» в шапке), настройки уведомлений, клуб, выход |
| `notifications` | Шторка уведомлений по колокольчику; при открытии помечаются прочитанными |
| `pay` | Оплата конкретного платежа (`purpose`, `collectionId` в параметрах): сумма, комиссия банка 8 %, СБП, ожидание подтверждения |
| `check/[id]` | Чек: позиции, скидки, итог, способы оплаты |
| `profile-edit`, `bonus-rules` | Правка данных; правила бонусной программы |

Оплата открывается с главной: «Пополнить» у депозита или «Оплатить» в блоке «К оплате».

## Вход через бота

1. `POST /api/auth/wallet-code/start {deviceName, platform}` → `ticket`, 4-значный `code`, `deepLink` = `https://t.me/titanwalletrobot?start=login_<deepCode>` (код длинный и одноразовый, живёт 5 минут).
2. Приложение открывает Telegram (`tg://resolve…`, иначе `t.me`). Бот присылает «Вход в My Titan — подтвердите вход на устройстве «iPhone 16»» с кнопками **«Да, войти»** и **«Это не я»**. Подтверждение нужно, чтобы пересланная злоумышленником ссылка не дала ему доступ.
3. Приложение раз в 2 секунды и при возврате из Telegram опрашивает `GET /api/auth/wallet-code/status?ticket=` → `ok` (JWT на 30 дней) / `rejected` / `expired` (тогда код тихо перевыпускается).
4. Если Telegram на другом устройстве, можно отправить боту 4-значный код, как в веб-версии.

Сессия скользящая: раз в 3 дня приложение меняет токен на свежий через `POST /api/resident/session/refresh`. Это доступно только роли `client`.

## Серверное API (`apps/api/src/modules/resident`)

| Метод | Назначение |
| --- | --- |
| `GET /api/resident/wallet` | Сводка одним запросом: профиль, статус (из тарифов), баланс, бонусы и ближайшее сгорание, правила бонусов, прогресс, взносы, готовность онлайн-оплаты, непрочитанные, настройки |
| `GET /api/resident/feed?kind=all\|money\|bonus&cursor=` | Лента операций (transactions + bonus_history), курсор `<ISO>\|<id>` |
| `GET /api/resident/collections` | Состояние сборов клиента (та же арифметика «пула», что в ростере `/collections/:id`) |
| `GET /api/resident/notifications`, `POST …/read` | Лента уведомлений, отметка прочитанного |
| `POST/DELETE /api/resident/devices` | Push-токен устройства: iPhone — нативный токен APNs, Android — токен Expo Push |
| `PATCH /api/resident/prefs` | Push / Telegram / новости клуба |
| `POST /api/auth/me/payments {purpose, amount, collectionId?}` | Онлайн-платёж; `collectionId` — любой активный сбор, в котором клиент участвует |
| `POST /api/client-broadcasts`, `…/audience`, `GET` | Рассылки из панели (владелец — всем / по статусу / должникам / с депозитом / по опросу; сотрудник — только выбранным) |
| `GET /api/client-broadcasts/recipients` | Клиенты для выборочной отправки: есть ли приложение и привязанный Telegram |
| `GET /api/client-broadcasts/polls` | Последний опрос каждого чата: голоса по вариантам, сколько из них клиенты, «не голосовали». Аудитория `poll: {chatId, options[], notVoted}` |

Миграция `062_client_app.sql`: `app_devices`, `client_notifications`, `client_broadcasts`, колонки входа в `wallet_login_codes`, настройки `client_push_enabled` / `client_news_enabled` в `profiles`.

## Уведомления

`notifyClient()` (`modules/notifications/client.ts`) шлёт каждое событие по трём независимым каналам:
- в ленту приложения (всегда);
- push, если есть устройство и включён push: iPhone — напрямую в Apple (`modules/notifications/apns.ts`, HTTP/2 + ключ .p8), Android — через Expo Push;
- сообщением от бота My Titan, если привязан Telegram.

Автоматические события: начисление и списание бонусов, пополнение депозита, погашение и появление долга, зачисление онлайн-оплаты, статус «Резидент». Рассылки идут с `kind='news'`: клиент может их отключить.

Нажатие на push ведёт по `meta.screen`: `check` → чек, `pay` → оплата, `history`, `home`, иначе «Входящие».

## Демо-режим

Кнопка «Посмотреть демо» на экране входа. Все запросы обслуживает `src/lib/demo.ts`, сеть не нужна. Оплата «проходит» через 2–3 секунды и меняет баланс. Режим нужен:
- для проверки в App Store и Google Play: у проверяющего нет Telegram, привязанного к клубу;
- для скриншотов;
- для знакомства с приложением.

## Что нужно сделать владельцу

1. **Push на iPhone:** в `.env` сервера — ключ APNs команды G99YH9UK8C (один на все приложения команды): `APNS_KEY_P8` (base64 от файла `AuthKey_<ID>.p8` или PEM с `\n`), `APNS_KEY_ID`, `APNS_TEAM_ID`; `APNS_TOPIC` по умолчанию `ru.titan.resident`. Без ключа push на iPhone не уходят (в логе API — `[apns] … не заданы`), лента и бот работают. Сервер шлёт в боевой APNs, а токены отладочных сборок сам переадресует в песочницу.
   **Push на Android (позже):** в `apps/client` выполнить `npx eas-cli login`, `npx eas-cli init` (пропишет `extra.eas.projectId` в `app.json`) и `npx eas-cli credentials` — загрузить ключ FCM V1 из Firebase и положить `google-services.json` рядом с `app.json` (`android.googleServicesFile`). Необязательно: `EXPO_ACCESS_TOKEN` в окружение API — защищённый режим Expo Push.
2. **App Store Connect:** приложение создано и заполнено (тексты, скриншоты, рейтинг 4+, App Privacy, бесплатно во всех странах). Новые сборки — `npm run ios:testflight`; в `app.json` включён плагин `with-scene-lifecycle` (обязателен для iOS 27).
3. **Переименование в My Titan:** название в App Store Connect (App Information → Name; оно уникально в App Store — если «My Titan» занято, подойдёт, например, «My Titan Club») и имя бота `@titanwalletrobot` в @BotFather (`/setname`) меняются вручную. Подпись под иконкой на телефоне берётся из `app.json` и сменится со следующей сборкой; `upload-testflight.sh` сам пересоздаст Xcode-проект под новое имя (`ios/MyTitan`).
4. **Проверка App Store:** в заметках для проверяющего указать, что вход только через Telegram клуба, а полное демо открывается кнопкой «Посмотреть демо».

## Сборка

```bash
cd apps/client
npm install
npm run typecheck && npm run lint
npx expo export --platform ios && npx expo export --platform android
npm run android:device      # Release APK → эмулятор/телефон (scripts/install-android.sh)
npm run ios:testflight      # архив → App Store Connect (scripts/upload-testflight.sh)
```

Зеркала Maven и прочие сетевые обходы — те же, что у `apps/mobile` (см. `docs/MOBILE.md`).
