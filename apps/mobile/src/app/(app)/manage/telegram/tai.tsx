import { ContentUnavailableView, Form, Host, Picker, ProgressView, Section, Text, Toggle } from '@expo/ui/swift-ui';
import { pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import { Stack, useLocalSearchParams } from 'expo-router';

import { FieldRow, LinkRow } from '@/components/native-form';
import { useTelegramChat, type Chime, type Harshness } from '@/lib/telegram-api';
import { useAccentHex } from '@/lib/theme';

const CHIMES: { key: Chime; label: string }[] = [
  { key: 'off', label: 'Никогда' },
  { key: 'rare', label: 'Изредка' },
  { key: 'often', label: 'Почаще' },
];
const CUSTOM_MAX = 600;

const HARSH: { key: Harshness; label: string }[] = [
  { key: 'soft', label: 'Мягко' },
  { key: 'medium', label: 'Средне' },
  { key: 'savage', label: 'Жёстко' },
];

/**
 * Tai в одном чате: отвечает ли, каким стилем, насколько остро, можно ли материться,
 * свои указания владельца и как сам вступает в разговор. Всё — только для этого чата.
 */
export default function ChatTaiScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const accent = useAccentHex();
  const editor = useTelegramChat(id);
  const detail = editor.query.data;

  if (!detail) {
    return (
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        {editor.query.isError ? <ContentUnavailableView title="Чат не найден" systemImage="bubble.left.and.exclamationmark.bubble.right" /> : <ProgressView />}
      </Host>
    );
  }

  const { tai, mode } = detail.config;
  const work = mode === 'work';
  const onFooter = work
    ? 'Tai отвечает сотрудникам на «Тай, …» или ответом на его сообщение — с правами того, кто спросил. Клиентам в рабочем чате он вежливо отказывает.'
    : 'Tai отвечает, когда к нему обращаются: «Тай, …», @бот или ответом на его сообщение. Не чаще раза в 12 секунд на человека.';

  return (
    <>
      <Stack.Title>Tai в чате</Stack.Title>
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <Form>
          <Section footer={<Text>{onFooter}</Text>}>
            <Toggle label={work ? 'Отвечать сотрудникам' : 'Шутить в этом чате'} isOn={tai.on} onIsOnChange={(on) => editor.save({ tai: { on } })} />
          </Section>

          {tai.on ? (
            <>
              <Section title="Стиль общения">
                {detail.presets.map((preset) => {
                  const selected = preset.key === tai.preset;
                  return (
                    <LinkRow
                      key={preset.key}
                      icon={selected ? 'checkmark.circle.fill' : 'circle'}
                      color={selected ? accent : '#C7C7CC'}
                      title={preset.label}
                      subtitle={preset.desc}
                      chevron={false}
                      onPress={selected ? undefined : () => editor.save({ tai: { preset: preset.key } })}
                    />
                  );
                })}
              </Section>

              <Section
                title="Жёсткость"
                footer={<Text>Насколько остро Tai шутит и подкалывает. Рамки — всегда: без оскорблений по национальности, религии, полу и ориентации, без угроз.</Text>}>
                <Picker selection={tai.harshness} onSelectionChange={(value) => editor.save({ tai: { harshness: value as Harshness } })} modifiers={[pickerStyle('segmented')]}>
                  {HARSH.map((h) => (
                    <Text key={h.key} modifiers={[tag(h.key)]}>
                      {h.label}
                    </Text>
                  ))}
                </Picker>
              </Section>

              <Section footer={<Text>Только в этом чате. В личке с клиентами Tai никогда не матерится.</Text>}>
                <Toggle label="Можно материться" isOn={tai.profanity} onIsOnChange={(on) => editor.save({ tai: { profanity: on } })} />
              </Section>

              <Section
                title="Свои указания"
                footer={<Text>Кто Tai в этом чате и как себя вести — важнее стиля. Например: «Ты ведущий турнира, зови всех по никам, не шути про судей». Сохраняется, когда закончите ввод.</Text>}>
                <FieldRow
                  value={tai.custom}
                  placeholder="Например: подкалывай Тигра за вечные промахи шерифом"
                  multiline
                  maxLength={CUSTOM_MAX}
                  onCommit={(custom) => editor.save({ tai: { custom } })}
                />
              </Section>

              {!work ? (
                <Section
                  title="Сам вступает в разговор"
                  footer={<Text>Иногда Tai сам вставляет реплику, когда в чате живо болтают, а изредка ставит реакции на сообщения. Не чаще раза в 8–25 минут.</Text>}>
                  <Picker selection={tai.chime} onSelectionChange={(value) => editor.save({ tai: { chime: value as Chime } })} modifiers={[pickerStyle('segmented')]}>
                    {CHIMES.map((c) => (
                      <Text key={c.key} modifiers={[tag(c.key)]}>
                        {c.label}
                      </Text>
                    ))}
                  </Picker>
                  <Toggle label="Ставить реакции" isOn={tai.reactions} onIsOnChange={(on) => editor.save({ tai: { reactions: on } })} />
                </Section>
              ) : null}
            </>
          ) : null}
        </Form>
      </Host>
    </>
  );
}
