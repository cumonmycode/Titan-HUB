-- 101: элемент показа «анимация» (kind 'page') — рекламная сцена с моушном.
--
-- Сцена — отдельная HTML-страница (titanpos.ru/apps/ads/<id>.html), экран открывает её
-- поверх показа на время элемента. link_url — адрес страницы, image_url — её статичный
-- кадр: превью в HUB и запасной вариант на экране, если страница не загрузилась.
-- Только в показе (placement 'show'). Идемпотентно, на всех БД клубов.

ALTER TABLE screen_slides DROP CONSTRAINT IF EXISTS screen_slides_kind_check;
ALTER TABLE screen_slides ADD CONSTRAINT screen_slides_kind_check CHECK (kind IN ('image', 'card', 'menu', 'page'));
