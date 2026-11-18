import { ContentUnavailableView, Form, Host, Picker, ProgressView, Section, Text, Toggle } from '@expo/ui/swift-ui';
import { pickerStyle, refreshable, tag } from '@expo/ui/swift-ui/modifiers';
import { Stack, useRouter } from 'expo-router';
import { Alert } from 'react-native';

import { LinkRow, TextRow } from '@/components/native-form';
import { useSettingsEditor } from '@/components/settings-parts';
import { tierLook, useClientTiers } from '@/lib/clients-api';

function parseAmounts(raw: string): Record<string, number> {
  try {
    const v = JSON.parse(raw || '{}') as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, number>) : {};
  } catch {
    return {};
  }
}

/** Проверка числа из поля перед сохранением настройки. */
function numberIn(raw: string, min: number, max: number, apply: (value: string) => void) {
  const parsed = Number(raw.replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return Alert.alert(`Введите число от ${min} до ${max}`);
  apply(String(Math.round(parsed)));
}

/**
 * Подарки гостям — всё, что клуб дарит сам, без кассира: приветственный бонус за первый
 * визит, бонусы за приглашённого друга (обоим) и подарок ко дню рождения — бонусами или
 * сертификатом, заранее, со своей суммой для каждого статуса.
 */
export default function GiftsScreen() {
  const router = useRouter();
  const settings = useSettingsEditor();
  const tiers = useClientTiers();

  if (settings.loading || settings.error) {
    return (
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        {settings.error ? <ContentUnavailableView title="Настройки не загрузились" systemImage="wifi.exclamationmark" description={settings.error.message} /> : <ProgressView />}
      </Host>
    );
  }

  const bonusOn = settings.flag('bonus_enabled', true);
  const welcome = settings.flag('welcome_bonus_enabled', false);
  const referral = settings.flag('referral_enabled', false);
  const birthday = settings.flag('birthday_bonus_enabled', false);
  const certificate = settings.text('birthday_gift_kind', 'bonus') === 'certificate';
  const tierAmounts = parseAmounts(settings.text('birthday_tier_amounts', '{}'));
  const baseAmount = settings.number('birthday_bonus_amount', 0);
  const daysBefore = settings.number('birthday_bonus_days_before', 0);
  const unit = certificate ? '₽' : 'бонусов';

  const setTierAmount = (key: string, raw: string) => {
    const next = { ...tierAmounts };
    if (!raw.trim()) delete next[key];
    else {
      const n = Number(raw.replace(/\s/g, '').replace(',', '.'));
      if (!Number.isFinite(n) || n < 0 || n > 1_000_000) return Alert.alert('Введите число от 0 до 1 000 000');
      next[key] = Math.round(n);
    }
    settings.save({ birthday_tier_amounts: JSON.stringify(next) });
  };

  return (
    <>
      <Stack.Title>Подарки</Stack.Title>
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <Form modifiers={[refreshable(async () => void (await settings.refetch()))]}>
          {!bonusOn && (
            <Section>
              <LinkRow icon="exclamationmark.triangle.fill" color="#FF9500" title="Бонусная программа выключена" subtitle="Бонусные подарки не выдаются — только сертификат ко дню рождения" onPress={() => router.push('/manage/loyalty/bonus')} />
            </Section>
          )}

          <Section title="Приветственный бонус" footer={<Text>{welcome ? 'Начисляется один раз — после первого оплаченного чека, когда регистрация подтверждена.' : 'Подарок новичку за первый визит.'}</Text>}>
            <Toggle label="Дарить новичкам" isOn={welcome} onIsOnChange={(next) => settings.save({ welcome_bonus_enabled: next ? 'true' : 'false' })} />
            {welcome && (
              <TextRow label="Бонусов" value={String(settings.number('welcome_bonus_amount', 0))} keyboard="numeric" onCommit={(v) => numberIn(v, 0, 1_000_000, (x) => settings.save({ welcome_bonus_amount: x }))} />
            )}
          </Section>

          <Section
            title="Приведи друга"
            footer={
              <Text>
                {referral
                  ? 'Кто пригласил — отмечается в карточке нового клиента («Пригласил»). Бонусы обоим — после первого оплаченного чека друга от минимальной суммы.'
                  : 'Гость приводит друга — оба получают бонусы.'}
              </Text>
            }>
            <Toggle label="Бонусы за приглашение" isOn={referral} onIsOnChange={(next) => settings.save({ referral_enabled: next ? 'true' : 'false' })} />
            {referral && (
              <>
                <TextRow label="Тому, кто пригласил" value={String(settings.number('referral_bonus_inviter', 0))} keyboard="numeric" onCommit={(v) => numberIn(v, 0, 1_000_000, (x) => settings.save({ referral_bonus_inviter: x }))} />
                <TextRow label="Другу" value={String(settings.number('referral_bonus_invitee', 0))} keyboard="numeric" onCommit={(v) => numberIn(v, 0, 1_000_000, (x) => settings.save({ referral_bonus_invitee: x }))} />
                <TextRow label="Первый чек от, ₽" value={String(settings.number('referral_min_check', 0))} keyboard="numeric" onCommit={(v) => numberIn(v, 0, 1_000_000, (x) => settings.save({ referral_min_check: x }))} />
              </>
            )}
          </Section>

          <Section
            title="День рождения"
            footer={
              <Text>
                {birthday
                  ? `${daysBefore ? `Приходит за ${daysBefore} дн. до дня рождения` : 'Приходит в день рождения'} с push-уведомлением, раз в год. ${certificate ? 'Сертификат — на всё, номер приходит гостю.' : ''}`
                  : 'Подарок гостю ко дню рождения. Скидку именинникам настраивайте в «Скидках» — условие «около дня рождения».'}
              </Text>
            }>
            <Toggle label="Дарить ко дню рождения" isOn={birthday} onIsOnChange={(next) => settings.save({ birthday_bonus_enabled: next ? 'true' : 'false' })} />
            {birthday && (
              <>
                <Picker selection={certificate ? 'certificate' : 'bonus'} onSelectionChange={(v) => settings.save({ birthday_gift_kind: String(v) })} modifiers={[pickerStyle('segmented')]}>
                  <Text modifiers={[tag('bonus')]}>Бонусы</Text>
                  <Text modifiers={[tag('certificate')]}>Сертификат</Text>
                </Picker>
                <TextRow label={certificate ? 'Номинал, ₽' : 'Бонусов'} value={String(baseAmount)} keyboard="numeric" onCommit={(v) => numberIn(v, 0, 1_000_000, (x) => settings.save({ birthday_bonus_amount: x }))} />
                <TextRow label="За сколько дней" value={String(daysBefore)} keyboard="numeric" onCommit={(v) => numberIn(v, 0, 30, (x) => settings.save({ birthday_bonus_days_before: x }))} />
                {certificate && (
                  <TextRow label="Действует, дней" value={String(settings.number('birthday_certificate_days', 14))} keyboard="numeric" onCommit={(v) => numberIn(v, 1, 365, (x) => settings.save({ birthday_certificate_days: x }))} />
                )}
              </>
            )}
          </Section>

          {birthday && (tiers.data ?? []).length > 0 && (
            <Section title="Подарок по статусам" footer={<Text>{`Свой размер для статуса, ${unit}. Пусто — как выше, 0 — без подарка.`}</Text>}>
              {(tiers.data ?? []).map((t) => (
                <TextRow
                  key={t.key}
                  label={tierLook(t.key, tiers.data).label}
                  value={tierAmounts[t.key] !== undefined ? String(tierAmounts[t.key]) : ''}
                  placeholder={String(baseAmount)}
                  keyboard="numeric"
                  onCommit={(v) => setTierAmount(t.key, v)}
                />
              ))}
            </Section>
          )}
        </Form>
      </Host>
    </>
  );
}
