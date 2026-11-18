import { ContentUnavailableView, Form, Host, ProgressView, RNHostView, Section, Text, Toggle } from '@expo/ui/swift-ui';
import { refreshable } from '@expo/ui/swift-ui/modifiers';
import { Stack, useRouter } from 'expo-router';
import { Alert } from 'react-native';

import { BonusCalculator } from '@/components/loyalty-parts';
import { ActionRow, LinkRow, TextRow } from '@/components/native-form';
import { useSettingsEditor } from '@/components/settings-parts';
import { tierLook, useClientTiers } from '@/lib/clients-api';
import { useGoods } from '@/lib/goods-api';
import { discountSummary, RULE_KIND_LABEL, ruleValueText, useBonusRules, usePickDraft } from '@/lib/loyalty-api';

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
 * Бонусная программа: калькулятор «что получит гость», базовый процент (общий и по
 * статусам), правила начисления поверх него, категории без бонусов, списание, срок жизни.
 * Подарки (день рождения, приветственный, за друга) — на экране «Подарки».
 */
export default function BonusSettingsScreen() {
  const router = useRouter();
  const settings = useSettingsEditor();
  const tiers = useClientTiers();
  const goods = useGoods();
  const startPick = usePickDraft((s) => s.start);
  const rules = useBonusRules();

  if (settings.loading || settings.error) {
    return (
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        {settings.error ? <ContentUnavailableView title="Настройки не загрузились" systemImage="wifi.exclamationmark" description={settings.error.message} /> : <ProgressView />}
      </Host>
    );
  }

  // Сервер включает бонусы, пока не записано 'false'.
  const on = settings.flag('bonus_enabled', true);
  const names = {
    tier: (key: string) => tierLook(key, tiers.data).label,
    category: (id: string) => goods.data?.categories.find((c) => c.id === id)?.name ?? 'категория',
  };

  return (
    <>
      <Stack.Title>Бонусная программа</Stack.Title>
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <Form modifiers={[refreshable(async () => void (await Promise.allSettled([settings.refetch(), rules.refetch()])))]}>
          <Section footer={<Text>{on ? 'Бонусы начисляются за покупки и списываются на кассе вместо денег.' : 'Бонусы не начисляются и не списываются.'}</Text>}>
            <Toggle label="Бонусная программа" isOn={on} onIsOnChange={(next) => settings.save({ bonus_enabled: next ? 'true' : 'false' })} />
          </Section>

          {on && (
            <>
              <Section>
                <RNHostView matchContents>
                  <BonusCalculator tiers={tiers.data} />
                </RNHostView>
              </Section>

              <Section title="Обычное начисление" footer={<Text>Чеки меньше минимальной покупки бонусов не дают.</Text>}>
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

              <Section
                title={`Правила · ${(rules.data ?? []).filter((r) => r.isActive).length} включено`}
                footer={<Text>Правила меняют начисление: свой процент на бар, ×2 по вторникам, +100 за визит от 1 000 ₽. Множители не складываются — берётся больший.</Text>}>
                {(rules.data ?? []).map((r) => (
                  <LinkRow
                    key={r.id}
                    icon={r.kind === 'multiplier' ? 'sparkles' : r.kind === 'percent' ? 'percent' : 'plus.circle.fill'}
                    color={r.isActive ? '#FF9500' : '#8E8E93'}
                    title={r.name}
                    subtitle={[r.isActive ? null : 'выключено', RULE_KIND_LABEL[r.kind], discountSummary({ ...r, minQuantity: 1 }, names)].filter(Boolean).join(' · ')}
                    value={ruleValueText(r)}
                    onPress={() => router.push({ pathname: '/manage/loyalty/bonus-rule', params: { ruleId: r.id } })}
                  />
                ))}
                <ActionRow title="Новое правило" icon="plus.circle.fill" onPress={() => router.push('/manage/loyalty/bonus-rule')} />
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
