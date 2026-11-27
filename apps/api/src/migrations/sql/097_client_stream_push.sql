-- 097: push в My Titan о начале трансляции. Аддитивно, на всех БД.
--
-- profiles.client_streams_enabled — клиент получает push «Мы в эфире» (по умолчанию да,
-- выключается в приложении: Профиль → Уведомления → Трансляции).
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS client_streams_enabled boolean NOT NULL DEFAULT true;
