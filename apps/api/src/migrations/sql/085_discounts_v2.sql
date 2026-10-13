-- 085: гибкие скидки. Аддитивно, на всех БД.
--
-- Скидка теперь сама описывает, когда она срабатывает:
--   на что    — scope: весь чек | категории меню (category_ids) | позиции (item_ids);
--   кому      — audience: все | статусы (tiers) | клиенты (client_ids) | команда | первый визит;
--               birthday_days — только в день рождения (± дней);
--   когда     — дни недели (weekdays 1=Пн…7=Вс), время с–по (МСК, может идти через полночь),
--               период дат (starts_on…ends_on);
--   условия   — минимальная сумма чека (min_check_sum), минимальное количество (min_quantity);
--   сочетание — combinable: складывается с другими; иначе скидка «одна на чек» (берётся лучшая).
-- Время и дата сверяются с моментом открытия чека.
-- checks.manual_discount_ids — скидки клуба, которые кассир выбрал вручную (is_auto = false).
ALTER TABLE discounts ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE discounts ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'check';
ALTER TABLE discounts ADD COLUMN IF NOT EXISTS category_ids uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE discounts ADD COLUMN IF NOT EXISTS item_ids uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE discounts ADD COLUMN IF NOT EXISTS audience text NOT NULL DEFAULT 'all';
ALTER TABLE discounts ADD COLUMN IF NOT EXISTS tiers text[] NOT NULL DEFAULT '{}';
ALTER TABLE discounts ADD COLUMN IF NOT EXISTS client_ids uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE discounts ADD COLUMN IF NOT EXISTS birthday_days integer;
ALTER TABLE discounts ADD COLUMN IF NOT EXISTS weekdays integer[] NOT NULL DEFAULT '{}';
ALTER TABLE discounts ADD COLUMN IF NOT EXISTS time_from text;
ALTER TABLE discounts ADD COLUMN IF NOT EXISTS time_to text;
ALTER TABLE discounts ADD COLUMN IF NOT EXISTS starts_on date;
ALTER TABLE discounts ADD COLUMN IF NOT EXISTS ends_on date;
ALTER TABLE discounts ADD COLUMN IF NOT EXISTS min_check_sum numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE discounts ADD COLUMN IF NOT EXISTS combinable boolean NOT NULL DEFAULT false;
ALTER TABLE discounts ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

ALTER TABLE checks ADD COLUMN IF NOT EXISTS manual_discount_ids uuid[] DEFAULT '{}';

-- Старые поля → новые условия: скидка на позицию и персональная скидка клиента.
UPDATE discounts SET scope = 'items', item_ids = ARRAY[item_id]
WHERE item_id IS NOT NULL AND scope = 'check' AND item_ids = '{}';
UPDATE discounts SET audience = 'clients', client_ids = ARRAY[client_id]
WHERE client_id IS NOT NULL AND audience = 'all' AND client_ids = '{}';

-- Старые «скидки по статусам» (client_discount_rules) складываются в саму скидку: статус —
-- это условие «кому». Ручная скидка с правилами становится автоматической для этих статусов.
UPDATE discounts d SET audience = 'tiers', tiers = r.tiers, is_auto = true
FROM (
  SELECT discount_id, array_agg(DISTINCT client_tier) AS tiers
  FROM client_discount_rules WHERE is_active AND discount_id IS NOT NULL
  GROUP BY discount_id
) r
WHERE d.id = r.discount_id AND d.is_auto = false AND d.audience = 'all';
-- Гасим правила, которые теперь выражены самой скидкой (сложенные выше или
-- автоматическая скидка «для всех» — она и так действует на любой статус).
UPDATE client_discount_rules r SET is_active = false
FROM discounts d
WHERE r.discount_id = d.id AND r.is_active
  AND ((d.audience = 'tiers' AND r.client_tier = ANY (d.tiers)) OR (d.is_auto AND d.audience = 'all'));
