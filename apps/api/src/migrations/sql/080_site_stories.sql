-- 080: публикации сайта клуба — турниры, вечеринки, мероприятия с фото.
-- Ведутся из HUB («Сайт → Публикации»), сайт показывает опубликованные на
-- /portfolio и /<slug>. Фото — ссылки (загрузка в MinIO или файлы сайта /media/…),
-- полная галерея — ссылка на папку Google Drive. Аддитивно, на всех БД.
CREATE TABLE IF NOT EXISTS site_stories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  tagline text,
  kind text NOT NULL DEFAULT 'tournament', -- tournament | party | event
  event_date date,
  body text,                               -- абзацы через пустую строку
  stats jsonb NOT NULL DEFAULT '[]',       -- [{ value, label }]
  cover_url text,
  photos jsonb NOT NULL DEFAULT '[]',      -- [url]
  results_url text,
  gallery_url text,
  is_published boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS site_stories_pub_idx ON site_stories (is_published, event_date DESC);
