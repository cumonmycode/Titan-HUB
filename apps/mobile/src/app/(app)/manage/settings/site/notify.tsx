import { ContentUnavailableView, Form, Host, ProgressView, Section, Text } from '@expo/ui/swift-ui';
import { refreshable } from '@expo/ui/swift-ui/modifiers';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';

import { LinkRow } from '@/components/native-form';
import { haptic } from '@/lib/haptics';
import { saveSite, useSiteConfig, type NotifyChat } from '@/lib/site-api';

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const keyOf = (c: NotifyChat | null | undefined) => (c ? `${c.chatId}|${c.threadId ?? ''}` : '');

/**
 * Кто узнаёт о заявках с сайта. Push — всегда владельцам и администратору открытой
 * смены. Чат персонала в Telegram — по выбору: бот групп клуба присылает заявку с
 * контактами гостя и дописывает итог. Гостю статус и напоминание присылает
 * клиентский бот клуба, если гость нажал «Получать статус в Telegram».
 */
export default function SiteNotifyScreen() {
  const config = useSiteConfig();
  const [picked, setPicked] = useState<string | null>(null);

  if (!config.data) {
    return (
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        {config.isError ? <ContentUnavailableView title="Нет связи" systemImage="wifi.exclamationmark" description={config.error.message} /> : <ProgressView />}
      </Host>
    );
  }
  const c = config.data;
  const current = picked ?? keyOf(c.notifyChat);
  const groups = (c.chats ?? []).filter((chat) => chat.type !== 'private');

  const choose = (value: string) => {
    if (value === current) return;
    haptic.selection();
    setPicked(value);
    const [chatId, thread] = value.split('|');
    saveSite({ notifyChat: chatId ? { chatId, threadId: thread ? Number(thread) : null } : null })
      .then(() => haptic.success())
      .catch((error: unknown) => {
        haptic.error();
        setPicked(null);
        Alert.alert('Не сохранилось', errorText(error));
      });
  };
  const option = (value: string, title: string, subtitle?: string) => (
    <LinkRow
      key={value || 'none'}
      icon={current === value ? 'checkmark.circle.fill' : 'circle'}
      color={current === value ? '#7C4DFF' : '#8E8E93'}
      title={title}
      subtitle={subtitle}
      chevron={false}
      onPress={c.staffBot ? () => choose(value) : undefined}
    />
  );

  return (
    <>
      <Stack.Title>Уведомления</Stack.Title>
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <Form modifiers={[refreshable(async () => { await config.refetch(); })]}>
          <Section title="Персоналу" footer={<Text>Push о каждой заявке приходит владельцам и администратору открытой смены — с именем и телефоном гостя.</Text>}>
            <LinkRow icon="iphone.radiowaves.left.and.right" color="#FF3B30" title="Push в HUB" subtitle="Владельцам и администратору смены" value="Всегда" chevron={false} />
          </Section>

          <Section
            title="Чат персонала в Telegram"
            footer={
              <Text>
                {!c.staffBot
                  ? 'Подключите бота групп клуба в «Опросах» — он пишет заявки в чат.'
                  : groups.length
                    ? 'Заявка приходит с кнопками WhatsApp и Telegram гостя, итог бот дописывает в то же сообщение.'
                    : 'Бот ещё не видел ни одного чата — добавьте его в чат персонала и напишите там сообщение.'}
              </Text>
            }>
            {option('', 'Не отправлять')}
            {groups.flatMap((chat) => [
              option(`${chat.id}|`, chat.title ?? chat.id, chat.topics.length ? 'Весь чат' : undefined),
              ...chat.topics.map((t) => option(`${chat.id}|${t.threadId}`, t.name ?? `Тема ${t.threadId}`, chat.title ?? undefined)),
            ])}
          </Section>

          <Section title="Гостям" footer={<Text>После заявки на сайте гость может нажать «Получать статус в Telegram» — бот пришлёт подтверждение или отказ и напомнит в день визита.</Text>}>
            <LinkRow
              icon="paperplane.fill"
              color={c.guestBot ? '#30D158' : '#FF9F0A'}
              title={c.guestBot ? `@${c.guestBot}` : 'Бот не подключён'}
              subtitle={c.guestBot ? 'Статус заявки и напоминание' : 'Подключите клиентского бота (My Titan) в интеграциях'}
              chevron={false}
            />
          </Section>
        </Form>
      </Host>
    </>
  );
}
