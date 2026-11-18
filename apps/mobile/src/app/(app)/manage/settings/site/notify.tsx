import { ContentUnavailableView, Form, Host, ProgressView, Section, Text } from '@expo/ui/swift-ui';
import { refreshable } from '@expo/ui/swift-ui/modifiers';
import { Stack, useRouter } from 'expo-router';

import { LinkRow } from '@/components/native-form';
import { useSiteConfig } from '@/lib/site-api';

/**
 * Кто узнаёт о заявках с сайта. Push — всегда владельцам и администратору открытой
 * смены. Чат персонала в Telegram выбирается в разделе «Telegram» (уведомления чата →
 * «Заявки с сайта»): там же все остальные уведомления, без второго места для выбора.
 * Гостю статус и напоминание присылает клиентский бот, если гость нажал «Получать
 * статус в Telegram».
 */
export default function SiteNotifyScreen() {
  const router = useRouter();
  const config = useSiteConfig();

  if (!config.data) {
    return (
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        {config.isError ? <ContentUnavailableView title="Нет связи" systemImage="wifi.exclamationmark" description={config.error.message} /> : <ProgressView />}
      </Host>
    );
  }
  const c = config.data;
  const chat = c.notifyChat ? (c.chats ?? []).find((item) => String(item.id) === c.notifyChat!.chatId) : null;
  const topic = chat && c.notifyChat?.threadId != null ? chat.topics.find((t) => String(t.threadId) === String(c.notifyChat!.threadId)) : null;
  const chatName = c.notifyChat ? [chat?.title ?? `Чат ${c.notifyChat.chatId}`, topic?.name].filter(Boolean).join(' › ') : null;
  const openChat = () =>
    c.notifyChat ? router.push({ pathname: '/manage/telegram/notify', params: { id: c.notifyChat.chatId } }) : router.push('/manage/telegram');

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
                {c.notifyChat
                  ? 'Заявка приходит с кнопками «Подтвердить» и «Отклонить», итог бот дописывает в то же сообщение. Сменить чат — в разделе «Telegram».'
                  : 'Выберите чат в разделе «Telegram»: откройте чат персонала → Уведомления → «Заявки с сайта».'}
              </Text>
            }>
            <LinkRow icon="paperplane.fill" color="#2AABEE" title={chatName ?? 'Не отправлять в чат'} subtitle={c.staffBot ? undefined : 'Бот клуба не подключён'} onPress={openChat} />
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
