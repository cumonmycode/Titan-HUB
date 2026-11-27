import { Button, ContentUnavailableView, Form, HStack, Host, Picker, ProgressView, RNHostView, Section, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import { font, foregroundStyle, lineLimit, pickerStyle, refreshable, tag } from '@expo/ui/swift-ui/modifiers';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';

import { LinkRow, primary, secondary } from '@/components/native-form';
import { Avatar } from '@/components/new-check-parts';
import { whenText } from '@/lib/clients-api';
import { haptic } from '@/lib/haptics';
import { plural } from '@/lib/format';
import { lastLine, resumeText, useTaiChats, type InboxChat, type InboxFilter } from '@/lib/tai-inbox-api';


const ATTENTION_COLOR = '#FF9500';
const TAI_COLOR = '#8B5CF6';
const STAFF_COLOR = '#007AFF';

/**
 * «Диалоги Tai» — вся личная переписка Tai с клиентами в боте клуба, как диалоги бота
 * в MIKAN. Сверху — те, кто ждёт человека (Tai на паузе, а клиент написал, или Tai
 * позвал администратора). Тап открывает переписку: прочитать и ответить самому.
 */
export default function TaiChatsScreen() {
  const router = useRouter();
  const [filter, setFilter] = useState<InboxFilter>('all');
  const chats = useTaiChats(filter);
  // Счётчики категорий — всегда по всем диалогам.
  const all = useTaiChats('all');
  const items = chats.data?.items ?? [];
  const attention = all.data?.attention ?? 0;
  const counts = all.data?.counts;
  const label = (title: string, n: number | undefined) => (n ? `${title} · ${n}` : title);

  const open = (chat: InboxChat) => {
    haptic.selection();
    router.push({ pathname: '/tai-dialog', params: { tgId: chat.tgId } });
  };

  return (
    <>
      <Stack.Title>Диалоги Tai</Stack.Title>
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <Form modifiers={[refreshable(async () => void (await Promise.allSettled([chats.refetch(), all.refetch()])))]}>
          <Section
            footer={
              <Text>«Новые» — ещё не клиенты: нет в базе или ни разу не приходили. Tai отвечает сам; напишите в диалоге — Tai встанет на паузу, пока вы его не вернёте.</Text>
            }>
            <Picker
              selection={filter === 'attention' ? 'all' : filter}
              onSelectionChange={(value) => {
                haptic.selection();
                setFilter(value as InboxFilter);
              }}
              modifiers={[pickerStyle('segmented')]}>
              <Text modifiers={[tag('all')]}>Все</Text>
              <Text modifiers={[tag('potential')]}>{label('Новые', counts?.potential)}</Text>
              <Text modifiers={[tag('client')]}>{label('Клиенты', counts?.client)}</Text>
              <Text modifiers={[tag('staff')]}>Команда</Text>
            </Picker>
          </Section>

          {attention > 0 || filter === 'attention' ? (
            <Section>
              <LinkRow
                icon={filter === 'attention' ? 'list.bullet' : 'exclamationmark.bubble.fill'}
                color={ATTENTION_COLOR}
                title={filter === 'attention' ? 'Показать все диалоги' : `Ждут ответа · ${attention}`}
                subtitle={filter === 'attention' ? undefined : 'Tai на паузе или позвал администратора'}
                onPress={() => setFilter(filter === 'attention' ? 'all' : 'attention')}
              />
            </Section>
          ) : null}

          {chats.isLoading ? (
            <Section>
              <ProgressView />
            </Section>
          ) : chats.isError && !items.length ? (
            <Section>
              <ContentUnavailableView title="Не загрузилось" systemImage="wifi.exclamationmark" description={chats.error.message} />
            </Section>
          ) : items.length === 0 ? (
            <Section>
              <ContentUnavailableView
                title={filter === 'attention' ? 'Никто не ждёт' : filter === 'potential' ? 'Новых нет' : 'Диалогов пока нет'}
                systemImage="bubble.left.and.text.bubble.right"
                description={filter === 'attention' ? 'Все клиенты получили ответ.' : 'Здесь появится переписка, когда клиенты напишут боту клуба.'}
              />
            </Section>
          ) : (
            <Section>
              {items.map((chat) => (
                <ChatRow key={chat.tgId} chat={chat} onPress={() => open(chat)} />
              ))}
            </Section>
          )}
        </Form>
      </Host>
    </>
  );
}

function ChatRow({ chat, onPress }: { chat: InboxChat; onPress: () => void }) {
  const status = chat.needsAttention
    ? { text: 'ждёт ответа', color: ATTENTION_COLOR }
    : chat.aiPaused
      ? { text: chat.resumeAt ? `ведёт сотрудник · Tai ${resumeText(chat.resumeAt)}` : 'ведёт сотрудник', color: STAFF_COLOR }
      : chat.segment === 'staff'
        ? { text: 'команда', color: '#8E8E93' }
        : chat.segment === 'client'
          ? { text: `был ${chat.visits} ${plural(chat.visits, ['раз', 'раза', 'раз'])}`, color: '#34C759' }
          : { text: chat.profile ? 'ещё не был' : 'новый', color: TAI_COLOR };
  return (
    <Button onPress={onPress}>
      <HStack spacing={12}>
        <RNHostView matchContents>
          <Avatar name={chat.name} photoUrl={chat.profile?.photoUrl} size={44} />
        </RNHostView>
        <VStack alignment="leading" spacing={2}>
          <HStack spacing={6}>
            <Text modifiers={[primary, font({ weight: 'semibold' }), lineLimit(1)]}>{chat.name}</Text>
            <Text modifiers={[font({ textStyle: 'caption', weight: 'semibold' }), foregroundStyle(status.color), lineLimit(1)]}>{status.text}</Text>
          </HStack>
          <Text modifiers={[font({ textStyle: 'subheadline' }), secondary, lineLimit(2)]}>{lastLine(chat)}</Text>
        </VStack>
        <Spacer />
        <VStack alignment="trailing" spacing={4}>
          <Text modifiers={[font({ textStyle: 'caption' }), secondary, lineLimit(1)]}>{whenText(chat.updatedAt)}</Text>
          {chat.unread > 0 ? (
            <Text modifiers={[font({ textStyle: 'caption', weight: 'bold' }), foregroundStyle(chat.needsAttention ? ATTENTION_COLOR : TAI_COLOR)]}>{`● ${chat.unread}`}</Text>
          ) : null}
        </VStack>
      </HStack>
    </Button>
  );
}
