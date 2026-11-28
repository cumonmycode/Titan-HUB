-- 100: компьютер с Windows в «Экранах» (приложение Titan Screen).
--
-- Ноутбук с телевизором по HDMI: на своём экране — управление, на телевизоре — показ
-- экрана HUB (меню и реклама, как у Titan Menu). Привязывается так же, device_app
-- 'desktop'. В пульсе он присылает список мониторов (device_state.displays).
--
-- display_id — на какой монитор выводить показ: id монитора из этого списка или NULL
-- («сам выберет» — первый не основной). Правится и в HUB, и в самом приложении —
-- значение одно, на сервере. Аддитивно и идемпотентно, на всех БД клубов.

ALTER TABLE screens ADD COLUMN IF NOT EXISTS display_id text;

ALTER TABLE screens DROP CONSTRAINT IF EXISTS screens_device_app_check;
ALTER TABLE screens ADD CONSTRAINT screens_device_app_check
  CHECK (device_app IS NULL OR device_app IN ('menu', 'launcher', 'desktop'));
