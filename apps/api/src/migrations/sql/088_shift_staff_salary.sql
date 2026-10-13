-- 088: кто работает на смене и гибкая зарплата. Аддитивно, на всех БД.
--
-- shift_staff      — сотрудники смены: выбираются при открытии, правятся до закрытия.
--                    Зарплату получают только они (роль staff; владелец — нет).
-- salary_schemes   — формулы зарплаты: ставка за смену, процент и ступени от выручки,
--                    почасовая часть, минимум и потолок, база выручки. Одна — по умолчанию,
--                    сотруднику можно назначить свою (profiles.salary_scheme_id).
-- salary_payments  — выплата теперь знает смену (shift_id) и сумму по формуле
--                    (calculated): видно, где владелец поправил сумму при выдаче.
CREATE TABLE IF NOT EXISTS shift_staff (
  shift_id uuid NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (shift_id, profile_id)
);
CREATE INDEX IF NOT EXISTS shift_staff_profile_idx ON shift_staff (profile_id);

CREATE TABLE IF NOT EXISTS salary_schemes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS salary_schemes_one_default ON salary_schemes (is_default) WHERE is_default;

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS salary_scheme_id uuid REFERENCES salary_schemes(id) ON DELETE SET NULL;
ALTER TABLE salary_payments ADD COLUMN IF NOT EXISTS shift_id uuid REFERENCES shifts(id) ON DELETE SET NULL;
ALTER TABLE salary_payments ADD COLUMN IF NOT EXISTS calculated numeric(12,2);
CREATE INDEX IF NOT EXISTS salary_payments_shift_idx ON salary_payments (shift_id) WHERE shift_id IS NOT NULL;

-- Прежняя формула клуба (700 ₽ + 100 ₽ за каждую начатую 1 000 ₽ сверх 7 000 ₽),
-- но от выручки всей смены — так решил владелец 2026-10-13.
INSERT INTO salary_schemes (name, rules, is_default)
SELECT 'Основная',
       '{"base":700,"percent":0,"stepFrom":7000,"stepEvery":1000,"stepAdd":100,"hourly":0,"min":0,"max":0,"revenue":"shift","events":false}'::jsonb,
       true
WHERE NOT EXISTS (SELECT 1 FROM salary_schemes);

-- Уже открытая смена: открывший её сотрудник — на смене.
INSERT INTO shift_staff (shift_id, profile_id)
SELECT s.id, s.opened_by
FROM shifts s JOIN profiles p ON p.id = s.opened_by
WHERE s.status = 'open' AND p.role = 'staff'
ON CONFLICT DO NOTHING;
