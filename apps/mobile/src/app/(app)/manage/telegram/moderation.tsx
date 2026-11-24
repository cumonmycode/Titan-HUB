import { ContentUnavailableView, Form, Host, ProgressView, Section, Text, Toggle } from '@expo/ui/swift-ui';
import { Stack, useLocalSearchParams } from 'expo-router';

import { LinkRow } from '@/components/native-form';
import { useTelegramChat } from '@/lib/telegram-api';

/** Админские команды чата: /mute, /mutechat, /ban и др. — администраторам чата и владельцу клуба. */
export default function ChatModerationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const editor = useTelegramChat(id);
  const detail = editor.query.data;

  if (!detail) {
    return (
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        {editor.query.isError ? <ContentUnavailableView title="Чат не найден" systemImage="bubble.left.and.exclamationmark.bubble.right" /> : <ProgressView />}
      </Host>
    );
  }

  const { moderation } = detail.config;
  const rights = detail.live?.reachable ? detail.live.rights : null;
  const missing = rights && (!rights.admin || !rights.restrictMembers);

  return (
    <>
      <Stack.Title>Модерация</Stack.Title>
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <Form>
          <Section
            footer={
              <Text>
                {missing
                  ? 'Боту нужно право администратора «Блокировка участников» — иначе мут и бан не сработают.'
                  : 'Команды работают у администраторов чата в Telegram и у владельца клуба. В меню «/» они видны только админам.'}
              </Text>
            }>
            <Toggle label="Админские команды" isOn={moderation.on} onIsOnChange={(on) => editor.save({ moderation: { on } })} />
          </Section>

          {moderation.on ? (
            <Section title="Команды" footer={<Text>Срок — 30с, 10м, 2ч, 1д или просто число минут. Мут и бан снимаются сами по сроку, закрытый чат откроется сам.</Text>}>
              {detail.moderationCommands.map((cmd) => (
                <LinkRow key={cmd.name} icon="shield.lefthalf.filled" color="#FF3B30" title={`/${cmd.name}`} subtitle={cmd.description} chevron={false} />
              ))}
            </Section>
          ) : null}
        </Form>
      </Host>
    </>
  );
}
