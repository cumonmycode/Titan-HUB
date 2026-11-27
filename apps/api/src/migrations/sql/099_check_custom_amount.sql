-- 099: сумма свободных позиций «Другое» в чеке. Аддитивно и идемпотентно, на всех БД.
--
-- «Другое» — возврат денег, оплаченных клубом за гостя (еда из другого заведения):
-- входит в итог чека к оплате, но не в выручку. checks.custom_amount держит эту часть
-- итога, чтобы аналитика, прогноз Tai и зарплата считали выручку как
-- total_amount − custom_amount без джойна с позициями.
ALTER TABLE checks ADD COLUMN IF NOT EXISTS custom_amount numeric(12, 2) NOT NULL DEFAULT 0;

-- Чеки, где «Другое» уже пробили (с выкладки 098).
UPDATE checks c SET custom_amount = s.amount
FROM (
  SELECT check_id, round(sum(quantity * price_at_time), 2) AS amount
  FROM check_items WHERE custom_name IS NOT NULL
  GROUP BY check_id
) s
WHERE s.check_id = c.id AND c.custom_amount IS DISTINCT FROM s.amount;
