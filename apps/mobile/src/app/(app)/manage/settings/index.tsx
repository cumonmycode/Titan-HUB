import { ContentUnavailableView, Form, Host, Picker, ProgressView, Section, Text } from '@expo/ui/swift-ui';
import { pickerStyle, refreshable, tag } from '@expo/ui/swift-ui/modifiers';
import { Stack, useRouter } from 'expo-router';

import { LinkRow, TextRow, TimeRow } from '@/components/native-form';
import { useSettingsEditor } from '@/components/settings-parts';
import { useIntegrations } from '@/lib/admin-api';
import { CATALOG, statusOf, useGomafiaStatus } from '@/lib/integrations';
import { useSiteConfig } from '@/lib/site-api';
import { lookOf } from '@/lib/site-looks';
import { plural } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { METHODS, type TenderMethod } from '@/lib/payment';

/** Способы, которыми касса может открывать оплату по умолчанию. */
const DEFAULT_METHODS: TenderMethod[] = ['cash', 'card', 'transfer'];
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const hourText = (hour: number) => `${String(hour).padStart(2, '0')}:00`;
/**
 * Настройки клуба — как «Настройки» iOS: правка прямо в строке (название, адрес, время),
 * выбор из меню; всё сохраняется сразу. Гости (отзывы, сайт) и интеграции — переходами.
 * Оплата и чеки живут в карточках своих интеграций (эквайер, касса 54-ФЗ), а не здесь.
 */
export default function SettingsScreen() {
  const router = useRouter();
  const settings = useSettingsEditor();
  const site = useSiteConfig();
  const integrations = useIntegrations(true);
  const gomafia = useGomafiaStatus();

  const refresh = async () => {
    await Promise.allSettled([settings.refetch(), site.refetch(), integrations.refetch(), gomafia.refetch()]);
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
  const installed = integrations.data ? CATALOG.filter((p) => statusOf(p, integrations.data, gomafia.data).installed).length : null;

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
            title="Касса"
            footer={<Text>{`Смены и отчёты считаются от начала суток: смена, открытая после полуночи, относится к предыдущему дню до ${hourText(startHour)}. Способ оплаты по умолчанию касса предлагает первым.`}</Text>}>
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
          <Section title="Гости">
            <LinkRow icon="star.bubble" color="#FF9500" title="Отзывы гостей" subtitle="Яндекс Карты, 2ГИС" onPress={() => router.push('/manage/settings/reviews')} />
            <LinkRow
              icon="globe"
              color="#5856D6"
              title="Сайт и онлайн-запись"
              subtitle="Оформление, расписание, публикации, заявки, домен"
              value={site.data ? lookOf(site.data.holiday).title : undefined}
              onPress={() => router.push('/manage/settings/site')}
            />
          </Section>

          <Section footer={<Text>Приём оплат и чеки, бот Tai, GoMafia, умный дом и другие сервисы. Настройки каждого — внутри его карточки.</Text>}>
            <LinkRow
              icon="puzzlepiece.extension.fill"
              color="#8B5CF6"
              title="Интеграции"
              subtitle="Оплата, чеки, Telegram, умный дом"
              value={installed !== null ? (installed ? `${installed} ${plural(installed, ['подключена', 'подключены', 'подключено'])}` : 'нет') : undefined}
              onPress={() => router.push('/manage/settings/integrations')}
            />
          </Section>
        </Form>
      </Host>
    </>
  );
}
