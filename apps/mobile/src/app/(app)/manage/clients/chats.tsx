import { ContentUnavailableView, Form, Host, ProgressView, Section, Text, Toggle } from '@expo/ui/swift-ui';
import { refreshable } from '@expo/ui/swift-ui/modifiers';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Alert } from 'react-native';

import { haptic } from '@/lib/haptics';
import { queryClient } from '@/lib/query';
import { useClubKey } from '@/lib/queries';
import { setClientChat, useClientChats, type AccessReason, type ClientChats } from '@/lib/telegram-api';

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const REASON: Record<AccessReason, string> = {
  manual: 'открыт вручную',
  everyone: 'чат открыт всем',
  staff: 'как сотруднику',
  games: 'по виду игры',
};
const GAMES: Record<NonNullable<ClientChats['games']>, string> = { sport: 'спортивная мафия', city: 'городская мафия', both: 'спортивная и городская' };

/**
 * В какие чаты Telegram клиенту можно: Tai даст ему ссылку в личке и пропустит его заявку.
 * Правила чата (всем, сотрудникам, по виду игры) — в настройках чата; здесь — ручной доступ.
 */
export default function ClientChatsScreen() {
  const { clientId } = useLocalSearchParams<{ clientId: string }>();
  const club = useClubKey();
  const query = useClientChats(clientId);
  const data = query.data;
  const key = [club, 'telegram', 'client-chats', clientId];

  if (!data) {
    return (
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        {query.isError ? <ContentUnavailableView title="Не загрузилось" systemImage="wifi.exclamationmark" description={errorText(query.error)} /> : <ProgressView />}
      </Host>
    );
  }

  const toggle = (chatId: string, allow: boolean) => {
    haptic.selection();
    queryClient.setQueryData<ClientChats>(key, {
      ...data,
      items: data.items.map((item) => (item.chatId === chatId ? { ...item, manual: allow, reason: allow ? 'manual' : item.reason === 'manual' ? null : item.reason } : item)),
    });
    setClientChat(clientId, chatId, allow)
      .then(() => queryClient.invalidateQueries({ queryKey: key }))
      .catch((error: unknown) => {
        void queryClient.invalidateQueries({ queryKey: key });
        Alert.alert('Не сохранилось', errorText(error));
      });
  };

  const about = [
    data.games ? `Играет: ${GAMES[data.games]}.` : 'Во что играет — пока неизвестно (Tai спросит сам).',
    data.pending ? 'Анкета ещё не подтверждена — до подтверждения проходят только чаты, открытые вручную.' : null,
    data.hasTelegram ? null : 'Telegram не привязан — ссылку он получит после привязки.',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <>
      <Stack.Title>Чаты Telegram</Stack.Title>
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <Form modifiers={[refreshable(async () => void (await query.refetch()))]}>
          <Section footer={<Text>{about}</Text>}>
            <Text>Отмеченные чаты Tai даст по просьбе в личке и пропустит заявку на вступление.</Text>
          </Section>
          {data.items.length ? (
            <Section title="Чаты клуба" footer={<Text>Выключить можно только ручной доступ: доступ по правилам чата настраивается в самом чате.</Text>}>
              {data.items.map((item) => {
                const byRule = item.reason && item.reason !== 'manual';
                const label = `${item.title || 'Чат'}${byRule ? ` — ${REASON[item.reason!]}` : ''}${!item.invite ? ' (ссылки выключены)' : ''}`;
                return <Toggle key={item.chatId} label={label} isOn={item.manual || !!byRule} onIsOnChange={(on) => (byRule && !item.manual ? undefined : toggle(item.chatId, on))} />;
              })}
            </Section>
          ) : (
            <Section>
              <Text>Бот пока не состоит ни в одном игровом или рабочем чате.</Text>
            </Section>
          )}
        </Form>
      </Host>
    </>
  );
}
