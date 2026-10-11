-- 077: подтверждение регистраций из приложения My Titan.
--
-- profiles.registration_status:
--   NULL       — обычный клиент (заведён персоналом или до этой функции);
--   'pending'  — зарегистрировался сам в приложении и ждёт подтверждения
--                персонала: бонусы не начисляются, оплата в приложении закрыта;
--   'approved' — подтверждён в HUB («Клиенты» → «Подтвердить»);
--   'rejected' — отклонён (профиль уходит в архив).
--
-- Идемпотентно, на всех БД клубов.

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS registration_status text;
CREATE INDEX IF NOT EXISTS profiles_registration_pending_idx ON profiles (created_at) WHERE registration_status = 'pending';
