import { ContentUnavailableView, Form, Host, Picker, ProgressView, Section, Text, Toggle } from '@expo/ui/swift-ui';
import { pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import { Stack, useLocalSearchParams } from 'expo-router';

import { useTelegramChat, type ChatDetail, type NotifyCategory } from '@/lib/telegram-api';

const GENERAL = 'general';
type Target = { on: boolean; threadId: number | null };

/**
 * Уведомления клуба в этот чат: что присылать и, в чате с темами, в какую тему.
 * Те же события, что приходят персоналу в приложение, — здесь их видит весь чат.
 */
export default function ChatNotifyScreen() {
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

  const set = (key: NotifyCategory, next: Target) => editor.save({ notify: { [key]: next } });

  return (
    <>
      <Stack.Title>Уведомления</Stack.Title>
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <Form>
          {detail.config.mode === 'game' ? (
            <Section>
              <Text>Это игровой чат — его видят клиенты. Рабочие уведомления лучше присылать в чат персонала.</Text>
            </Section>
          ) : null}

          {detail.categories.map((category) => (
            <CategorySection
              key={category.key}
              category={category}
              target={detail.config.notify[category.key]}
              topics={detail.chat.topics}
              onChange={(next) => set(category.key, next)}
            />
          ))}
        </Form>
      </Host>
    </>
  );
}

function CategorySection({
  category,
  target,
  topics,
  onChange,
}: {
  category: ChatDetail['categories'][number];
  target: Target;
  topics: ChatDetail['chat']['topics'];
  onChange: (next: Target) => void;
}) {
  return (
    <Section footer={<Text>{category.about}</Text>}>
      <Toggle label={category.title} isOn={target.on} onIsOnChange={(on) => onChange({ on, threadId: target.threadId })} />
      {target.on && topics.length ? (
        <Picker
          label="Тема"
          selection={target.threadId == null ? GENERAL : String(target.threadId)}
          onSelectionChange={(value) => onChange({ on: true, threadId: value === GENERAL ? null : Number(value) })}
          modifiers={[pickerStyle('menu')]}>
          <Text modifiers={[tag(GENERAL)]}>Общий чат</Text>
          {topics.map((topic) => (
            <Text key={topic.threadId} modifiers={[tag(String(topic.threadId))]}>
              {topic.name ?? `Тема ${topic.threadId}`}
            </Text>
          ))}
        </Picker>
      ) : null}
    </Section>
  );
}
