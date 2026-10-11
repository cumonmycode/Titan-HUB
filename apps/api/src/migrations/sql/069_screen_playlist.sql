-- 069: показ экрана — очередь из меню и картинок вместо выбора «меню или слайдшоу».
--
-- screen_slides.placement:
--   'band' — реклама в ленте тарифов внутри меню (как было: картинка или карточка с QR);
--   'show' — элемент показа на весь экран: 'menu' (меню клуба) или 'image' (картинка).
-- transition_ms — скорость анимации входа элемента (быстро/обычно/медленно).
-- screens.kind больше не определяет показ (оставлен для старых клиентов).
--
-- Перенос: картинки экранов-слайдшоу становятся показом; экраны-меню получают показ
-- из одного элемента «Меню». Идемпотентно, на всех БД клубов.

ALTER TABLE screen_slides ADD COLUMN IF NOT EXISTS placement text NOT NULL DEFAULT 'band';
ALTER TABLE screen_slides ADD COLUMN IF NOT EXISTS transition_ms integer NOT NULL DEFAULT 900;

ALTER TABLE screen_slides DROP CONSTRAINT IF EXISTS screen_slides_kind_check;
ALTER TABLE screen_slides ADD CONSTRAINT screen_slides_kind_check CHECK (kind IN ('image', 'card', 'menu'));

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'screen_slides_placement_check') THEN
    ALTER TABLE screen_slides ADD CONSTRAINT screen_slides_placement_check CHECK (placement IN ('band', 'show'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'screen_slides_transition_ms_check') THEN
    ALTER TABLE screen_slides ADD CONSTRAINT screen_slides_transition_ms_check CHECK (transition_ms BETWEEN 200 AND 5000);
  END IF;
END $$;

-- Картинки слайдшоу → показ.
UPDATE screen_slides s SET placement = 'show'
FROM screens sc
WHERE s.screen_id = sc.id AND sc.kind = 'slideshow' AND s.placement = 'band' AND s.kind = 'image';

-- Экраны-меню без показа → показ из одного меню.
INSERT INTO screen_slides (screen_id, kind, placement, duration_sec, transition, transition_ms, sort_order)
SELECT sc.id, 'menu', 'show', 60, 'fade', 900, 0
FROM screens sc
WHERE sc.kind = 'menu'
  AND NOT EXISTS (SELECT 1 FROM screen_slides x WHERE x.screen_id = sc.id AND x.placement = 'show');
