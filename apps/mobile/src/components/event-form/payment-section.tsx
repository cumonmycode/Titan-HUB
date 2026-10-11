import { Host, Picker, Text as SwiftText } from '@expo/ui/swift-ui';
import { pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';

import { FormField, FormSection } from '@/components/form-parts';
import { GlassCard } from '@/components/new-check-parts';
import type { EventBillingMode, EventRate } from '@/lib/events-api';
import { formatMoney, toNumber } from '@/lib/format';
import { haptic } from '@/lib/haptics';

import { BILLING_SHORT, billedHours, billingModesFor, packageQuote, type FormKind } from './model';
import { formStyles, InfoRow } from './parts';
import type { ZoneOption } from './where-section';

/**
 * «Оплата»: фикс-сумма, пакет мероприятия по длительности или аренда зоны по ставке.
 * Длительность здесь не вводится — она одна, в «Когда»; пакет и оценка аренды считаются от неё.
 */
export function PaymentSection({
  kind,
  mode,
  onMode,
  amountText,
  onAmount,
  minutes,
  rates,
  zone,
}: {
  kind: FormKind;
  mode: EventBillingMode;
  onMode: (mode: EventBillingMode) => void;
  amountText: string;
  onAmount: (value: string) => void;
  minutes: number;
  rates: EventRate[] | undefined;
  zone: ZoneOption | null;
}) {
  const hours = billedHours(minutes);
  const partialHour = minutes % 60 !== 0;
  const quote = packageQuote(hours, rates);
  const rate = toNumber(zone?.hourlyRate);

  let footer: string | undefined;
  if (mode === 'hourly') {
    if (!quote.hasRates) footer = 'Тарифы мероприятий не заданы — задайте их в «Тарифы и аренда» или выберите «Фикс».';
    else if (!quote.exact) footer = `Тарифа на ${hours} ч нет — цена досчитана от ближайшего пакета.`;
    else footer = 'Пакет берётся по длительности выше.';
    if (partialHour) footer += ' Начатый час считается целым.';
  } else if (mode === 'rental') {
    footer = zone
      ? 'Чек считает фактическое время: аренда идёт со старта мероприятия, начатый час — целый.'
      : 'Выберите зону выше — чек посчитает её аренду по ставке зоны, по факту.';
  }

  return (
    <FormSection title="ОПЛАТА" footer={footer}>
      <Host matchContents={{ vertical: true }} style={formStyles.stretch}>
        <Picker
          selection={mode}
          onSelectionChange={(value) => {
            haptic.selection();
            onMode(value as EventBillingMode);
          }}
          modifiers={[pickerStyle('segmented')]}>
          {billingModesFor(kind).map((item) => (
            <SwiftText key={item} modifiers={[tag(item)]}>
              {BILLING_SHORT[item]}
            </SwiftText>
          ))}
        </Picker>
      </Host>
      {mode === 'amount' && (
        <GlassCard style={formStyles.card}>
          <FormField icon="rublesign" value={amountText} onChange={onAmount} placeholder="Сумма" keyboardType="decimal-pad" suffix="₽" />
        </GlassCard>
      )}
      {mode === 'hourly' && (
        <GlassCard style={formStyles.card}>
          <InfoRow icon="shippingbox" label={`Пакет на ${hours} ч`} value={quote.price > 0 ? formatMoney(quote.price) : '—'} strong />
        </GlassCard>
      )}
      {mode === 'rental' && zone && (
        <GlassCard style={formStyles.card}>
          <InfoRow
            icon="clock"
            label={rate > 0 ? `${formatMoney(rate)}/ч × ${hours} ч` : `Ставка «${zone.name}» не задана`}
            value={rate > 0 ? `≈ ${formatMoney(rate * hours)}` : undefined}
            strong
          />
        </GlassCard>
      )}
    </FormSection>
  );
}
