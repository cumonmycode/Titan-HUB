import { ContentUnavailableView, Form, Host, Picker, ProgressView, Section, Text, Toggle } from '@expo/ui/swift-ui';
import { pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import { Stack, useLocalSearchParams } from 'expo-router';

import { useTelegramChat, type FunKind } from '@/lib/telegram-api';

const GENERAL = 'general';
const PER_DAY = [1, 2, 3, 4, 6];
const HOURS = Array.from({ length: 25 }, (_, h) => h);
const KINDS: { key: FunKind; title: string; about: string }[] = [
  { key: 'fact', title: 'Интересные факты', about: 'Наука, история, психология — неожиданное и правдивое' },
  { key: 'joke', title: 'Шутки и приколы', about: 'Про мафию, игры и ночную жизнь клуба' },
  { key: 'mafia', title: 'Советы по мафии', about: 'Тактика и история игры' },
  { key: 'question', title: 'Вопросы чату', about: 'Повод поспорить и разговориться' },
];

const hourText = (h: number) => `${String(h).padStart(2, '0')}:00`;

/** Tai сам присылает в чат приколы и факты: сколько раз в день, в какие часы, что и в какую тему. */
export default function ChatFunScreen() {
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

  const { fun } = detail.config;
  const topics = detail.chat.topics;
  const toggleKind = (key: FunKind, on: boolean) => {
    const next = on ? [...new Set([...fun.kinds, key])] : fun.kinds.filter((k) => k !== key);
    if (next.length) editor.save({ fun: { kinds: next } });
  };

  return (
    <>
      <Stack.Title>Приколы и факты</Stack.Title>
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <Form>
          <Section footer={<Text>Tai сам пишет в чат в случайное время в заданные часы, своим стилем этого чата и без повторов.</Text>}>
            <Toggle label="Присылать приколы и факты" isOn={fun.on} onIsOnChange={(on) => editor.save({ fun: { on } })} />
          </Section>

          {fun.on ? (
            <>
              <Section title="Как часто">
                <Picker label="В день" selection={fun.perDay} onSelectionChange={(value) => editor.save({ fun: { perDay: Number(value) } })} modifiers={[pickerStyle('menu')]}>
                  {PER_DAY.map((n) => (
                    <Text key={n} modifiers={[tag(n)]}>
                      {`${n} раз`}
                    </Text>
                  ))}
                </Picker>
                <Picker label="С" selection={fun.from} onSelectionChange={(value) => editor.save({ fun: { from: Number(value) } })} modifiers={[pickerStyle('menu')]}>
                  {HOURS.slice(0, 24).map((h) => (
                    <Text key={h} modifiers={[tag(h)]}>
                      {hourText(h)}
                    </Text>
                  ))}
                </Picker>
                <Picker label="До" selection={fun.to} onSelectionChange={(value) => editor.save({ fun: { to: Number(value) } })} modifiers={[pickerStyle('menu')]}>
                  {HOURS.slice(fun.from + 1).map((h) => (
                    <Text key={h} modifiers={[tag(h)]}>
                      {hourText(h)}
                    </Text>
                  ))}
                </Picker>
              </Section>

              <Section title="Что присылать" footer={<Text>Хотя бы что-то одно.</Text>}>
                {KINDS.map((kind) => (
                  <Toggle key={kind.key} label={kind.title} isOn={fun.kinds.includes(kind.key)} onIsOnChange={(on) => toggleKind(kind.key, on)} />
                ))}
              </Section>

              {topics.length ? (
                <Section title="Куда">
                  <Picker
                    label="Тема"
                    selection={fun.threadId == null ? GENERAL : String(fun.threadId)}
                    onSelectionChange={(value) => editor.save({ fun: { threadId: value === GENERAL ? null : Number(value) } })}
                    modifiers={[pickerStyle('menu')]}>
                    <Text modifiers={[tag(GENERAL)]}>Общий чат</Text>
                    {topics.map((topic) => (
                      <Text key={topic.threadId} modifiers={[tag(String(topic.threadId))]}>
                        {topic.name ?? `Тема ${topic.threadId}`}
                      </Text>
                    ))}
                  </Picker>
                </Section>
              ) : null}
            </>
          ) : null}
        </Form>
      </Host>
    </>
  );
}
