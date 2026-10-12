import { ContentUnavailableView, Form, Host, Picker, ProgressView, Section, Text, Toggle } from '@expo/ui/swift-ui';
import { pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import { Stack, useLocalSearchParams } from 'expo-router';

import { LinkRow } from '@/components/native-form';
import type { TaiChatMode, TaiHarshness } from '@/lib/tai-api';
import { useTaiChatsEditor } from '@/lib/tai-settings';
import { useAccentHex } from '@/lib/theme';

const MODES: { key: TaiChatMode; label: string; about: string }[] = [
  { key: 'game', label: 'Игровой', about: 'Чат клуба: опросы, команды @all / @tvari и шутки Tai, когда к нему обращаются.' },
  { key: 'work', label: 'Рабочий', about: 'Чат персонала: Tai отвечает сотрудникам про смену, кассу, цифры и записи — с правами того, кто спросил.' },
];
const HARSH: { key: TaiHarshness; label: string }[] = [
  { key: 'soft', label: 'Мягко' },
  { key: 'medium', label: 'Средне' },
  { key: 'savage', label: 'Жёстко' },
];

/** Один групповой чат: режим, стиль общения (с описанием каждого), жёсткость и мат. */
export default function TaiChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const accent = useAccentHex();
  const editor = useTaiChatsEditor();
  const config = editor.query.data;
  const chat = config?.chats.find((c) => String(c.id) === id);

  if (!config || !chat) {
    return (
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        {config ? <ContentUnavailableView title="Чат не найден" systemImage="bubble.left.and.exclamationmark.bubble.right" /> : <ProgressView />}
      </Host>
    );
  }

  const mode = MODES.find((m) => m.key === chat.mode) ?? MODES[0]!;
  const quiet = chat.mode === 'game' && !chat.enabled;

  return (
    <>
      <Stack.Title>{chat.title || 'Чат'}</Stack.Title>
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <Form>
          <Section title="Режим" footer={<Text>{mode.about}</Text>}>
            <Picker selection={chat.mode} onSelectionChange={(value) => editor.patchChat(chat.id, { mode: value as TaiChatMode })} modifiers={[pickerStyle('segmented')]}>
              {MODES.map((m) => (
                <Text key={m.key} modifiers={[tag(m.key)]}>
                  {m.label}
                </Text>
              ))}
            </Picker>
            {chat.mode === 'game' ? <Toggle label="Шутить в этом чате" isOn={chat.enabled} onIsOnChange={(on) => editor.patchChat(chat.id, { enabled: on })} /> : null}
          </Section>

          {!quiet ? (
            <>
              <Section title="Стиль общения">
                {config.presets.map((preset) => {
                  const selected = preset.key === chat.preset;
                  return (
                    <LinkRow
                      key={preset.key}
                      icon={selected ? 'checkmark.circle.fill' : 'circle'}
                      color={selected ? accent : '#C7C7CC'}
                      title={preset.label}
                      subtitle={preset.desc}
                      chevron={false}
                      onPress={selected ? undefined : () => editor.patchChat(chat.id, { preset: preset.key })}
                    />
                  );
                })}
              </Section>

              <Section title="Жёсткость" footer={<Text>Насколько остро Tai шутит и подкалывает. Рамки — всегда: без оскорблений по национальности, религии, полу и ориентации, без угроз.</Text>}>
                <Picker selection={chat.harshness} onSelectionChange={(value) => editor.patchChat(chat.id, { harshness: value as TaiHarshness })} modifiers={[pickerStyle('segmented')]}>
                  {HARSH.map((h) => (
                    <Text key={h.key} modifiers={[tag(h.key)]}>
                      {h.label}
                    </Text>
                  ))}
                </Picker>
              </Section>

              <Section footer={<Text>Мат включается для каждого чата отдельно, в любом режиме.</Text>}>
                <Toggle label="Можно материться" isOn={chat.profanity} onIsOnChange={(on) => editor.patchChat(chat.id, { profanity: on })} />
              </Section>
            </>
          ) : null}
        </Form>
      </Host>
    </>
  );
}
