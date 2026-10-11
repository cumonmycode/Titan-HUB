-- 076: вход в My Titan по номеру телефона и регистрация нового клиента.
--
-- Приложение отправляет номер → API ищет профиль по телефону и создаёт строку
-- wallet_login_codes (mode='login', или mode='register' с анкетой). Клиент
-- открывает бота по t.me/<bot>?start=app_<deep_code>: бот запоминает, кто открыл
-- ссылку (tg_id), и подтверждает вход/регистрацию — кнопками «Да/Нет», если этот
-- Telegram уже привязан к профилю, иначе контактом (Telegram сам сообщает номер
-- аккаунта, так проверяется, что номер принадлежит клиенту).
--
-- • phone    — номер из приложения, нормализованный (+7XXXXXXXXXX).
-- • mode     — 'login' | 'register'; NULL — прежний вход по коду (веб-кошелёк,
--              старые сборки приложения), его логика не меняется.
-- • reg_data — анкета нового клиента {nickname, fullName, birthday, photoUrl}.
-- • tg_id    — Telegram, который открыл ссылку: от него ждём подтверждение.
-- • note     — причина отказа, которую покажет приложение.
--
-- Идемпотентно, на всех БД клубов.

ALTER TABLE wallet_login_codes ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE wallet_login_codes ADD COLUMN IF NOT EXISTS mode text;
ALTER TABLE wallet_login_codes ADD COLUMN IF NOT EXISTS reg_data jsonb;
ALTER TABLE wallet_login_codes ADD COLUMN IF NOT EXISTS tg_id text;
ALTER TABLE wallet_login_codes ADD COLUMN IF NOT EXISTS note text;
CREATE INDEX IF NOT EXISTS wallet_login_codes_tg_pending_idx ON wallet_login_codes (tg_id) WHERE status = 'pending';
