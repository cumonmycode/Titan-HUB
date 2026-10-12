-- 082: Tai — единый Telegram-бот клуба. Раньше было три бота (Tai в чатах,
-- HUB для персонала, Wallet для клиентов); теперь всё в Tai, и он ведёт личные
-- диалоги. Аддитивно, на всех БД.
--
-- tai_contacts — кто писал Tai в личку и что он о человеке помнит:
--   • profile_id — профиль клуба (клиент или сотрудник), если человек известен;
--   • dm_open    — можно ли писать первым (false, если человек заблокировал бота);
--   • games      — во что играет: 'sport' | 'city' | 'both';
--   • notes      — короткая память Tai о человеке (имя, привычки, договорённости);
--   • opted_out  — просил не писать первым;
--   • remind_*   — «сегодня не могу» → напомнить в следующий игровой вечер;
--   • followups  — сколько раз подряд Tai писал первым без ответа.
CREATE TABLE IF NOT EXISTS tai_contacts (
  tg_id text PRIMARY KEY,
  profile_id uuid REFERENCES profiles(id),
  first_name text,
  username text,
  dm_open boolean NOT NULL DEFAULT true,
  games text,
  notes text,
  opted_out boolean NOT NULL DEFAULT false,
  remind_kind text,
  remind_at timestamptz,
  followups integer NOT NULL DEFAULT 0,
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  last_proactive_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tai_contacts_profile_idx ON tai_contacts (profile_id);
CREATE INDEX IF NOT EXISTS tai_contacts_remind_idx ON tai_contacts (remind_at) WHERE remind_at IS NOT NULL;

-- tai_messages — история диалогов Tai (личка и рабочий чат). chat_id — чат
-- Telegram (в личке совпадает с tg_id автора), memo — что Tai показал карточками.
CREATE TABLE IF NOT EXISTS tai_messages (
  id bigserial PRIMARY KEY,
  chat_id text NOT NULL,
  tg_id text,
  role text NOT NULL,
  content text NOT NULL,
  voice boolean NOT NULL DEFAULT false,
  memo text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tai_messages_chat_idx ON tai_messages (chat_id, created_at DESC);
