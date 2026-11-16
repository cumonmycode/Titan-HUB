import { ContentUnavailableView, Form, Host, ProgressView, RNHostView, Section, Text } from '@expo/ui/swift-ui';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Alert, Share } from 'react-native';

import { CodeCard, ScopeToggle } from '@/components/connect/connect-parts';
import { ActionRow, LinkRow } from '@/components/native-form';
import { cancelCode, issueCode, relativeTime, removeConnection, shareText, updateConnection, useConnect, useIssuedCodes, type ConnectConnection } from '@/lib/connect-api';
import { promptText } from '@/lib/dialog';
import { haptic } from '@/lib/haptics';
import { colors } from '@/lib/theme';

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const fail = (error: unknown) => {
  haptic.error();
  Alert.alert('Не получилось', errorText(error));
};

const NUMBER = new Intl.NumberFormat('ru-RU');

/**
 * Одно подключение: живой код (если ждёт ввода), что за сервис и когда он ходил, права
 * (меняются сразу, без переподключения), новый код и отключение.
 */
export default function ConnectionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const connect = useConnect();

  if (!connect.data) {
    return (
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <ProgressView />
      </Host>
    );
  }
  const conn = connect.data.items.find((c) => c.id === id);
  if (!conn) {
    return (
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <ContentUnavailableView title="Подключение не найдено" systemImage="link" description="Его уже отключили." />
      </Host>
    );
  }
  const active = conn.status === 'active';

  const setScope = (key: string, on: boolean) => {
    const next = on ? [...conn.scopes, key] : conn.scopes.filter((k) => k !== key);
    void updateConnection(conn.id, { scopes: next }).then(() => haptic.selection(), fail);
  };

  const rename = () =>
    promptText(
      'Название',
      undefined,
      [
        { text: 'Отмена', style: 'cancel' },
        { text: 'Сохранить', onPress: (value) => void (value?.trim() && updateConnection(conn.id, { name: value.trim() }).then(() => haptic.success(), fail)) },
      ],
      'plain-text',
      conn.name,
    );

  const newCode = () => {
    const run = () => void issueCode(conn.id).then(() => haptic.success(), fail);
    if (!active) return run();
    Alert.alert('Переподключить сервис?', 'Новый код нужен, если сервис потерял ключ. Как только сервис введёт новый код, прежний ключ перестанет работать.', [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Получить код', onPress: run },
    ]);
  };

  const disconnect = () =>
    Alert.alert(`Отключить «${conn.name}»?`, 'Сервис сразу потеряет доступ к данным клиентов. Подключить снова можно только новым кодом.', [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Отключить',
        style: 'destructive',
        onPress: () =>
          void removeConnection(conn.id).then(() => {
            haptic.success();
            router.back();
          }, fail),
      },
    ]);

  return (
    <>
      <Stack.Title>{conn.name}</Stack.Title>
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <Form>
          {conn.codeExpiresAt ? <CodeSections conn={conn} apiBase={connect.data.apiBase} /> : null}

          <Section title="Подключение">
            <LinkRow
              icon={active ? 'checkmark.circle.fill' : 'hourglass'}
              color={active ? colors.green : colors.orange}
              title={active ? 'Подключено' : 'Ждёт ввода кода'}
              value={active && conn.connectedAt ? relativeTime(conn.connectedAt) : undefined}
              chevron={false}
            />
            {conn.serviceName ? <LinkRow title="Сервис" value={conn.serviceName} chevron={false} /> : null}
            {conn.serviceUrl ? <LinkRow title="Сайт" value={conn.serviceUrl.replace(/^https?:\/\//, '')} chevron={false} /> : null}
            {active ? <LinkRow title="Последний запрос" value={relativeTime(conn.lastUsedAt)} chevron={false} /> : null}
            {active ? <LinkRow title="Запросов всего" value={NUMBER.format(conn.requestCount)} chevron={false} /> : null}
            {conn.tokenPrefix ? <LinkRow title="Ключ" value={`${conn.tokenPrefix}…`} chevron={false} /> : null}
            <ActionRow title="Переименовать" icon="pencil" onPress={rename} />
          </Section>

          <Section title="Что видит сервис" footer={<Text>Изменения действуют со следующего запроса сервиса — переподключать не нужно.</Text>}>
            {connect.data.scopes.map((scope) => (
              <ScopeToggle key={scope.key} scope={scope} on={conn.scopes.includes(scope.key)} onChange={(on) => setScope(scope.key, on)} />
            ))}
          </Section>

          <Section footer={<Text>{active ? 'Новый код нужен, только если сервис потерял ключ.' : 'Прошлый код истёк или отменён — выдайте новый.'}</Text>}>
            {conn.codeExpiresAt ? null : <ActionRow title={active ? 'Переподключить новым кодом' : 'Получить новый код'} icon="key.fill" onPress={newCode} />}
            <ActionRow title="Отключить" icon="xmark.circle" destructive onPress={disconnect} />
          </Section>
        </Form>
      </Host>
    </>
  );
}

/**
 * Живой код. Сервер отдаёт код только в момент выдачи; если он выдан на другом
 * устройстве или до перезапуска приложения, показываем «выдать заново» (старый заменится).
 */
function CodeSections({ conn, apiBase }: { conn: ConnectConnection; apiBase: string }) {
  const issued = useIssuedCodes((s) => s.codes[conn.id]);
  const code = issued && conn.codeExpiresAt && issued.expiresAt === conn.codeExpiresAt ? issued : null;
  return (
    <>
      <Section title="Одноразовый код" footer={<Text>Введите код в стороннем сервисе. Экран сам покажет, когда сервис подключится.</Text>}>
        {code ? (
          <RNHostView matchContents>
            <CodeCard code={code.code} expiresAt={code.expiresAt} />
          </RNHostView>
        ) : (
          <LinkRow title="Код выдан" subtitle="Код виден только в момент выдачи — получите новый, чтобы его показать" chevron={false} />
        )}
      </Section>
      <Section>
        {code ? (
          <ActionRow title="Поделиться кодом" icon="square.and.arrow.up" onPress={() => void Share.share({ message: shareText(conn.name, code.code, apiBase) })} />
        ) : (
          <ActionRow title="Показать новый код" icon="key.fill" onPress={() => void issueCode(conn.id).then(() => haptic.success(), fail)} />
        )}
        <ActionRow title="Отменить код" icon="xmark" onPress={() => void cancelCode(conn.id).then(() => haptic.selection(), fail)} />
      </Section>
    </>
  );
}
