-- 087: Tai ведёт заявки с сайта. Аддитивно, на всех БД.
--
-- Когда Tai в разговоре с гостем чего-то не знает, он спрашивает в рабочем чате
-- персонала. Сотрудник отвечает реплаем на вопрос — Tai продолжает разговор с гостем
-- с учётом ответа. tai_request_questions связывает сообщение в рабочем чате с гостем.
CREATE TABLE IF NOT EXISTS tai_request_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid REFERENCES bookings(id) ON DELETE CASCADE,
  guest_chat text NOT NULL,
  guest_tg_id text NOT NULL,
  question text NOT NULL,
  staff_chat text NOT NULL,
  staff_message_id bigint,
  status text NOT NULL DEFAULT 'open',
  answer text,
  answered_by text,
  answered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tai_request_questions_msg_idx ON tai_request_questions (staff_chat, staff_message_id);
