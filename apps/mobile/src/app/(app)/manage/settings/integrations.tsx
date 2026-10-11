import { ContentUnavailableView, Form, HStack, Host, Image, ProgressView, Section, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import { font, lineLimit, refreshable } from '@expo/ui/swift-ui/modifiers';
import { Stack, useRouter } from 'expo-router';

import { LinkRow, primary, secondary } from '@/components/native-form';
import { useIntegrations } from '@/lib/admin-api';
import { plural } from '@/lib/format';
import { useSmartHome } from '@/lib/smart-home-api';
import { colors } from '@/lib/theme';

/** Ключи, которые настраиваются здесь же, на своём экране, — в общем списке их не повторяем. */
const OWN_SCREEN_KEYS = new Set(['hub_ha_url', 'hub_ha_token']);

/**
 * Интеграции клуба: что подключено. Home Assistant для HUB настраивается прямо в приложении
 * (свой экран), остальные ключи вводятся в веб-панели — там их безопаснее хранить.
 */
export default function IntegrationsScreen() {
  const router = useRouter();
  const integrations = useIntegrations(true);
  const smartHome = useSmartHome();
  const items = (integrations.data ?? []).filter((item) => !OWN_SCREEN_KEYS.has(item.key));
  const home = smartHome.data;
  const homeZones = home ? home.zones.filter((z) => z.lights.length + z.climates.length > 0).length : 0;
  const homeValue = !home ? undefined : !home.hasToken ? 'не настроен' : `${homeZones} ${plural(homeZones, ['помещение', 'помещения', 'помещений'])}`;
  const on = items.filter((item) => item.configured);
  const off = items.filter((item) => !item.configured);

  if (!integrations.data) {
    return (
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        {integrations.isError ? (
          <ContentUnavailableView title="Нет связи" systemImage="wifi.exclamationmark" description={integrations.error.message} />
        ) : (
          <ProgressView />
        )}
      </Host>
    );
  }

  const row = (item: (typeof items)[number]) => (
    <HStack key={item.key} spacing={12}>
      <Image systemName={item.configured ? 'checkmark.circle.fill' : 'circle.dashed'} size={20} color={item.configured ? colors.green : colors.tertiaryLabel} />
      <VStack alignment="leading" spacing={1}>
        <Text modifiers={[primary]}>{item.label}</Text>
        {item.masked ? <Text modifiers={[font({ textStyle: 'footnote' }), secondary, lineLimit(1)]}>{item.masked}</Text> : null}
      </VStack>
      <Spacer />
    </HStack>
  );

  return (
    <>
      <Stack.Title>Интеграции</Stack.Title>
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <Form modifiers={[refreshable(async () => void (await Promise.allSettled([integrations.refetch(), smartHome.refetch()])))]}>
          <Section title="Умный дом" footer={<Text>Свет и кондиционеры помещений клуба — в шторке на главной кассы.</Text>}>
            <LinkRow
              icon="house"
              color="#18BCF2"
              title="Home Assistant"
              value={homeValue}
              valueColor={home && !home.hasToken ? colors.orange : undefined}
              onPress={() => router.push('/manage/settings/home')}
            />
          </Section>
          {on.length > 0 && <Section title="Подключено">{on.map(row)}</Section>}
          {off.length > 0 && (
            <Section title="Не настроено" footer={<Text>Эти ключи вводятся в веб-панели: «Управление» → «Настройки» → «Интеграции».</Text>}>
              {off.map(row)}
            </Section>
          )}
        </Form>
      </Host>
    </>
  );
}
