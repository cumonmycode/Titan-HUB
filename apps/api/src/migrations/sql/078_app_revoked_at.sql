-- 078: удаление аккаунта My Titan самим клиентом (App Store 5.1.1(v)).
--
-- profiles.app_revoked_at — сессии приложения, выданные раньше этого момента,
-- недействительны на всех устройствах (не сбрасывается).
-- profiles.app_deleted_at — пометка в HUB «клиент удалил аккаунт My Titan»; 24 часа
-- после неё вход в приложение по этому номеру запрещён, при следующем входе снимается.
-- Карточка клиента в HUB (имя, телефон, бонусы, депозит, история) не меняется.
--
-- Идемпотентно, на всех БД клубов.

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS app_revoked_at timestamptz;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS app_deleted_at timestamptz;
