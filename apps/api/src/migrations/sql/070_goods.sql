-- 070: раздел «Товары» — сырьё и техкарты, списание документом, точная себестоимость.
--
-- inventory.kind: 'goods' — позиция меню (продаётся), 'ingredient' — сырьё (в меню не
--   попадает, списывается по техкартам). Сырьё и штучные товары учитываются целым
--   числом в своей единице inventory.unit: 'pcs' — штуки, 'g' — граммы, 'ml' — миллилитры.
-- recipe_items — техкарта: из чего состоит порция позиции меню. Продажа позиции с
--   техкартой списывает ингредиенты (а не саму позицию); stock_movements.sold_item_id
--   помнит, ради какой позиции списан ингредиент (себестоимость позиции в аналитике).
-- Себестоимость единицы — 4 знака: у сырья цена за грамм/миллилитр (молоко 0,0899 ₽/мл).
-- write_offs — списание (бой, порча, угощение) документом на несколько позиций.
-- supplies.cash_operation_id — приход, оплаченный наличными из кассы смены.
-- Идемпотентно, на всех БД клубов.

ALTER TABLE inventory ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'goods';
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS unit text NOT NULL DEFAULT 'pcs';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_kind_check') THEN
    ALTER TABLE inventory ADD CONSTRAINT inventory_kind_check CHECK (kind IN ('goods', 'ingredient'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_unit_check') THEN
    ALTER TABLE inventory ADD CONSTRAINT inventory_unit_check CHECK (unit IN ('pcs', 'g', 'ml'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_inventory_kind ON inventory (kind) WHERE deleted_at IS NULL;

ALTER TABLE inventory ALTER COLUMN cost_price TYPE numeric(12, 4);
ALTER TABLE stock_movements ALTER COLUMN unit_cost TYPE numeric(12, 4);
ALTER TABLE supply_items ALTER COLUMN cost_per_unit TYPE numeric(12, 4);
ALTER TABLE revision_items ALTER COLUMN cost_price TYPE numeric(12, 4);

CREATE TABLE IF NOT EXISTS recipe_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES inventory(id) ON DELETE CASCADE,
  component_id uuid NOT NULL REFERENCES inventory(id),
  quantity integer NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  CONSTRAINT recipe_items_quantity_check CHECK (quantity > 0),
  CONSTRAINT recipe_items_not_self CHECK (product_id <> component_id),
  CONSTRAINT recipe_items_unique UNIQUE (product_id, component_id)
);
CREATE INDEX IF NOT EXISTS idx_recipe_items_component ON recipe_items (component_id);

ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS sold_item_id uuid REFERENCES inventory(id);

CREATE TABLE IF NOT EXISTS write_offs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text,
  status text NOT NULL DEFAULT 'posted',
  reason text NOT NULL DEFAULT '',
  note text,
  draft_data jsonb,
  total_cost numeric(12, 2) NOT NULL DEFAULT 0,
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz,
  CONSTRAINT write_offs_status_check CHECK (status IN ('draft', 'posted'))
);
CREATE UNIQUE INDEX IF NOT EXISTS write_offs_idempotency_key_idx ON write_offs (idempotency_key);
CREATE INDEX IF NOT EXISTS idx_write_offs_created ON write_offs (created_at DESC);

CREATE TABLE IF NOT EXISTS write_off_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  write_off_id uuid NOT NULL REFERENCES write_offs(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES inventory(id),
  name text NOT NULL,
  quantity integer NOT NULL,
  unit_cost numeric(12, 4) NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0,
  CONSTRAINT write_off_items_quantity_check CHECK (quantity > 0)
);
CREATE INDEX IF NOT EXISTS idx_write_off_items_doc ON write_off_items (write_off_id);

ALTER TABLE supplies ADD COLUMN IF NOT EXISTS cash_operation_id uuid REFERENCES cash_operations(id) ON DELETE SET NULL;
ALTER TABLE supplies ADD COLUMN IF NOT EXISTS updated_at timestamptz;

-- Точка заказа: старый порог min_threshold переносим туда, где новая не задана.
UPDATE inventory SET reorder_point = min_threshold
WHERE reorder_point IS NULL AND COALESCE(min_threshold, 0) > 0;
