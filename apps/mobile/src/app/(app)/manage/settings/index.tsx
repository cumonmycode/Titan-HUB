import { ContentUnavailableView, Form, Host, Picker, ProgressView, Section, Text } from '@expo/ui/swift-ui';
import { pickerStyle, refreshable, tag } from '@expo/ui/swift-ui/modifiers';
import { Stack, useRouter } from 'expo-router';

import { LinkRow, TextRow, TimeRow } from '@/components/native-form';
import { useSettingsEditor } from '@/components/settings-parts';
import { useBookingConfig, useIntegrations, usePaymentConfig } from '@/lib/admin-api';
import { haptic } from '@/lib/haptics';
import { METHODS, type TenderMethod } from '@/lib/payment';

/** Способы, которыми касса может открывать оплату по умолчанию. */
const DEFAULT_METHODS: TenderMethod[] = ['cash', 'card', 'transfer'];
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const hourText = (hour: number) => `${String(hour).padStart(2, '0')}:00`;

/**
 * Настройки клуба — как «Настройки» iOS: правка прямо в строке (название, адрес, время),
 * выбор из системного меню; всё сохраняется сразу. Большие темы
 * (оплата и чеки, онлайн-бронь, отзывы, интеграции) — отдельными экранами-переходами.
 * Раньше каждое поле открывало системный диалог, а оплата и бронь были только в вебе.
 */
export default function SettingsScreen() {
  const router = useRouter();
  const settings = useSettingsEditor();
  const payment = usePaymentConfig();
  const booking = useBookingConfig();
  const integrations = useIntegrations(true);

  const refresh = async () => {
    await Promise.allSettled([settings.refetch(), payment.refetch(), booking.refetch(), integrations.refetch()]);
  };

  if (settings.loading || settings.error) {
    return (
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        {settings.error ? (
          <ContentUnavailableView title="Настройки не загрузились" systemImage="wifi.exclamationmark" description={settings.error.message} />
        ) : (
          <ProgressView />
        )}
      </Host>
    );
  }

  const startHour = settings.number('business_day_start_hour', 9);
  const defaultPayment = settings.text('default_payment', 'cash') as TenderMethod;
  const connected = (integrations.data ?? []).filter((item) => item.configured).length;

  return (
    <>
      <Stack.Title>Настройки клуба</Stack.Title>
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <Form modifiers={[refreshable(refresh)]}>
          <Section title="Заведение" footer={<Text>Название и адрес попадают в чеки и приглашения гостям.</Text>}>
            <TextRow label="Название" value={settings.text('venue_name')} placeholder="Как клуб называется" maxLength={120} onCommit={(next) => settings.save({ venue_name: next })} />
            <TextRow label="Адрес" value={settings.text('venue_address')} placeholder="Улица и дом" maxLength={200} onCommit={(next) => settings.save({ venue_address: next })} />
            <TimeRow label="Открытие" value={settings.text('hours_open')} fallback="12:00" onChange={(next) => settings.save({ hours_open: next })} />
            <TimeRow label="Закрытие" value={settings.text('hours_close')} fallback="02:00" onChange={(next) => settings.save({ hours_close: next })} />
          </Section>

          <Section
            title="Рабочий день"
            footer={<Text>{`Смены и отчёты считаются от начала суток клуба: смена, открытая после полуночи, относится к предыдущему дню, пока не наступит ${hourText(startHour)}.`}</Text>}>
            <Picker
              label="Начало суток"
              selection={startHour}
              onSelectionChange={(hour) => {
                haptic.selection();
                settings.save({ business_day_start_hour: String(hour) });
              }}
              modifiers={[pickerStyle('menu')]}>
              {HOURS.map((hour) => (
                <Text key={hour} modifiers={[tag(hour)]}>
                  {hourText(hour)}
                </Text>
              ))}
            </Picker>
          </Section>

          <Section title="Касса" footer={<Text>Способ, который касса предлагает первым при оплате чека.</Text>}>
            <Picker
              label="Оплата по умолчанию"
              selection={DEFAULT_METHODS.includes(defaultPayment) ? defaultPayment : 'cash'}
              onSelectionChange={(method) => {
                haptic.selection();
                settings.save({ default_payment: String(method) });
              }}
              modifiers={[pickerStyle('menu')]}>
              {DEFAULT_METHODS.map((method) => (
                <Text key={method} modifiers={[tag(method)]}>
                  {METHODS[method].title}
                </Text>
              ))}
            </Picker>
          </Section>

          {/* Автозакрытие смены, общий порог остатка и общий тумблер Telegram убраны: сервер
              их не читал. Уведомления настраиваются у каждого сотрудника, порог — у позиции склада. */}
          <Section title="Гости и оплата">
            <LinkRow
              icon="creditcard"
              color="#34C759"
              title="Оплата и чеки"
              subtitle={payment.data ? (payment.data.sbpConfigured ? `СБП через ${payment.data.sbpProviderLabel}` : 'Эквайер не подключён') : undefined}
              onPress={() => router.push('/manage/settings/payment')}
            />
            <LinkRow
              icon="calendar.badge.plus"
              color="#FF2D55"
              title="Онлайн-бронирование"
              value={booking.data ? (booking.data.enabled ? 'Вкл.' : 'Выкл.') : undefined}
              onPress={() => router.push('/manage/settings/booking')}
            />
            <LinkRow icon="star.bubble" color="#FF9500" title="Отзывы гостей" subtitle="Яндекс Карты, 2ГИС" onPress={() => router.push('/manage/settings/reviews')} />
          </Section>


          <Section footer={<Text>Home Assistant (свет и климат на кассе) настраивается здесь; остальные ключи — в веб-панели.</Text>}>
            <LinkRow
              icon="puzzlepiece.extension"
              color="#5856D6"
              title="Интеграции"
              value={integrations.data ? `${connected} из ${integrations.data.length}` : undefined}
              onPress={() => router.push('/manage/settings/integrations')}
            />
          </Section>
        </Form>
      </Host>
    </>
  );
}
