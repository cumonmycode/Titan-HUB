import { Form, ProgressView, Section, Text, Toggle } from '@expo/ui/swift-ui';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';

import { EditorToolbar } from '@/components/editor-toolbar';
import { ActionRow, FieldRow, FormHost } from '@/components/native-form';
import { haptic } from '@/lib/haptics';
import { pinRules, useTelegramChat, type ChatConfig, type ChatDetail } from '@/lib/telegram-api';

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
type SaveAsync = ReturnType<typeof useTelegramChat>['saveAsync'];

/** Приветствие новичков и правила чата: текст, уборка служебных сообщений, закреп правил. */
export default function WelcomeEditor() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const editor = useTelegramChat(id);
  const detail = editor.query.data;
  if (!detail) {
    return (
      <FormHost>
        <ProgressView />
      </FormHost>
    );
  }
  return <WelcomeForm id={id} detail={detail} save={editor.saveAsync} busy={editor.saving} />;
}

function WelcomeForm({ id, detail, save, busy }: { id: string; detail: ChatDetail; save: SaveAsync; busy: boolean }) {
  const router = useRouter();
  const initial = detail.config.welcome;
  const [draft, setDraft] = useState<ChatConfig['welcome']>(initial);
  const [pinning, setPinning] = useState(false);
  const patch = (next: Partial<ChatConfig['welcome']>) => setDraft((current) => ({ ...current, ...next }));
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const rights = detail.live?.reachable ? detail.live.rights : null;

  const persist = () => save({ welcome: { ...draft, text: draft.text.trim(), rules: draft.rules.trim() } });

  const submit = async () => {
    if (draft.on && !draft.text.trim()) return Alert.alert('Напишите текст приветствия');
    try {
      await persist();
      haptic.success();
      router.back();
    } catch (error) {
      haptic.error();
      Alert.alert('Не сохранилось', errorText(error));
    }
  };

  const pin = async () => {
    if (!draft.rules.trim()) return Alert.alert('Сначала напишите правила');
    setPinning(true);
    try {
      if (dirty) await persist();
      const result = await pinRules(id);
      haptic.success();
      if (result.pinned) Alert.alert('Правила закреплены');
      else Alert.alert('Правила отправлены', 'Закрепить не вышло — дайте боту право закреплять сообщения.');
    } catch (error) {
      haptic.error();
      Alert.alert('Не отправилось', errorText(error));
    } finally {
      setPinning(false);
    }
  };

  const serviceFooter =
    rights && !rights.deleteMessages ? 'Чтобы убирать служебные сообщения, боту нужно право удалять сообщения.' : 'Убирает из ленты «… вступил(а) в группу» и «… покинул(а) группу».';

  return (
    <>
      <EditorToolbar title="Приветствие и правила" canSave={dirty} busy={busy} onSave={() => void submit()} />
      <FormHost>
        <Form>
          <Section footer={<Text>{'Бот здоровается с каждым, кто вошёл в чат. {name} — имя новичка с отметкой, {chat} — название чата.'}</Text>}>
            <Toggle label="Приветствовать новичков" isOn={draft.on} onIsOnChange={(on) => patch({ on })} />
            {draft.on ? <FieldRow value={draft.text} placeholder="Привет, {name}! Добро пожаловать в {chat}." multiline maxLength={1000} onChange={(text) => patch({ text })} /> : null}
          </Section>

          <Section footer={<Text>{serviceFooter}</Text>}>
            <Toggle label="Убирать сообщения о входе и выходе" isOn={draft.deleteService} onIsOnChange={(deleteService) => patch({ deleteService })} />
          </Section>

          <Section title="Правила чата" footer={<Text>Бот покажет их по команде /rules и на слово «правила».</Text>}>
            <FieldRow value={draft.rules} placeholder="1. Без спама и рекламы. 2. Отмечаемся в опросе до 18:00…" multiline maxLength={3000} onChange={(rules) => patch({ rules })} />
          </Section>

          <Section>
            <ActionRow title={pinning ? 'Отправляем…' : 'Отправить и закрепить правила'} icon="pin.fill" disabled={pinning || !draft.rules.trim()} onPress={() => void pin()} />
          </Section>
        </Form>
      </FormHost>
    </>
  );
}
