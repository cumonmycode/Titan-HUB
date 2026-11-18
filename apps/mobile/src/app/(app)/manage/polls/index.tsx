import { ContentUnavailableView, Form, Host, LabeledContent, ProgressView, Section, Text, Toggle } from '@expo/ui/swift-ui';
import { foregroundStyle, refreshable } from '@expo/ui/swift-ui/modifiers';
import { Stack, useRouter } from 'expo-router';
import { Alert } from 'react-native';

import { ActionRow, LinkRow } from '@/components/native-form';
import { setPollCollect, usePollChats, usePollCollect, usePolls, WEEKDAY_LABELS, type PollConfig } from '@/lib/admin-api';
import { haptic } from '@/lib/haptics';

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** «Пн, Ср, Пт · 10:00» — когда бот выкладывает опрос. */
function scheduleText(poll: PollConfig): string {
  const days = poll.weekdays.length ? poll.weekdays.map((day) => WEEKDAY_LABELS[day - 1]).join(', ') : 'по кнопке';
  return `${days} · ${poll.postTime}`;
}

/** Опросы в Telegram: бот выкладывает сбор на игру по расписанию. */
export default function PollsScreen() {
  const router = useRouter();
  const polls = usePolls();
  const chats = usePollChats();
  const collect = usePollCollect();

  const chatName = (poll: PollConfig) => {
    const chat = chats.data?.find((item) => String(item.id) === String(poll.chatId));
    const topic = chat?.topics.find((item) => String(item.threadId) === String(poll.threadId));
    return [chat?.title ?? (poll.chatId ? `чат ${poll.chatId}` : 'чат не выбран'), topic?.name].filter(Boolean).join(' › ');
  };

  const configs = polls.data?.configs ?? [];
  const tokenConfigured = polls.data?.tokenConfigured ?? false;
  const saved = (promise: Promise<unknown>) =>
    void promise.then(() => haptic.success()).catch((error: unknown) => Alert.alert('Не сохранено', errorText(error)));

  return (
    <>
      <Stack.Title>Опросы</Stack.Title>
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <Form modifiers={[refreshable(async () => void (await Promise.allSettled([polls.refetch(), chats.refetch(), collect.refetch()])))]}>
          <Section title="Опросы" footer={<Text>Бот выкладывает опрос в выбранный чат в указанные дни. Чтобы чат появился в списке, добавьте бота в группу.</Text>}>
            {polls.isLoading ? (
              <ProgressView />
            ) : configs.length === 0 ? (
              <ContentUnavailableView title="Опросов пока нет" systemImage="checklist" description="Бот будет выкладывать опрос по расписанию." />
            ) : (
              configs.map((poll) => (
                <LinkRow
                  key={poll.id}
                  icon="checklist"
                  color={poll.enabled ? '#FF3B30' : '#8E8E93'}
                  title={poll.title || 'Без названия'}
                  subtitle={`${chatName(poll)} · ${scheduleText(poll)}`}
                  value={poll.enabled ? undefined : 'Выкл.'}
                  onPress={() => router.push({ pathname: '/manage/polls/edit', params: { pollId: poll.id } })}
                />
              ))
            )}
            <ActionRow title="Новый опрос" icon="plus.circle.fill" onPress={() => router.push('/manage/polls/edit')} />
          </Section>

          <Section footer={<Text>Команды-отметки (@all, @tvari…) и кто может их вызывать — у каждого чата свои.</Text>}>
            <LinkRow icon="command" color="#5856D6" title="Чаты и команды" subtitle="Раздел «Telegram»" onPress={() => router.push('/manage/telegram')} />
          </Section>

          <Section title="Бот" footer={<Text>{tokenConfigured ? 'Опросы выкладывает бот клуба.' : 'Без бота опрос не выложится. Подключите его в «Интеграциях».'}</Text>}>
            <LabeledContent label="Токен бота">
              <Text modifiers={[foregroundStyle(tokenConfigured ? '#34C759' : '#FF9500')]}>{tokenConfigured ? (polls.data?.tokenMasked ?? 'задан') : 'не задан'}</Text>
            </LabeledContent>
            <Toggle label="Собирать ответы" isOn={collect.data?.enabled ?? false} onIsOnChange={(on) => saved(setPollCollect(on))} />
          </Section>
        </Form>
      </Host>
    </>
  );
}
