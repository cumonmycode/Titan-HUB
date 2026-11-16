-- 092: Titan Connect — свой API для сторонних сервисов (данные клиентов клуба).
--
-- Подключение = одна строка connect_connections. Владелец создаёт её в HUB и получает
-- одноразовый код (живёт 10 минут). Сторонний сервис меняет код на постоянный ключ
-- доступа (POST /api/connect/v1/exchange) — ключ хранится у сервиса, у нас только его
-- sha256. Ключ бессрочный: повторно подключаться не нужно, пока подключение не отозвано.
--
-- Прогоняется на ВСЕХ клуб-БД и основной БД — аддитивно (IF NOT EXISTS).
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS connect_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Название, которое дал владелец («Сайт турниров», «Бот рейтинга»).
  name text NOT NULL,
  -- Права: clients:read, clients:photos, clients:contacts, clients:balance, clients:visits.
  scopes text[] NOT NULL DEFAULT '{}',
  -- pending — ждёт ввода кода в стороннем сервисе; active — ключ выдан; revoked — отключено.
  status text NOT NULL DEFAULT 'pending',
  -- Что сервис сообщил о себе при обмене кода.
  service_name text,
  service_url text,
  -- Одноразовый код (sha256) и срок; обнуляются при обмене.
  code_hash text,
  code_expires_at timestamptz,
  -- Постоянный ключ доступа (sha256) и его начало для показа в HUB.
  token_hash text,
  token_prefix text,
  token_issued_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  connected_at timestamptz,
  last_used_at timestamptz,
  last_ip text,
  request_count bigint NOT NULL DEFAULT 0,
  revoked_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS connect_connections_code_uq ON connect_connections (code_hash) WHERE code_hash IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS connect_connections_token_uq ON connect_connections (token_hash) WHERE token_hash IS NOT NULL;

-- Синхронизация «что изменилось с прошлого раза»: время последнего изменения профиля.
-- Ставится триггером при любом UPDATE (имя, фото, баланс, удаление — всё попадает в ленту).
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS profiles_updated_at_idx ON profiles (updated_at, id);

CREATE OR REPLACE FUNCTION profiles_touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS profiles_touch_updated_at ON profiles;
CREATE TRIGGER profiles_touch_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  WHEN (OLD IS DISTINCT FROM NEW)
  EXECUTE FUNCTION profiles_touch_updated_at();
