-- 084: СММ и маркетинг — Tai ведёт Telegram-канал и Instagram клуба.
-- Аддитивно, на всех БД. Настройки раздела — app_settings.smm_settings (JSON).
--
-- smm_accounts  — площадки клуба: канал Telegram (Tai публикует сам), Instagram и др.
--                 (ссылки для аналитики); последние цифры — в stats.
-- smm_account_stats — снимок площадки за день: подписчики, просмотры, вовлечённость.
-- smm_plans     — план на месяц: стратегия, цели, рубрики.
-- smm_posts     — публикация на одной площадке (пост, карусель, сторис, рилс):
--                 идея → черновик → на одобрении → одобрен → опубликован.
-- smm_media     — картинки и видео публикации (сгенерированные или загруженные);
--                 у генерации есть статус — видео делается минуты.
-- smm_comments  — замечания сотрудников и ответы Tai по посту или плану.
-- smm_memory    — память Tai: голос бренда, правила, выводы из аналитики.
-- smm_reports   — отчёты аналитики с выводами и рекомендациями.
-- smm_spend     — расходы на нейросети (бюджет месяца).
-- smm_assets    — фото клуба (интерьер, логотип, игры) — опора для картинок.

CREATE TABLE IF NOT EXISTS smm_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform text NOT NULL,              -- telegram | instagram | vk | other
  title text NOT NULL,
  url text,
  handle text,                         -- @username без «@»
  tg_chat_id text,                     -- id канала для публикации (telegram)
  can_publish boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  followers integer,
  stats jsonb NOT NULL DEFAULT '{}'::jsonb,
  stats_at timestamptz,
  stats_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS smm_account_stats (
  account_id uuid NOT NULL REFERENCES smm_accounts(id) ON DELETE CASCADE,
  day date NOT NULL,
  followers integer,
  views integer,
  posts integer,
  engagement numeric(6, 2),
  source text NOT NULL DEFAULT 'auto', -- auto | screenshot | manual
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (account_id, day)
);

CREATE TABLE IF NOT EXISTS smm_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  month text NOT NULL UNIQUE,          -- YYYY-MM
  status text NOT NULL DEFAULT 'draft', -- draft | active
  summary text NOT NULL DEFAULT '',
  goals jsonb NOT NULL DEFAULT '[]'::jsonb,
  pillars jsonb NOT NULL DEFAULT '[]'::jsonb,
  busy text,                           -- что Tai делает с планом сейчас
  busy_at timestamptz,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS smm_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid REFERENCES smm_plans(id) ON DELETE SET NULL,
  account_id uuid REFERENCES smm_accounts(id) ON DELETE SET NULL,
  platform text NOT NULL,              -- telegram | instagram
  format text NOT NULL DEFAULT 'post', -- post | carousel | story | reel
  status text NOT NULL DEFAULT 'idea', -- idea | draft | review | approved | published | skipped | failed
  publish_at timestamptz,
  topic text NOT NULL,
  pillar text,
  direction text,
  brief text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  visual text NOT NULL DEFAULT '',     -- что изобразить (бриф картинки/видео)
  script jsonb,                        -- сценарий рилса: зацепка, кадры, звук, кто снимает
  assignee_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  approved_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  approved_at timestamptz,
  review_sent_at timestamptz,
  handoff_at timestamptz,
  reminded_at timestamptz,
  remind_count integer NOT NULL DEFAULT 0,
  published_at timestamptz,
  published_url text,
  tg_message_id bigint,
  stats jsonb NOT NULL DEFAULT '{}'::jsonb,
  stats_at timestamptz,
  busy text,                           -- text | image | video | revise
  busy_at timestamptz,
  error text,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS smm_posts_publish_idx ON smm_posts (publish_at);
CREATE INDEX IF NOT EXISTS smm_posts_status_idx ON smm_posts (status, publish_at);
CREATE INDEX IF NOT EXISTS smm_posts_plan_idx ON smm_posts (plan_id);

CREATE TABLE IF NOT EXISTS smm_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES smm_posts(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'image',  -- image | video
  source text NOT NULL DEFAULT 'ai',   -- ai | upload
  status text NOT NULL DEFAULT 'done', -- pending | done | failed
  url text,
  aspect text,
  prompt text,
  model text,
  polza_id text,
  cost_rub numeric(10, 2) NOT NULL DEFAULT 0,
  error text,
  selected boolean NOT NULL DEFAULT true,
  sort integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS smm_media_post_idx ON smm_media (post_id, sort);
CREATE INDEX IF NOT EXISTS smm_media_pending_idx ON smm_media (status) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS smm_comments (
  id bigserial PRIMARY KEY,
  post_id uuid REFERENCES smm_posts(id) ON DELETE CASCADE,
  plan_id uuid REFERENCES smm_plans(id) ON DELETE CASCADE,
  author_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  author_name text,
  role text NOT NULL DEFAULT 'staff',  -- staff | tai
  text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS smm_comments_post_idx ON smm_comments (post_id, id);
CREATE INDEX IF NOT EXISTS smm_comments_plan_idx ON smm_comments (plan_id, id);

CREATE TABLE IF NOT EXISTS smm_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL DEFAULT 'rule',   -- voice | rule | avoid | insight | fact
  text text NOT NULL,
  source text NOT NULL DEFAULT 'staff', -- staff | remark | analytics
  author_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS smm_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_from date NOT NULL,
  period_to date NOT NULL,
  title text NOT NULL,
  summary text NOT NULL DEFAULT '',
  metrics jsonb NOT NULL DEFAULT '[]'::jsonb,
  recommendations jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS smm_spend (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  kind text NOT NULL,                  -- text | image | video | vision
  model text NOT NULL,
  cost_rub numeric(10, 2) NOT NULL DEFAULT 0,
  note text
);
CREATE INDEX IF NOT EXISTS smm_spend_at_idx ON smm_spend (at);

CREATE TABLE IF NOT EXISTS smm_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  url text NOT NULL,
  title text NOT NULL DEFAULT '',
  kind text NOT NULL DEFAULT 'photo',  -- photo | logo
  created_at timestamptz NOT NULL DEFAULT now()
);
