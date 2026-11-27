-- 096: Tai сам возвращается в чат, если сотрудник молчит час. Аддитивно, на всех БД.
--
-- tai_contacts.ai_resume_at — когда Tai вернётся (последний ответ сотрудника + 1 час).
-- Каждый ответ сотрудника отодвигает время; кнопка «Вернуть Tai» — сразу.
ALTER TABLE tai_contacts ADD COLUMN IF NOT EXISTS ai_resume_at timestamptz;
-- Чаты, уже стоящие на паузе: вернуть Tai через час после выкладки.
UPDATE tai_contacts SET ai_resume_at = now() + interval '1 hour' WHERE ai_paused AND ai_resume_at IS NULL;
