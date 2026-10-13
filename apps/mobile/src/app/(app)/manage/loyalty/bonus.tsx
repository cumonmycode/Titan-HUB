import { ContentUnavailableView, Form, Host, ProgressView, Section, Text, Toggle } from '@expo/ui/swift-ui';
import { refreshable } from '@expo/ui/swift-ui/modifiers';
import { Stack, useRouter } from 'expo-router';
import { Alert } from 'react-native';

import { LinkRow, TextRow } from '@/components/native-form';
import { useSettingsEditor } from '@/components/settings-parts';
import { tierLook, useClientTiers } from '@/lib/clients-api';
import { useGoods } from '@/lib/goods-api';
import { usePickDraft } from '@/lib/loyalty-api';

function parseRates(raw: string): Record<string, number> {
  try {
    const v = JSON.parse(raw || '{}') as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, number>) : {};
  } catch {
    return {};
  }
}
function parseIds(raw: string): string[] {
  try {
    const v = JSON.parse(raw || '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** Проверка числа из поля перед сохранением настройки. */
function numberIn(raw: string, min: number, max: number, apply: (value: string) => void) {
  const parsed = Number(raw.replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return Alert.alert(`Введите число от ${min} до ${max}`);
  apply(String(parsed));
}

/**
 * Бонусная программа: начисление (общий процент и свой для каждого статуса, категории без
 * бонусов), списание, срок жизни, подарок на день рождения, видимость у клиентов.
 */
export default function BonusSettingsScreen() {
  const router = useRouter();
  const settings = useSettingsEditor();
  const tiers = useClientTiers();
  const goods = useGoods();
  const startPick = usePickDraft((s) => s.start);

  if (settings.loading || settings.error) {
    return (
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        {settings.error ? <ContentUnavailableView title="Настройки не загрузились" systemImage="wifi.exclamationmark" description={settings.error.message} /> : <ProgressView />}
      </Host>
    );
  }

  // Сервер включает бонусы, пока не записано 'false'.
  const on = settings.flag('bonus_enabled', true);
  const birthday = settings.flag('birthday_bonus_enabled', false);

  return (
    <>
      <Stack.Title>Бонусная программа</Stack.Title>
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <Form modifiers={[refreshable(async () => void (await settings.refetch()))]}>
          <Section footer={<Text>{on ? 'Бонусы начисляются за покупки и списываются на кассе вместо денег.' : 'Бонусы не начисляются и не списываются.'}</Text>}>
            <Toggle label="Бонусная программа" isOn={on} onIsOnChange={(next) => settings.save({ bonus_enabled: next ? 'true' : 'false' })} />
          </Section>

          {on && (
            <>
              <Section title="Начисление" footer={<Text>Чеки меньше минимальной покупки бонусов не дают.</Text>}>
                <TextRow label="Процент от покупки, %" value={String(settings.number('bonus_accrual_rate', 5))} keyboard="decimal-pad" onCommit={(v) => numberIn(v, 0, 100, (x) => settings.save({ bonus_accrual_rate: x }))} />
                <TextRow label="Минимальная покупка, ₽" value={String(settings.number('bonus_min_purchase', 0))} keyboard="decimal-pad" onCommit={(v) => numberIn(v, 0, 1_000_000, (x) => settings.save({ bonus_min_purchase: x }))} />
                <Toggle label="Начислять при долге" isOn={settings.flag('bonus_accrual_on_debt', false)} onIsOnChange={(next) => settings.save({ bonus_accrual_on_debt: next ? 'true' : 'false' })} />
              </Section>

              <Section title="По статусам" footer={<Text>Свой процент для статуса. Пусто — общий процент выше.</Text>}>
                {(tiers.data ?? []).map((t) => {
                  const rates = parseRates(settings.text('bonus_tier_rates', '{}'));
                  return (
                    <TextRow
                      key={t.key}
                      label={`${tierLook(t.key, tiers.data).label}, %`}
                      value={rates[t.key] !== undefined ? String(rates[t.key]) : ''}
                      placeholder={String(settings.number('bonus_accrual_rate', 5))}
                      keyboard="decimal-pad"
                      onCommit={(v) => {
                        const next = { ...rates };
                        if (!v.trim()) delete next[t.key];
                        else {
                          const n = Number(v.replace(',', '.'));
                          if (!Number.isFinite(n) || n < 0 || n > 100) return Alert.alert('Введите число от 0 до 100');
                          next[t.key] = n;
                        }
                        settings.save({ bonus_tier_rates: JSON.stringify(next) });
                      }}
                    />
                  );
                })}
              </Section>

              <Section title="Без бонусов" footer={<Text>За эти категории бонусы не начисляются — например, за тарифы игры или алкоголь.</Text>}>
                {(() => {
                  const excluded = parseIds(settings.text('bonus_excluded_categories', '[]'));
                  const names = excluded.map((id) => goods.data?.categories.find((c) => c.id === id)?.name).filter(Boolean).join(', ');
                  return (
                    <LinkRow
                      icon="nosign"
                      color="#8E8E93"
                      title={names || 'Начислять на всё'}
                      value={excluded.length ? String(excluded.length) : 'Выбрать'}
                      onPress={() => {
                        startPick('categories', excluded, (ids) => settings.save({ bonus_excluded_categories: JSON.stringify(ids) }));
                        router.push('/manage/loyalty/pick');
                      }}
                    />
                  );
                })()}
              </Section>

              <Section title="Списание" footer={<Text>Какую часть чека можно закрыть бонусами. Срок жизни 0 — бонусы не сгорают.</Text>}>
                <TextRow label="Не больше, %" value={String(settings.number('bonus_max_spend', 50))} keyboard="numeric" onCommit={(v) => numberIn(v, 0, 100, (x) => settings.save({ bonus_max_spend: x }))} />
                <TextRow label="Срок жизни, дней" value={String(settings.number('bonus_expiry_days', 0))} keyboard="numeric" onCommit={(v) => numberIn(v, 0, 3650, (x) => settings.save({ bonus_expiry_days: x }))} />
              </Section>

              <Section title="День рождения">
                <Toggle label="Подарок на день рождения" isOn={birthday} onIsOnChange={(next) => settings.save({ birthday_bonus_enabled: next ? 'true' : 'false' })} />
                {birthday && (
                  <TextRow label="Сколько бонусов" value={String(settings.number('birthday_bonus_amount', 0))} keyboard="decimal-pad" onCommit={(v) => numberIn(v, 0, 1_000_000, (x) => settings.save({ birthday_bonus_amount: x }))} />
                )}
              </Section>
            </>
          )}

          <Section title="My Titan" footer={<Text>Скрывает бонусы в приложении и кабинете клиента — пока программа не запущена.</Text>}>
            <Toggle label="Скрыть бонусы у клиентов" isOn={settings.flag('bonus_wallet_hidden', false)} onIsOnChange={(next) => settings.save({ bonus_wallet_hidden: next ? 'true' : 'false' })} />
          </Section>
        </Form>
      </Host>
    </>
  );
}
