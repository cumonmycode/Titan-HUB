import { Button, HStack, Image, LabeledContent, RNHostView, Section, Spacer, Text, Toggle } from '@expo/ui/swift-ui';
import { foregroundStyle } from '@expo/ui/swift-ui/modifiers';
import { useState } from 'react';
import { Alert, StyleSheet } from 'react-native';

import { FieldRow, primary, secondary, TextRow } from '@/components/native-form';
import { Text as RNText } from '@/components/text';
import { FISCAL_METHODS, savePaymentConfig, usePaymentConfig, type PaymentConfig } from '@/lib/admin-api';
import { haptic } from '@/lib/haptics';
import { webhookUrl, type PayProvider } from '@/lib/integrations';
import { colors, space, type } from '@/lib/theme';

/** Порядок, в котором сервер выбирает эквайера, если подключено несколько. */
const PROVIDER_ORDER = 'Т-Банк → ЮKassa → Сбер → Альфа → Platega';

/** Настройки оплаты и чеков: новое значение видно сразу, при ошибке — откат. */
export function usePaymentEditor() {
  const config = usePaymentConfig();
  const [draft, setDraft] = useState<Partial<PaymentConfig>>({});
  const data = config.data ? { ...config.data, ...draft } : null;
  const save = (patch: Partial<PaymentConfig>) => {
    setDraft((current) => ({ ...current, ...patch }));
    savePaymentConfig(patch)
      .then(() => haptic.success())
      .catch((error: unknown) => {
        haptic.error();
        setDraft((current) => {
          const next = { ...current };
          for (const key of Object.keys(patch)) delete next[key as keyof PaymentConfig];
          return next;
        });
        Alert.alert('Не сохранилось', error instanceof Error ? error.message : String(error));
      });
  };
  return { data, save, refetch: config.refetch };
}

/** Карточка эквайера: работает ли он сейчас, тестовый режим, адрес уведомлений, чеки ЮKassa. */
export function AcquirerSections({ provider, data, save, host }: { provider: PayProvider; data: PaymentConfig; save: (patch: Partial<PaymentConfig>) => void; host: string }) {
  const active = data.sbpConfigured && data.sbpProvider === provider;
  const yookassaReceipts = provider === 'yookassa' && active && !data.fiscalStandalone;
  return (
    <>
      <Section
        title="Приём оплат"
        footer={
          <Text>
            {active
              ? 'Кнопка «СБП» на кассе и онлайн-оплаты гостей идут через этот эквайер.'
              : `Сейчас оплаты принимает ${data.sbpConfigured ? data.sbpProviderLabel : 'другой эквайер'}. Если подключено несколько, работает первый по порядку: ${PROVIDER_ORDER}.`}
          </Text>
        }
      >
        <LabeledContent label="Статус">
          <Text modifiers={[active ? foregroundStyle(colors.green) : secondary]}>{active ? 'Принимает оплаты' : 'Не используется'}</Text>
        </LabeledContent>
        {active ? <Toggle label="Тестовый режим" isOn={data.testMode} onIsOnChange={(on) => save({ testMode: on })} /> : null}
      </Section>

      {provider !== 'platega' ? (
        <Section title="Адрес уведомлений" footer={<Text>Впишите его в кабинете банка, чтобы касса сразу узнавала об оплате. Удерживайте, чтобы скопировать.</Text>}>
          <RNHostView matchContents>
            <RNText selectable style={[type.subhead, styles.url]}>
              {webhookUrl(host, provider)}
            </RNText>
          </RNHostView>
        </Section>
      ) : null}

      {yookassaReceipts ? (
        <Section footer={<Text>ЮKassa пробивает чек 54-ФЗ при оплате, если у гостя в карточке есть телефон.</Text>}>
          <Toggle label="Чеки через ЮKassa" isOn={data.fiscalProvider === 'yookassa'} onIsOnChange={(on) => save({ fiscalProvider: on ? 'yookassa' : '' })} />
        </Section>
      ) : null}
      {yookassaReceipts && data.fiscalProvider === 'yookassa' ? <ReceiptSections data={data} save={save} /> : null}
    </>
  );
}

/** Что попадает в фискальный чек: позиции, телефон по умолчанию, какие оплаты, подпись. */
export function ReceiptSections({ data, save }: { data: PaymentConfig; save: (patch: Partial<PaymentConfig>) => void }) {
  return (
    <>
      <Section title="Чеки" footer={<Text>Телефон подставляется, если у гостя его нет.</Text>}>
        <Toggle label="Позиции в чеке" isOn={data.itemized} onIsOnChange={(on) => save({ itemized: on })} />
        <TextRow label="Телефон по умолчанию" value={data.defaultPhone} placeholder="+7…" keyboard="phone-pad" maxLength={20} onCommit={(next) => save({ defaultPhone: next })} />
      </Section>

      <Section title="Какие оплаты пробивать" footer={<Text>Снимите отметку — оплаты этим способом не уходят в налоговую (например, депозит или долг).</Text>}>
        {FISCAL_METHODS.map((method) => {
          const on = data.fiscalMethods.includes(method.key);
          return (
            <Button
              key={method.key}
              onPress={() => {
                haptic.selection();
                save({ fiscalMethods: on ? data.fiscalMethods.filter((key) => key !== method.key) : [...data.fiscalMethods, method.key] });
              }}
            >
              <HStack spacing={12}>
                <Text modifiers={[primary]}>{method.label}</Text>
                <Spacer />
                {on ? <Image systemName="checkmark" size={16} color={colors.accent} /> : null}
              </HStack>
            </Button>
          );
        })}
      </Section>

      <Section title="Подпись в чеке" footer={<Text>Текст внизу фискального чека — например, «Спасибо за визит!».</Text>}>
        <FieldRow value={data.receiptFooter} placeholder="Спасибо за визит!" maxLength={256} multiline onCommit={(next) => save({ receiptFooter: next })} />
      </Section>
    </>
  );
}

const styles = StyleSheet.create({
  url: { color: colors.secondaryLabel, paddingHorizontal: space.lg, paddingVertical: space.md },
});
