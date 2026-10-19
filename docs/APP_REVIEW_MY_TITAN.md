# My Titan — отправка на App Review (Guideline 2.1, Information Needed)

## Что отправлять

- **Сборка 1.4.0 (15).** В ней есть удаление аккаунта (Профиль → «Удалить аккаунт»), без которого Apple отклонит приложение с регистрацией, — и в демо-режиме тоже (ревьюер смотрит именно демо). 1.4.0 (12) не отправлять — падала при вращении карты; в (13) удаление скрыто в демо; в (14) в «Виде карты» обрезалась тень.
- В App Store Connect сейчас версия **1.0.0** в статусе Rejected с прикреплённой сборкой 1.0.0 (3). Сборку 1.4.0 к версии 1.0.0 не прикрепить — номер версии нужно поменять на **1.4.0**.
- Видео с iPhone, текст ответа (ниже, на английском) и свежие скриншоты.

## Порядок действий

> **Статус на 12.10.2026:** шаг 3 уже сделан через App Store Connect API — версия 1.4.0, сборка 1.4.0 (15), шесть новых скриншотов 6,9″ (снято в симуляторе, демо-режим), описание с названием My Titan, примечания (текст ниже), «Требуется вход» снят. Осталось: видео (загрузить в «Вложение» и приложить к ответу), «Конфиденциальность приложения» (шаг 4), ответ App Review (шаг 5) и «Отправить на проверку» (шаг 6).

1. **Дождаться обработки 1.4.0 (15)** (письмо «has completed processing», 5–30 минут). Поставить из TestFlight, покрутить карту — убедиться, что не падает.
2. **Снять видео** по сценарию в конце файла (на iPhone, iOS последней версии). Обрезать начало/конец в «Фото». Длина — 3–5 минут.
3. **App Store Connect → Приложения → My Titan → вкладка «Распространение»** → слева версия «1.0.0 Отклонено»:
   - поле **«Версия»** — заменить 1.0.0 на **1.4.0**;
   - **скриншоты** iPhone 6,7″ — заменить: сейчас там дизайн от 26 сентября (вкладки «Оплатить» и «Входящие», которых больше нет) — Apple отклоняет за несоответствие (2.3.3);
   - **описание** — начинается со старого названия «Titan Resident» → заменить на «My Titan»;
   - блок **«Сборка»** — удалить сборку 3, нажать «+» и выбрать **1.4.0 (15)**;
   - **«Информация для проверки приложения»**: «Требуется вход» — снять (есть демо-режим); в **«Примечания»** вставить текст ответа (ниже) целиком вместо старого (старый пишет, что вход только для клиентов, привязанных администратором — это уже неправда); в **«Вложение»** загрузить видео;
   - нажать **«Сохранить»**.
4. **Слева «Конфиденциальность приложения»** — проверить, что указаны собираемые данные (теперь есть саморегистрация): Контактные данные → Имя, Номер телефона; Пользовательский контент → Фото (фото профиля); Идентификаторы → ID пользователя; Покупки → История покупок (чеки, визиты); Финансовая информация → Другая финансовая информация (бонусы, депозит, долг); Другие данные → дата рождения. Всё — «связано с пользователем», «отслеживание» — нет. После правки — «Опубликовать».
5. **Ответить в переписке с App Review**: слева «Проверка приложения» (App Review) → сообщение по отклонению → «Ответить». Вставить тот же текст ответа и приложить видео.
6. **Отправить на проверку**: на странице версии 1.4.0 — «Добавить для проверки» → «Отправить на проверку».

Обычно проверка занимает 1–2 дня. Если придёт новый вопрос — пришлите его текст целиком.

---

## Текст ответа (English)

Вставить и в ответ App Review, и в поле «Примечания» (до 4000 символов — укладывается).

Hello, and thank you for the review. Please find the requested information below. We have submitted build 1.4.0 (15), which adds in-app account deletion.

**1. Screen recording**
A screen recording captured on a physical iPhone running the latest iOS is attached. It starts with launching the app and shows: onboarding, permission screens, new account registration with confirmation in Telegram, the main screens (club card, bonuses, deposit, history, receipts), an online payment and account deletion (Profile → "Удалить аккаунт" / Delete account). The app has no user-generated content and no paid digital content.

**2. Purpose and target audience**
My Titan is the companion app for guests of Titan, an offline game club in Russia. It replaces paper loyalty cards and cash settlements: guests see their club card, loyalty bonus balance and expiry, deposit or debt with the club, visit history and receipts, and can pay their deposit, debt or club membership fees online. The target audience is the club's guests (any adult can register in the app); it is a consumer app, not an internal tool for employees.

**3. How to access the app**
- **Demo mode (no account needed):** on the first screen tap «Посмотреть демо» (View demo). The full app opens with sample data: club card, bonuses, history, receipts, notifications, profile and the payment flow.
- **Real account:** sign-in is by a Russian (+7) phone number with confirmation in the club's Telegram bot (@titanwalletrobot). A new guest fills in a short form (photo, nickname, name, date of birth) and confirms registration in Telegram; club staff then approve the registration. Because confirmation requires a Telegram account registered to that phone number, please use demo mode to review the features. If you need a live account, we will provide one on request.
- **Account deletion:** Profile → «Удалить аккаунт» (Delete account) — the button is also available in demo mode. It deletes the app account: sign-in on all devices, notifications and app data. The club keeps its own customer and payment records, which Russian accounting law requires; the user can ask the club to remove them.

**4. External services**
- Telegram Bot API — confirms sign-in and registration (the user taps "Yes" in the club's bot).
- Apple Push Notification service — notifications about bonuses, payments and the club.
- Faster Payments System (SBP) via the club's acquiring bank and payment gateway (Platega) — online payments for club services; the payment opens in the user's bank app; the app never handles card data.
- The club's own backend (titanpos.ru) stores the data. No AI services, advertising or third-party analytics are used.

**5. Regional differences**
The app is in Russian and intended for guests of the club in Russia. Online payments use SBP, which works with Russian banks. Otherwise the app functions the same in all regions.

**6. Regulated industries and third-party material**
The app does not sell digital content. Payments are for real-world services consumed at the club (deposits, debts, membership fees), so In-App Purchase does not apply (Guideline 3.1.3(e)). Payments are processed by a licensed bank through SBP. The app contains no protected third-party material.

Thank you!

---

## Сценарий видео (снимать на iPhone, iOS последней версии)

Запись экрана: Пункт управления → «Запись экрана». Начинать до запуска приложения, с домашнего экрана iPhone.

**Для регистрации и удаления нужен тестовый номер**, которого нет в клубе, и Telegram на этом номере (вторая SIM, номер родственника). Свой аккаунт в видео не удалять: удаление ставит в HUB пометку «удалил аккаунт My Titan» и закрывает вход по этому номеру на 24 часа. После съёмки тестового клиента можно отправить в архив в HUB.

1. **Запуск** My Titan с домашнего экрана (если приложение уже стояло — удалить и поставить заново из TestFlight, чтобы показать знакомство и разрешения).
2. **Знакомство:** пролистать три страницы, нажать «Начать».
3. **Разрешения:** «Уведомления» → «Включить уведомления» → системный запрос → «Разрешить»; «Камера» → «Разрешить доступ к камере».
4. **Регистрация** (тестовый номер): «Ваш телефон» → номер → анкета (снять фото, ник, имя, день рождения) → «Продолжить» → «Подтвердить в Telegram» → в боте «✅ Да, подтвердить» → «Открыть приложение» → вход. Показать плашку «Регистрация на проверке».
5. **Подтверждение клубом:** в HUB → «Клиенты» → «Подтвердить» (с другого устройства; в видео достаточно, что плашка исчезла после обновления).
6. **Основное:** главная — карта (наклонить телефон, крутнуть свайпом, нажать → «Бонусная программа»), депозит; «История» → открыть чек; уведомления (колокольчик); «Профиль» → «Вид карты».
7. **Оплата:** «Пополнить» → сумма → оплата через СБП (дойти до банка; оплачивать необязательно).
8. **Удаление аккаунта:** «Профиль» → «Удалить аккаунт» → «Удалить» → экран входа. Ввести тот же номер — показать, что вход сейчас закрыт (сообщение «Войти снова можно с …»).
9. **Демо:** на первом экране «Посмотреть демо» — коротко показать, что всё работает без входа.

## Ответ на Guideline 5.1.1(iv) — разрешения (отказ 2026-10-12, 1.4.0 (15) → версия 1.5.0 (19))

Претензия: перед системным запросом камеры был свой экран с кнопкой «Разрешить доступ к камере» и кнопкой «Не сейчас», которая позволяла уйти мимо запроса. Исправлено в `apps/client/src/components/login/onboarding-steps.tsx`: на экранах «Уведомления» и «Камера» одна кнопка «Продолжить», которая всегда открывает системный запрос; «Не сейчас» и «Назад» убраны, тексты без «Разрешите/Включите». С главной убрана карточка «Включить / Не сейчас» для уведомлений (включаются переключателем в профиле).

Порядок (сделано через API 2026-10-19): версия 1.4.0 переименована в 1.5.0, прикреплена сборка 1.5.0 (19) (собрана финальным Xcode 27.0: сборки Xcode 27.1 27A9269 — бета, Apple не пускает их на ревью), пояснение — в начале примечаний для проверяющего, версия отправлена на проверку. Ответ в переписке App Review API не умеет — текст ниже вставляется вручную.

```
Hello,

Thank you for the review. We have updated the permission flow in version 1.5.0 (build 19):

- The screens shown before the camera and notification permission requests now have a single "Продолжить" ("Continue") button that always proceeds to the system permission request.
- The "Не сейчас" ("Not now") and back buttons were removed from these screens, so the user can no longer close the message and delay the request.
- The explanatory text no longer asks users to allow access; it only explains what the permission is used for. The final decision is made in the system dialog.
- The in-app banner suggesting to enable notifications was removed.

The camera is used only to take a profile photo during registration. If access is denied, the app shows a short note with a link to the Settings app when the user chooses to take a photo.

Thank you!
```

