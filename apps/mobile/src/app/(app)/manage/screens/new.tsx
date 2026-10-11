import { Form, Section, Text } from '@expo/ui/swift-ui';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';

import { EditorToolbar } from '@/components/editor-toolbar';
import { FieldRow, FormHost } from '@/components/native-form';
import { haptic } from '@/lib/haptics';
import { createScreen } from '@/lib/screens-api';

/** Новый экран: название. Он сразу показывает меню; картинки и остальное — в его настройках. */
export default function NewScreenEditor() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!name.trim() || busy) return;
    haptic.medium();
    setBusy(true);
    try {
      const screen = await createScreen({ name: name.trim() });
      haptic.success();
      router.replace({ pathname: '/manage/screens/[screenId]', params: { screenId: screen.id } });
    } catch (error) {
      haptic.error();
      Alert.alert('Экран не создан', error instanceof Error ? error.message : String(error));
      setBusy(false);
    }
  };

  return (
    <>
      <EditorToolbar title="Новый экран" canSave={!!name.trim()} busy={busy} onSave={() => void save()} />
      <FormHost>
        <Form>
          <Section title="Название" footer={<Text>Новый экран сразу показывает меню. Картинки, их порядок, время и анимации добавите в его настройках.</Text>}>
            <FieldRow value={name} placeholder="Например: ТВ у бара" autoFocus maxLength={60} onChange={setName} />
          </Section>
        </Form>
      </FormHost>
    </>
  );
}
