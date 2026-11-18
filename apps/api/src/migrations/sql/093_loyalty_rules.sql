-- 093: лояльность — правила начисления бонусов, «каждый N-й бесплатно», приглашения, подарки.
--
-- bonus_rules — правила начисления поверх базового процента (bonus_accrual_rate / по статусам):
--   kind = percent    — на позиции из «на что» начисляется value % вместо базового;
--   kind = multiplier — базовый процент умножается на value (×2 по вторникам);
--   kind = fixed      — +value бонусов за чек.
-- Условия «кому/когда/от какой суммы» — те же, что у скидок (миграция 085).
--
-- discounts.mechanic = free_units — «каждый N-й бесплатно» (free_every = N):
--   free_history = false — внутри одного чека (2 по цене 1, 3 по цене 2);
--   free_history = true  — штамп-карта: считаются покупки прошлых визитов с даты запуска.
--
-- profiles.referred_by — кто пригласил; награда обоим — после первого оплаченного чека
-- приглашённого (referral_rewarded_at). welcome_bonus_at — приветственный бонус выдан.
--
-- Аддитивно (IF NOT EXISTS) — прогоняется на всех клуб-БД.
CREATE TABLE IF NOT EXISTS bonus_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  kind text NOT NULL DEFAULT 'percent',
  value numeric(10,2) NOT NULL,
  scope text NOT NULL DEFAULT 'check',
  category_ids uuid[] NOT NULL DEFAULT '{}',
  item_ids uuid[] NOT NULL DEFAULT '{}',
  audience text NOT NULL DEFAULT 'all',
  tiers text[] NOT NULL DEFAULT '{}',
  client_ids uuid[] NOT NULL DEFAULT '{}',
  birthday_days integer,
  weekdays integer[] NOT NULL DEFAULT '{}',
  time_from text,
  time_to text,
  starts_on date,
  ends_on date,
  min_check_sum numeric(12,2) NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE discounts ADD COLUMN IF NOT EXISTS mechanic text NOT NULL DEFAULT 'simple';
ALTER TABLE discounts ADD COLUMN IF NOT EXISTS free_every integer;
ALTER TABLE discounts ADD COLUMN IF NOT EXISTS free_history boolean NOT NULL DEFAULT false;

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS referred_by uuid REFERENCES profiles(id);
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS referral_rewarded_at timestamptz;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS welcome_bonus_at timestamptz;
CREATE INDEX IF NOT EXISTS profiles_referred_by_idx ON profiles (referred_by) WHERE referred_by IS NOT NULL;
