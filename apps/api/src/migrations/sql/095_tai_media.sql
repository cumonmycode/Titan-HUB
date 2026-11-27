-- 095: фото в «Диалогах Tai». Аддитивно, на всех БД.
--
-- tai_messages.photo_url — фото в реплике: отправленное сотрудником из HUB или
-- присланное клиентом, пока диалог ведёт сотрудник (копия в хранилище клуба).
ALTER TABLE tai_messages ADD COLUMN IF NOT EXISTS photo_url text;
