-- 068: «Экраны» — несколько ТВ клуба, у каждого свои настройки (Titan Menu).
--
-- screens — один телевизор (приставка с приложением Titan Menu):
--   kind 'menu'      — меню как раньше (/menu): тема, лента тарифов, реклама в ленте;
--   kind 'slideshow' — картинки на весь экран, у каждой своё время и анимация смены.
--   rotation — как висит ТВ (0 — горизонтально, 90/270 — вертикально), поворачивает
--   приложение на приставке.
-- Привязка ТВ: телефон находит приставку в локальной сети, берёт одноразовый секрет
-- (pairing_hash, 10 минут) и передаёт его ТВ; ТВ обменивает секрет на свой токен
-- (device_token_hash) и дальше ходит с ним (heartbeat — «в сети», поворот).
--
-- screen_slides (065) теперь принадлежат экрану: у экрана-меню это реклама в ленте,
-- у слайдшоу — сами картинки. transition — анимация смены, fit — как вписать картинку.
--
-- Существующие настройки (тема, время ленты, слайды) переезжают в «Экран меню».
-- Идемпотентно, на всех БД клубов.

CREATE TABLE IF NOT EXISTS screens (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                text NOT NULL,
  kind                text NOT NULL DEFAULT 'menu',
  rotation            integer NOT NULL DEFAULT 0,
  theme               text NOT NULL DEFAULT 'night',
  band_sec            integer NOT NULL DEFAULT 20,
  sort_order          integer NOT NULL DEFAULT 0,
  device_id           text,
  device_model        text,
  app_version         text,
  device_ip           text,
  device_token_hash   text,
  paired_at           timestamptz,
  last_seen_at        timestamptz,
  pairing_hash        text,
  pairing_expires_at  timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'screens_kind_check') THEN
    ALTER TABLE screens ADD CONSTRAINT screens_kind_check CHECK (kind IN ('menu', 'slideshow'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'screens_rotation_check') THEN
    ALTER TABLE screens ADD CONSTRAINT screens_rotation_check CHECK (rotation IN (0, 90, 270));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS screens_device_token_uq ON screens (device_token_hash) WHERE device_token_hash IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS screens_pairing_uq ON screens (pairing_hash) WHERE pairing_hash IS NOT NULL;

ALTER TABLE screen_slides ADD COLUMN IF NOT EXISTS screen_id uuid REFERENCES screens(id) ON DELETE CASCADE;
ALTER TABLE screen_slides ADD COLUMN IF NOT EXISTS transition text NOT NULL DEFAULT 'fade';
ALTER TABLE screen_slides ADD COLUMN IF NOT EXISTS fit text NOT NULL DEFAULT 'contain';
CREATE INDEX IF NOT EXISTS screen_slides_screen_idx ON screen_slides (screen_id, sort_order);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'screen_slides_transition_check') THEN
    ALTER TABLE screen_slides ADD CONSTRAINT screen_slides_transition_check CHECK (transition IN ('fade', 'slide', 'zoom', 'flip', 'none'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'screen_slides_fit_check') THEN
    ALTER TABLE screen_slides ADD CONSTRAINT screen_slides_fit_check CHECK (fit IN ('contain', 'cover'));
  END IF;
END $$;

-- Прежний единственный экран (/menu) → «Экран меню» с его темой и временем ленты.
INSERT INTO screens (name, kind, theme, band_sec)
SELECT
  'Экран меню',
  'menu',
  COALESCE((SELECT value FROM app_settings WHERE key = 'menu_screen_theme' AND value IN ('night', 'neon', 'deco', 'synth', 'avant', 'dossier', 'halloween')), 'night'),
  COALESCE((SELECT LEAST(300, GREATEST(5, value::int)) FROM app_settings WHERE key = 'menu_screen_band_sec' AND value ~ '^[0-9]{1,4}$'), 20)
WHERE NOT EXISTS (SELECT 1 FROM screens);

UPDATE screen_slides
SET screen_id = (SELECT id FROM screens WHERE kind = 'menu' ORDER BY sort_order, created_at LIMIT 1)
WHERE screen_id IS NULL;
