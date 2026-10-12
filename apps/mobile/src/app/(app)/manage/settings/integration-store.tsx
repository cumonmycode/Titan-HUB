import { Form, Host, ProgressView, Section } from '@expo/ui/swift-ui';
import { Stack, useRouter } from 'expo-router';

import { LinkRow } from '@/components/native-form';
import { useIntegrations } from '@/lib/admin-api';
import { CATALOG, GROUPS, openIntegration, statusOf, useGomafiaStatus } from '@/lib/integrations';
import { colors } from '@/lib/theme';

/** Каталог интеграций по группам: иконка, название, что делает; установленные отмечены. */
export default function IntegrationStoreScreen() {
  const router = useRouter();
  const integrations = useIntegrations(true);
  const gomafia = useGomafiaStatus();

  if (!integrations.data) {
    return (
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <ProgressView />
      </Host>
    );
  }
  const items = integrations.data;

  return (
    <>
      <Stack.Title>Добавить интеграцию</Stack.Title>
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <Form>
          {GROUPS.map((group) => {
            const products = CATALOG.filter((p) => p.group === group.key);
            if (!products.length) return null;
            return (
              <Section key={group.key} title={group.title}>
                {products.map((product) => {
                  const installed = statusOf(product, items, gomafia.data).installed;
                  return (
                    <LinkRow
                      key={product.id}
                      icon={product.symbol}
                      color={product.color}
                      title={product.name}
                      subtitle={product.blurb}
                      value={installed ? 'Установлено' : undefined}
                      valueColor={installed ? colors.green : undefined}
                      onPress={() => openIntegration(router, product)}
                    />
                  );
                })}
              </Section>
            );
          })}
        </Form>
      </Host>
    </>
  );
}
