-- 090: СММ — база знаний Tai. Аддитивно, на всех БД.
--
-- smm_knowledge    — разделы базы знаний: 'club' — портрет клуба (текст владельца +
--                    то, что Tai собрал из сайта, GoMafia и соцсетей), 'socials' — что
--                    уже было в Telegram и Instagram клуба (рубрики, голос, что заходило).
-- smm_zones        — помещения клуба (вход, коридор, кабинки, зал): фото с разных
--                    ракурсов + описание владельца + описание Tai по фото. По ним Tai
--                    рисует картинки и видео «в нашем клубе», а не в выдуманном.
-- smm_dates        — свои даты клуба (день рождения клуба, турниры-традиции): Tai ставит
--                    на них тематические посты так же, как на праздники.
-- smm_platform_posts.search — поиск по прошлым постам площадок: Tai смотрит, как уже
--                    писали на похожую тему, и не повторяется.

CREATE TABLE IF NOT EXISTS smm_knowledge (
  key text PRIMARY KEY,                       -- club | socials
  owner_text text NOT NULL DEFAULT '',
  ai_text text NOT NULL DEFAULT '',
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,    -- источники и счётчики последнего разбора
  progress jsonb,
  error text,
  ai_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS smm_zones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  sort integer NOT NULL DEFAULT 0,
  owner_text text NOT NULL DEFAULT '',
  ai_text text NOT NULL DEFAULT '',
  anchor text NOT NULL DEFAULT '',            -- то же по-английски, коротко: опора для промптов видео
  progress jsonb,
  error text,
  ai_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS smm_zone_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id uuid NOT NULL REFERENCES smm_zones(id) ON DELETE CASCADE,
  url text NOT NULL,
  sort integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS smm_zone_photos_zone_idx ON smm_zone_photos (zone_id, sort);

-- Помещения клуба по умолчанию — только если зон ещё нет.
INSERT INTO smm_zones (title, sort)
SELECT z.title, z.sort FROM (VALUES ('Вход', 1), ('Коридор', 2), ('Маленькая кабинка', 3), ('Основной зал', 4), ('Большая кабинка', 5)) AS z(title, sort)
WHERE NOT EXISTS (SELECT 1 FROM smm_zones);

CREATE TABLE IF NOT EXISTS smm_dates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  day text NOT NULL,                          -- MM-DD (каждый год) или YYYY-MM-DD (один раз)
  title text NOT NULL,
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT smm_dates_day_chk CHECK (day ~ '^([0-9]{4}-)?[0-9]{2}-[0-9]{2}$')
);

ALTER TABLE smm_platform_posts ADD COLUMN IF NOT EXISTS search tsvector
  GENERATED ALWAYS AS (to_tsvector('russian', coalesce(caption, ''))) STORED;
CREATE INDEX IF NOT EXISTS smm_platform_posts_search_idx ON smm_platform_posts USING gin (search);
