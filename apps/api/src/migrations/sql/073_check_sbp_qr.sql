-- 073: зафиксированная сумма СБП-QR на чеке.
--
-- checks.sbp_qr_amount — товарная сумма чека (позиции−скидки+аренда+база события),
--   на которую выставлен последний QR (без чаевых и надбавки 8%).
-- checks.sbp_qr_at     — когда выставлен QR (на этот момент посчитана аренда).
-- checks.sbp_qr_tx_id  — id транзакции эквайера этого QR.
-- Вебхук по ЭТОЙ транзакции закрывает чек на сумму QR и завершает аренду в момент
-- выставления QR: иначе живая аренда успевала «тикнуть» на новый час до оплаты →
-- ложный AMOUNT_MISMATCH, деньги получены, а чек остаётся открытым.
-- Идемпотентно, на всех БД клубов.

ALTER TABLE checks ADD COLUMN IF NOT EXISTS sbp_qr_amount numeric(12, 2);
ALTER TABLE checks ADD COLUMN IF NOT EXISTS sbp_qr_at timestamptz;
ALTER TABLE checks ADD COLUMN IF NOT EXISTS sbp_qr_tx_id text;
