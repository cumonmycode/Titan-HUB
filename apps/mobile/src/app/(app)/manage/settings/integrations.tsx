import { ContentUnavailableView, Form, Host, ProgressView, Section, Text } from '@expo/ui/swift-ui';
import { refreshable } from '@expo/ui/swift-ui/modifiers';
import { Stack, useRouter } from 'expo-router';

import { ActionRow, LinkRow } from '@/components/native-form';
import { useIntegrations } from '@/lib/admin-api';
import { CATALOG, openIntegration, statusOf, useGomafiaStatus } from '@/lib/integrations';
import { colors } from '@/lib/theme';

/**
 * Интеграции как магазин дополнений: здесь — установленные (иконка, название, что делает),
 * «Добавить интеграцию» открывает каталог. Ключи, настройки сервиса и отключение — внутри
 * карточки интеграции.
 */
export default function IntegrationsScreen() {
  const router = useRouter();
  const integrations = useIntegrations(true);
  const gomafia = useGomafiaStatus();

  if (!integrations.data) {
    return (
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        {integrations.isError ? <ContentUnavailableView title="Нет связи" systemImage="wifi.exclamationmark" description={integrations.error.message} /> : <ProgressView />}
      </Host>
    );
  }

  const items = integrations.data;
  const installed = CATALOG.map((product) => ({ product, status: statusOf(product, items, gomafia.data) })).filter((x) => x.status.installed);

  return (
    <>
      <Stack.Title>Интеграции</Stack.Title>
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <Form modifiers={[refreshable(async () => void (await Promise.allSettled([integrations.refetch(), gomafia.refetch()])))]}>
          {installed.length === 0 ? (
            <Section>
              <ContentUnavailableView
                title="Пока ничего не подключено"
                systemImage="puzzlepiece.extension"
                description="Приём оплат по СБП, касса 54-ФЗ, бот в Telegram, умный дом и другие сервисы — в каталоге."
              />
            </Section>
          ) : (
            <Section title="Установлено" footer={<Text>Нажмите на интеграцию, чтобы сменить ключи, настроить или отключить.</Text>}>
              {installed.map(({ product, status }) => (
                <LinkRow
                  key={product.id}
                  icon={product.symbol}
                  color={product.color}
                  title={product.name}
                  subtitle={product.blurb}
                  value={status.complete ? undefined : 'Не до конца'}
                  valueColor={status.complete ? undefined : colors.orange}
                  onPress={() => openIntegration(router, product)}
                />
              ))}
            </Section>
          )}

          <Section>
            <ActionRow title="Добавить интеграцию" icon="plus.circle.fill" onPress={() => router.push('/manage/settings/integration-store')} />
          </Section>
        </Form>
      </Host>
    </>
  );
}
