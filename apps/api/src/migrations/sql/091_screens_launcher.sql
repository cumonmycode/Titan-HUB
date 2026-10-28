-- 091: ТВ в кабинке (лаунчер Titan TV) в «Экранах».
--
-- К экрану можно привязать не только приставку Titan Menu, но и телевизор с главным
-- экраном Titan TV. Что привязано, говорит device_app ('menu' | 'launcher') — его
-- присылает само устройство при привязке; от него зависит, что HUB показывает в
-- настройках экрана (показ и тема для меню, пульт и реклама для кабинки).
--
-- device_state — живое состояние ТВ из пульса раз в 20 с: что на экране, играет ли
-- AirPlay, громкость, связь со «Светом и климатом». Не история, только последнее.
--
-- Реклама на ТВ в кабинке (главный экран и заставка): ads_enabled — показывать ли;
-- ads_screen_id — чью ленту рекламы брать (по умолчанию NULL — как у первого экрана
-- с меню, тот же блок, что на ТВ с меню; свой id — собственная лента этого экрана).
-- Идемпотентно, на всех БД клубов.

ALTER TABLE screens ADD COLUMN IF NOT EXISTS device_app text;
ALTER TABLE screens ADD COLUMN IF NOT EXISTS device_state jsonb;
ALTER TABLE screens ADD COLUMN IF NOT EXISTS ads_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE screens ADD COLUMN IF NOT EXISTS ads_screen_id uuid REFERENCES screens(id) ON DELETE SET NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'screens_device_app_check') THEN
    ALTER TABLE screens ADD CONSTRAINT screens_device_app_check CHECK (device_app IS NULL OR device_app IN ('menu', 'launcher'));
  END IF;
END $$;

-- Уже привязанные приставки — это Titan Menu.
UPDATE screens SET device_app = 'menu' WHERE device_token_hash IS NOT NULL AND device_app IS NULL;
