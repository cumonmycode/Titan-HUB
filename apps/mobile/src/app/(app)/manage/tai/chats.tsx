import { Form, Host, Picker, Section, Text, Toggle } from '@expo/ui/swift-ui';
import { pickerStyle, refreshable, tag } from '@expo/ui/swift-ui/modifiers';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert } from 'react-native';

import { secondary } from '@/components/native-form';
import { haptic } from '@/lib/haptics';
import { queryClient } from '@/lib/query';
import { useClubKey } from '@/lib/queries';
import { getTaiChatConfig, saveTaiChatConfig, type TaiChat, type TaiChatConfig, type TaiChatMode, type TaiHarshness } from '@/lib/tai-api';

const MODES: { key: TaiChatMode; label: string }[] = [
  { key: 'game', label: 'Игровой' },
  { key: 'work', label: 'Рабочий' },
];
const HARSH: { key: TaiHarshness; label: string }[] = [
  { key: 'soft', label: 'Мягко' },
  { key: 'medium', label: 'Средне' },
  { key: 'savage', label: 'Жёстко' },
];

/**
 * Tai в групповых чатах Telegram: у каждой группы свой режим (игровой чат клуба или
 * рабочий чат персонала), стиль общения, жёсткость и мат — мат включается для
 * каждого чата отдельно, в любом режиме. Сохраняется сразу.
 */
export default function TaiChatsScreen() {
  const club = useClubKey();
  const key = [club, 'ai', 'chat-config'];
  const query = useQuery({ queryKey: key, queryFn: getTaiChatConfig });

  const save = useMutation({
    mutationFn: saveTaiChatConfig,
    onMutate: async (patch: { enabled?: boolean; chats?: TaiChat[] }) => {
      const previous = queryClient.getQueryData<TaiChatConfig>(key);
      if (previous) queryClient.setQueryData<TaiChatConfig>(key, { ...previous, ...patch });
      return { previous };
    },
    onError: (error, _patch, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
      Alert.alert('Не сохранилось', error instanceof Error ? error.message : String(error));
    },
    onSuccess: () => haptic.success(),
  });

  const data = query.data;
  const patchChat = (id: TaiChat['id'], patch: Partial<TaiChat>) => {
    if (!data) return;
    haptic.selection();
    save.mutate({ chats: data.chats.map((chat) => (chat.id === id ? { ...chat, ...patch } : chat)) });
  };

  if (!data) {
    return (
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <Form>
          <Section>
            <Text modifiers={[secondary]}>{query.error ? (query.error instanceof Error ? query.error.message : 'Не удалось загрузить') : 'Загружаем…'}</Text>
          </Section>
        </Form>
      </Host>
    );
  }

  const blocked = !data.botReady || !data.aiReady;
  return (
    <Host style={{ flex: 1 }} useViewportSizeMeasurement>
      <Form modifiers={[refreshable(async () => void (await query.refetch()))]}>
        {blocked ? (
          <Section>
            <Text modifiers={[secondary]}>
              {[!data.botReady ? 'Подключите бота Tai в «Настройки → Интеграции».' : '', !data.aiReady ? 'Нужен ключ Tai (модуль «Tai — ИИ-ассистент»).' : ''].filter(Boolean).join(' ')}
            </Text>
          </Section>
        ) : (
          <>
            <Section footer={<Text>Обращайтесь к Tai «тай …» или ответом на его сообщение. Добавите Tai в чат сотрудников — он сам станет рабочим. Рамки — всегда: без оскорблений по национальности, религии, полу и ориентации, без угроз и запрещёнки.</Text>}>
              <Toggle label="Шутки в игровых чатах" isOn={data.enabled} onIsOnChange={(on) => save.mutate({ enabled: on })} />
            </Section>

            {data.chats.length === 0 ? (
              <Section>
                <Text modifiers={[secondary]}>Группы появятся здесь, как только Tai увидит сообщения в чате. Добавьте бота в группу и напишите что-нибудь.</Text>
              </Section>
            ) : (
              data.chats.map((chat) => (
                <ChatSection key={String(chat.id)} chat={chat} presets={data.presets} onPatch={(patch) => patchChat(chat.id, patch)} />
              ))
            )}

          </>
        )}
      </Form>
    </Host>
  );
}

function ChatSection({ chat, presets, onPatch }: { chat: TaiChat; presets: TaiChatConfig['presets']; onPatch: (patch: Partial<TaiChat>) => void }) {
  const work = chat.mode === 'work';
  const preset = presets.find((p) => p.key === chat.preset);
  return (
    <Section
      title={chat.title || `Чат ${chat.id}`}
      footer={
        <Text>
          {work
            ? 'Рабочий чат персонала: Tai отвечает сотрудникам про смену, кассу, цифры и записи — с правами того, кто спросил.'
            : 'Игровой чат клуба: опросы, команды @all / @tvari и шутки Tai, когда к нему обращаются.'}
          {preset ? ` Стиль «${preset.label}»: ${preset.desc}` : ''}
        </Text>
      }
    >
      <Picker selection={chat.mode} onSelectionChange={(mode) => onPatch({ mode: mode as TaiChatMode })} modifiers={[pickerStyle('segmented')]}>
        {MODES.map((m) => (
          <Text key={m.key} modifiers={[tag(m.key)]}>
            {m.label}
          </Text>
        ))}
      </Picker>
      {!work ? <Toggle label="Шутить в этом чате" isOn={chat.enabled} onIsOnChange={(on) => onPatch({ enabled: on })} /> : null}
      <Picker label="Стиль общения" selection={chat.preset} onSelectionChange={(value) => onPatch({ preset: String(value) })} modifiers={[pickerStyle('menu')]}>
        {presets.map((p) => (
          <Text key={p.key} modifiers={[tag(p.key)]}>
            {p.label}
          </Text>
        ))}
      </Picker>
      <Picker selection={chat.harshness} onSelectionChange={(value) => onPatch({ harshness: value as TaiHarshness })} modifiers={[pickerStyle('segmented')]}>
        {HARSH.map((h) => (
          <Text key={h.key} modifiers={[tag(h.key)]}>
            {h.label}
          </Text>
        ))}
      </Picker>
      <Toggle label="Мат" isOn={chat.profanity} onIsOnChange={(on) => onPatch({ profanity: on })} />
    </Section>
  );
}
