-- 098: свободная позиция «Другое» в чеке. Аддитивно и идемпотентно, на всех БД.
--
-- Кассир вписывает название и сумму (например, еда из другого заведения, которую клуб
-- оплатил за гостя). Строка чека ссылается на системную позицию «Другое», а своё
-- название хранит в check_items.custom_name, сумму — в price_at_time.
ALTER TABLE check_items ADD COLUMN IF NOT EXISTS custom_name text;

-- Системная позиция: без склада, скрыта из меню, кабинок и ТВ; deleted_at — чтобы её
-- не было ни в одном списке «Товаров» (её нельзя править или продать плиткой).
-- Аналитика по позициям видит такие строки одной группой «Другое».
INSERT INTO inventory (id, name, kind, price, track_stock, is_service, is_active, is_tablet_visible, is_screen_visible, deleted_at)
VALUES ('00000000-0000-4000-8000-000000000098', 'Другое', 'goods', 0, false, true, false, false, false, now())
ON CONFLICT (id) DO NOTHING;
