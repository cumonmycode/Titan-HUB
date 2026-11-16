import { Form, Host, ProgressView, RNHostView, Section, Text } from '@expo/ui/swift-ui';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Share } from 'react-native';

import { CodeCard, ScopeToggle } from '@/components/connect/connect-parts';
import { EditorToolbar } from '@/components/editor-toolbar';
import { ActionRow, FieldRow, LinkRow } from '@/components/native-form';
import { ToolbarButton } from '@/components/toolbar';
import { createConnection, shareText, useConnect, type IssuedCode } from '@/lib/connect-api';
import { haptic } from '@/lib/haptics';
import { colors } from '@/lib/theme';

const DEFAULT_SCOPES = ['clients:read', 'clients:photos'];

/**
 * Новое подключение: имя сервиса и какие данные он увидит → одноразовый код. Код
 * показывается здесь же; экран сам замечает, когда сервис ввёл код.
 */
export default function NewConnectionScreen() {
  const router = useRouter();
  const connect = useConnect();
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>(DEFAULT_SCOPES);
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<(IssuedCode & { id: string; name: string }) | null>(null);

  const toggle = (key: string, on: boolean) => setScopes((all) => (on ? [...all.filter((k) => k !== key), key] : all.filter((k) => k !== key)));

  const submit = async () => {
    setBusy(true);
    try {
      const result = await createConnection(name.trim(), scopes);
      haptic.success();
      setIssued({ id: result.connection.id, name: result.connection.name, code: result.code, expiresAt: result.expiresAt });
    } catch (error) {
      haptic.error();
      Alert.alert('Не получилось', error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  if (!connect.data) {
    return (
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <ProgressView />
      </Host>
    );
  }

  if (issued) {
    const connected = connect.data.items.find((c) => c.id === issued.id)?.status === 'active';
    return (
      <>
        <Stack.Title>{issued.name}</Stack.Title>
        <Stack.Toolbar placement="right">
          <ToolbarButton variant="done" tintColor={colors.accent} onPress={() => router.back()}>
            Готово
          </ToolbarButton>
        </Stack.Toolbar>
        <Host style={{ flex: 1 }} useViewportSizeMeasurement>
          <Form>
            {connected ? (
              <Section footer={<Text>Сервис сохранил ключ и больше не попросит код. Отключить его можно в любой момент в Titan Connect.</Text>}>
                <LinkRow icon="checkmark.circle.fill" color={colors.green} title="Сервис подключён" chevron={false} />
              </Section>
            ) : (
              <>
                <Section title="Одноразовый код" footer={<Text>Введите код в стороннем сервисе или отправьте его разработчику. Экран сам покажет, когда сервис подключится.</Text>}>
                  <RNHostView matchContents>
                    <CodeCard code={issued.code} expiresAt={issued.expiresAt} />
                  </RNHostView>
                </Section>
                <Section>
                  <ActionRow
                    title="Поделиться кодом"
                    icon="square.and.arrow.up"
                    onPress={() => void Share.share({ message: shareText(issued.name, issued.code, connect.data?.apiBase ?? '') })}
                  />
                </Section>
              </>
            )}
          </Form>
        </Host>
      </>
    );
  }

  return (
    <>
      <EditorToolbar title="Подключить сервис" canSave={name.trim().length > 0} busy={busy} saveLabel="Получить код" busyLabel="Создаём…" onSave={() => void submit()} />
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <Form>
          <Section title="Название" footer={<Text>Как сервис будет называться у вас в HUB, например «Сайт рейтинга» или «Бот турниров».</Text>}>
            <FieldRow value="" placeholder="Название сервиса" maxLength={60} autoFocus onChange={setName} />
          </Section>
          <Section title="Что увидит сервис" footer={<Text>Права можно поменять позже — переподключать сервис не придётся.</Text>}>
            {connect.data.scopes.map((scope) => (
              <ScopeToggle key={scope.key} scope={scope} on={scopes.includes(scope.key)} onChange={(on) => toggle(scope.key, on)} />
            ))}
          </Section>
        </Form>
      </Host>
    </>
  );
}
