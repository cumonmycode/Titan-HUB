import { ContentUnavailableView, Form, Host, Picker, ProgressView, Section, Text, Toggle } from '@expo/ui/swift-ui';
import { pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import { Stack, useLocalSearchParams } from 'expo-router';

import { LinkRow } from '@/components/native-form';
import { useTelegramChat, type Harshness } from '@/lib/telegram-api';
import { useAccentHex } from '@/lib/theme';

const HARSH: { key: Harshness; label: string }[] = [
  { key: 'soft', label: 'Мягко' },
  { key: 'medium', label: 'Средне' },
  { key: 'savage', label: 'Жёстко' },
];

/** Tai в одном чате: отвечает ли, каким стилем, насколько остро и можно ли материться. */
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
            </>
          ) : null}
        </Form>
      </Host>
    </>
  );
}
