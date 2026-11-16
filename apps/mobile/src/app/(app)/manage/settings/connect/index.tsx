import { ContentUnavailableView, Form, Host, ProgressView, RNHostView, Section, Text } from '@expo/ui/swift-ui';
import { refreshable } from '@expo/ui/swift-ui/modifiers';
import { Stack, useRouter } from 'expo-router';
import { Share } from 'react-native';

import { ConnectHero } from '@/components/connect/connect-parts';
import { ActionRow, LinkRow } from '@/components/native-form';
import { connectionSummary, developerGuide, useConnect } from '@/lib/connect-api';
import { colors } from '@/lib/theme';

/**
 * Titan Connect — своя интеграция HUB: сторонние сервисы получают данные клиентов клуба.
 * Здесь — подключённые сервисы, «Подключить сервис» (имя, права → одноразовый код) и
 * памятка для разработчика сервиса.
 */
export default function ConnectScreen() {
  const router = useRouter();
  const connect = useConnect();

  if (!connect.data) {
    return (
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        {connect.isError ? <ContentUnavailableView title="Нет связи" systemImage="wifi.exclamationmark" description={connect.error.message} /> : <ProgressView />}
      </Host>
    );
  }

  const { items, apiBase } = connect.data;
  const open = (id: string) => router.push({ pathname: '/manage/settings/connect/connection', params: { id } });

  return (
    <>
      <Stack.Title>Titan Connect</Stack.Title>
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <Form modifiers={[refreshable(async () => void (await connect.refetch()))]}>
          <Section>
            <RNHostView matchContents>
              <ConnectHero />
            </RNHostView>
          </Section>

          {items.length ? (
            <Section title="Сервисы" footer={<Text>Нажмите на сервис, чтобы изменить права, выдать новый код или отключить.</Text>}>
              {items.map((c) => (
                <LinkRow
                  key={c.id}
                  icon={c.status === 'active' ? 'checkmark.circle.fill' : 'hourglass'}
                  color={c.status === 'active' ? colors.green : colors.orange}
                  title={c.name}
                  subtitle={connectionSummary(c)}
                  onPress={() => open(c.id)}
                />
              ))}
            </Section>
          ) : null}

          <Section footer={<Text>Выберите, какие данные увидит сервис, и получите одноразовый код. Сервис вводит его один раз — дальше подключение работает само.</Text>}>
            <ActionRow title="Подключить сервис" icon="plus.circle.fill" onPress={() => router.push('/manage/settings/connect/new')} />
          </Section>

          <Section title="Для разработчика" footer={<Text>Памятка: куда отправить код, как ходить за клиентами и как получать только изменения.</Text>}>
            <LinkRow title="Адрес API" subtitle={apiBase} chevron={false} />
            <ActionRow title="Отправить памятку разработчику" icon="square.and.arrow.up" onPress={() => void Share.share({ message: developerGuide(apiBase) })} />
          </Section>
        </Form>
      </Host>
    </>
  );
}
