-- 089: СММ — аналитика по API площадок, прогноз и факт публикации, шкала готовности
-- генерации и фотоархив клуба (публичная папка Google Диска). Аддитивно, на всех БД.
--
-- smm_posts.progress   — что Tai делает сейчас и сколько осталось (шкала в приложении).
-- smm_posts.forecast   — прогноз охвата: считается по похожим постам площадки,
--                        замораживается в момент выхода, чтобы честно сравнить с фактом.
-- smm_posts.ext_id     — id публикации в соцсети (Instagram media id) — по нему цифры.
-- smm_platform_posts   — все публикации площадок (и не от Tai) с цифрами: из них прогноз,
--                        лучшее время, сравнение форматов и топ.
-- smm_library_folders  — альбомы фотоархива; smm_library — фото и видео архива с
--                        описанием: Tai ищет нужное по описанию и берёт только найденное.

ALTER TABLE smm_posts ADD COLUMN IF NOT EXISTS progress jsonb;
ALTER TABLE smm_posts ADD COLUMN IF NOT EXISTS forecast jsonb;
ALTER TABLE smm_posts ADD COLUMN IF NOT EXISTS ext_id text;
ALTER TABLE smm_plans ADD COLUMN IF NOT EXISTS progress jsonb;

ALTER TABLE smm_account_stats ADD COLUMN IF NOT EXISTS reach integer;
ALTER TABLE smm_account_stats ADD COLUMN IF NOT EXISTS new_followers integer;

CREATE TABLE IF NOT EXISTS smm_platform_posts (
  account_id uuid NOT NULL REFERENCES smm_accounts(id) ON DELETE CASCADE,
  ext_id text NOT NULL,                -- id сообщения канала или медиа Instagram
  platform text NOT NULL,              -- telegram | instagram
  format text NOT NULL DEFAULT 'post', -- post | carousel | story | reel
  published_at timestamptz,
  caption text NOT NULL DEFAULT '',
  permalink text,
  thumb_url text,
  views integer,
  reach integer,
  likes integer,
  comments integer,
  shares integer,
  saves integer,
  reactions integer,
  interactions integer,
  post_id uuid REFERENCES smm_posts(id) ON DELETE SET NULL,
  stats_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, ext_id)
);
CREATE INDEX IF NOT EXISTS smm_platform_posts_at_idx ON smm_platform_posts (account_id, published_at);

CREATE TABLE IF NOT EXISTS smm_library_folders (
  drive_id text PRIMARY KEY,
  parent_id text,
  path text NOT NULL DEFAULT '',
  title text NOT NULL DEFAULT '',
  kind text NOT NULL DEFAULT 'photos', -- photos | template | logo | brand
  about text NOT NULL DEFAULT '',      -- что в альбоме, одной-двумя фразами
  files integer NOT NULL DEFAULT 0,
  seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS smm_library (
  drive_id text PRIMARY KEY,
  folder_id text,
  path text NOT NULL DEFAULT '',       -- альбом: «Sport / Photodump / Society Mafia Cup 2025»
  name text NOT NULL DEFAULT '',
  mime text NOT NULL DEFAULT '',
  kind text NOT NULL DEFAULT 'photo',  -- photo | video | template | logo | design
  description text NOT NULL DEFAULT '',
  tags text NOT NULL DEFAULT '',       -- ключи направлений и сцен через пробел
  people smallint,
  quality smallint,                    -- 1–5: годится ли для соцсетей
  orientation text,                    -- portrait | landscape | square
  used_count integer NOT NULL DEFAULT 0,
  last_used_at timestamptz,
  described_at timestamptz,
  seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  search tsvector GENERATED ALWAYS AS (to_tsvector('russian', path || ' ' || description || ' ' || tags)) STORED
);
CREATE INDEX IF NOT EXISTS smm_library_folder_idx ON smm_library (folder_id);
CREATE INDEX IF NOT EXISTS smm_library_search_idx ON smm_library USING gin (search);
