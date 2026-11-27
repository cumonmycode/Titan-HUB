-- 094: откуда пришли клиент и заявка, журнал заявки и чат Tai с клиентами в HUB.
-- Аддитивно, на всех БД.
--
-- profiles.signup_source — как клиент появился в клубе:
--   'hub'      — завёл сотрудник в HUB (signup_meta.by / byName — кто);
--   'app'      — зарегистрировался сам в My Titan (подтверждение в боте);
--   'request'  — заведён из заявки (signup_meta.bookingId);
--   NULL       — старые карточки, источник неизвестен.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS signup_source text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS signup_meta jsonb;
-- Регистрации из My Titan (миграция 077) — у них есть registration_status.
UPDATE profiles SET signup_source = 'app' WHERE signup_source IS NULL AND registration_status IS NOT NULL;

-- bookings: кто создал заявку вручную и кто по ней решил.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS created_by uuid;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS decided_by uuid;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS decided_at timestamptz;
-- Заметка персонала к заявке (видна только в HUB).
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS staff_note text;

-- Журнал заявки: создана, подтверждена, отклонена, заметка, ответ гостю.
CREATE TABLE IF NOT EXISTS booking_log (
  id bigserial PRIMARY KEY,
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  action text NOT NULL,
  actor_id uuid,
  actor_name text,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS booking_log_booking_idx ON booking_log (booking_id, created_at);

-- Чат Tai с клиентами в HUB (как диалоги бота в MIKAN):
--   ai_paused       — Tai молчит в этом чате, отвечает сотрудник;
--   needs_attention — нужен человек (Tai на паузе, а клиент написал);
--   staff_read_at   — когда сотрудник последний раз открыл диалог (непрочитанные — после).
ALTER TABLE tai_contacts ADD COLUMN IF NOT EXISTS ai_paused boolean NOT NULL DEFAULT false;
ALTER TABLE tai_contacts ADD COLUMN IF NOT EXISTS needs_attention boolean NOT NULL DEFAULT false;
ALTER TABLE tai_contacts ADD COLUMN IF NOT EXISTS staff_read_at timestamptz;
-- Реплика сотрудника из HUB: role = 'staff', staff_id — кто ответил.
ALTER TABLE tai_messages ADD COLUMN IF NOT EXISTS staff_id uuid;
