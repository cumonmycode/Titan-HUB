-- 071: фасовка ингредиентов и имя штуки («Товары» v2).
--
-- inventory.unit_label — как называется одна штука: pcs (шт), pack (пачка), bottle,
--   can, box, bag, portion. Только подпись для unit = 'pcs' — счёт остаётся целым.
-- inventory.pack_name / pack_size — фасовка при закупке: «пачка ≈ 25 шт». В приходе
--   вносят упаковки, количество подставляется (packs × pack_size) и правится на факт.
-- supply_items.packs — сколько упаковок пришло (для истории прихода).
-- Идемпотентно, на всех БД клубов.

ALTER TABLE inventory ADD COLUMN IF NOT EXISTS unit_label text;
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS pack_name text;
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS pack_size integer;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_pack_size_check') THEN
    ALTER TABLE inventory ADD CONSTRAINT inventory_pack_size_check CHECK (pack_size IS NULL OR pack_size > 0);
  END IF;
END $$;

ALTER TABLE supply_items ADD COLUMN IF NOT EXISTS packs numeric(10, 2);
