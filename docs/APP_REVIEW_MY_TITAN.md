# My Titan — ответ App Review (Guideline 2.1, Information Needed)

Отправлять с билдом **1.3.0 (11)** или новее: в нём есть удаление аккаунта (Профиль → «Удалить аккаунт»), без которого Apple отклонит приложение с регистрацией.

Ниже — текст на английском: вставить в ответ в App Store Connect и в поле **App Review Information → Notes**. Видео записывается на iPhone (сценарий — в конце, на русском) и прикладывается к ответу.

---

## Текст ответа (English)

Hello, and thank you for the review. Please find the requested information below.

**1. Screen recording**
A screen recording captured on a physical iPhone running the latest iOS is attached. It starts with launching the app and shows: onboarding, permission screens, sign-in by phone number with confirmation in Telegram, new account registration, the main screens (club card, bonuses, deposit, history, receipts), an online payment and account deletion (Profile → "Удалить аккаунт" / Delete account). The app has no user-generated content and no paid digital content.

**2. Purpose and target audience**
My Titan is the companion app for guests of Titan, an offline game club in Russia. It replaces paper loyalty cards and cash settlements: guests see their club card, loyalty bonus balance and expiry, deposit or debt with the club, visit history and receipts, and can pay their deposit, debt or club membership fees online. The target audience is the club's guests (any adult can register in the app); it is a consumer app, not an internal tool for employees.

**3. How to access the app**
- **Demo mode (no account needed):** on the first screen tap «Посмотреть демо» (View demo). The full app opens with sample data: club card, bonuses, history, receipts, notifications, profile and the payment flow.
- **Real account:** sign-in is by phone number with confirmation in the club's Telegram bot (@titanwalletrobot). A new guest fills in a short form (photo, nickname, name, date of birth) and confirms registration in Telegram; club staff then approve the registration. Because confirmation requires a Telegram account linked to the phone number, please use demo mode to review the features. If you need a live account, we will provide one on request.
- **Account deletion:** Profile → «Удалить аккаунт» (Delete account). It deletes the app account: sign-in on all devices, notifications and app data. The club keeps its own customer and payment records, which Russian accounting law requires; the user can ask the club to remove them.

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

1. **Запуск** My Titan с домашнего экрана.
2. **Знакомство:** пролистать три страницы, нажать «Начать».
3. **Разрешения:** «Уведомления» → «Включить уведомления» → системный запрос → «Разрешить»; «Камера» → «Разрешить доступ к камере».
4. **Регистрация** (номер, которого нет в клубе): «Ваш телефон» → номер → анкета (снять фото, ник, имя, день рождения) → «Продолжить» → «Подтвердить в Telegram» → в боте «✅ Да, подтвердить» → «Открыть приложение» → вход. Показать плашку «Регистрация на проверке».
5. **Подтверждение клубом:** в HUB → «Клиенты» → «Подтвердить» (можно с другого устройства; в видео достаточно, что плашка исчезла).
6. **Основное:** главная — карта (наклонить телефон), бонусы, депозит; «История» → открыть чек; уведомления (колокольчик); «Профиль» → «Вид карты».
7. **Оплата:** «Пополнить» → сумма → оплата через СБП (дойти до банка; оплачивать необязательно).
8. **Выход и вход существующим клиентом:** «Выйти» → номер существующего клиента → «Подтвердить в Telegram» → «✅ Да» → «Открыть приложение».
9. **Удаление аккаунта:** «Профиль» → «Удалить аккаунт» → «Удалить» → экран входа. Показать, что повторный вход по этому номеру сейчас закрыт (сообщение «Войти снова можно с …»).
10. **Демо:** на первом экране «Посмотреть демо» — коротко показать, что всё работает без входа.
