-- 086: сертификаты заново. Аддитивно, на всех БД.
--
-- Номер выпускает клуб: свой (напечатан на карточке) или серией с диапазоном
-- («TK-0001…TK-0100», series = «TK»). У сертификата есть название, срок действия,
-- получатель и то, на что им можно платить:
--   scope = all        — любой чек;
--           categories — только позиции этих категорий меню (category_ids);
--           items      — только эти позиции (item_ids), например тарифы игры;
--           events     — только мероприятие (база события и аренда зоны в чеке).
-- voided_at — погашен владельцем (больше не принимается).
ALTER TABLE certificates ADD COLUMN IF NOT EXISTS title text;
ALTER TABLE certificates ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'all';
ALTER TABLE certificates ADD COLUMN IF NOT EXISTS category_ids uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE certificates ADD COLUMN IF NOT EXISTS item_ids uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE certificates ADD COLUMN IF NOT EXISTS valid_until date;
ALTER TABLE certificates ADD COLUMN IF NOT EXISTS series text;
ALTER TABLE certificates ADD COLUMN IF NOT EXISTS recipient text;
ALTER TABLE certificates ADD COLUMN IF NOT EXISTS note text;
ALTER TABLE certificates ADD COLUMN IF NOT EXISTS voided_at timestamptz;
CREATE INDEX IF NOT EXISTS certificates_series_idx ON certificates (series) WHERE series IS NOT NULL;

-- Погашенные раньше вручную (is_used при ненулевом остатке) — это аннулирование.
UPDATE certificates SET voided_at = coalesce(used_at, created_at)
WHERE is_used AND balance > 0 AND voided_at IS NULL;
