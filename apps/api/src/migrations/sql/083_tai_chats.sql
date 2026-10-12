-- 083: история чатов с Tai в Titan HUB (приложение и веб) — как список чатов в Gemini.
-- У каждого сотрудника свои чаты; история общая для его устройств. Аддитивно, на всех БД.
--
-- tai_chats      — чат: заголовок (первый вопрос, потом короткое имя от Tai), время.
-- tai_chat_turns — реплики: вопрос сотрудника или ответ Tai с блоками интерфейса
--                  (карточки действий/поставок обновляются при нажатии) и memo для модели.
CREATE TABLE IF NOT EXISTS tai_chats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id),
  title text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tai_chats_user_idx ON tai_chats (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS tai_chat_turns (
  id bigserial PRIMARY KEY,
  chat_id uuid NOT NULL REFERENCES tai_chats(id) ON DELETE CASCADE,
  role text NOT NULL,
  content text NOT NULL,
  blocks jsonb NOT NULL DEFAULT '[]'::jsonb,
  memo text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tai_chat_turns_chat_idx ON tai_chat_turns (chat_id, id);
