-- 081: единая онлайн-запись (сайт клуба вместо виджета /book) и уведомления.
--
-- guest_tg_chat / guest_tg_id — гость нажал «Получать статус в Telegram» после
--   заявки: клиентский бот клуба (My Titan) привязал свой чат к заявке по
--   claim_token (t.me/<бот>?start=r_<token>) и присылает подтверждение, отмену и
--   напоминание в день визита.
-- reminded_at — напоминание в день визита уже отправлено (идемпотентность крона).
-- staff_tg_chat / staff_tg_message_id — сообщение о заявке в чате персонала: при
--   подтверждении или отказе бот дописывает в него итог.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS guest_tg_chat text;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS guest_tg_id text;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS reminded_at timestamptz;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS staff_tg_chat text;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS staff_tg_message_id bigint;

-- Крон напоминаний ищет подтверждённые заявки с привязанным Telegram гостя.
CREATE INDEX IF NOT EXISTS bookings_remind_idx ON bookings (starts_at)
  WHERE status = 'confirmed' AND guest_tg_chat IS NOT NULL AND reminded_at IS NULL;

-- Виджет /book заменён сайтом: его тумблер больше не используется.
DELETE FROM app_settings WHERE key = 'booking_enabled';

-- Домен сайта основного клуба (TITAN KBR) уже подключён; у остальных клубов
-- домен задаёт владелец в HUB («Сайт → Домен»).
INSERT INTO app_settings (key, value)
SELECT 'site_domain', 'titanmafia.ru' WHERE current_database() = 'titan_hub'
ON CONFLICT (key) DO NOTHING;
INSERT INTO app_settings (key, value)
SELECT 'site_domain_primary', 'www' WHERE current_database() = 'titan_hub'
ON CONFLICT (key) DO NOTHING;

-- Контакты клуба для сайта и сообщений гостю («Сайт → Контакты» в HUB). Основному
-- клубу переносим контакты, которые были зашиты в сайт.
INSERT INTO app_settings (key, value)
SELECT 'site_contacts', '{"phone":"+7 965 666-07-00","email":"info@titanmafia.ru","telegram":"https://t.me/titanmafia","channel":"https://t.me/titankbr","whatsapp":"https://wa.me/79656660700","vk":"https://vk.com/titan.nalchik","instagram":"https://www.instagram.com/titankbr"}'
WHERE current_database() = 'titan_hub'
ON CONFLICT (key) DO NOTHING;
