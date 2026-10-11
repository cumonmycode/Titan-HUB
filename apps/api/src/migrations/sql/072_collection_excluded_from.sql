-- 072: начало исключения участника из сбора.
--
-- collection_members.excluded_from — когда участника исключили (1м/3м/навсегда).
-- Вместе с excluded_until задаёт окно, за месяцы которого он не должен взнос и
-- после возврата в сбор (раньше долг за эти месяцы возвращался).
-- Для уже исключённых — лучшее, что известно: момент последнего изменения строки.
-- Идемпотентно, на всех БД клубов.

ALTER TABLE collection_members ADD COLUMN IF NOT EXISTS excluded_from timestamptz;

UPDATE collection_members
   SET excluded_from = COALESCE(updated_at, created_at)
 WHERE excluded_from IS NULL
   AND (excluded_forever OR excluded_until IS NOT NULL);
