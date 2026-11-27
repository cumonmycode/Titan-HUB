import { Form, Section, Text } from '@expo/ui/swift-ui';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';

import { EditorToolbar } from '@/components/editor-toolbar';
import { FieldRow, FormHost } from '@/components/native-form';
import { haptic } from '@/lib/haptics';
import { queryClient } from '@/lib/query';
import { useClubKey } from '@/lib/queries';
import { DEFAULT_STREAM_PUSH, setStreamPushText, useStreams } from '@/lib/telegram-api';

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Текст push о начале эфира. Пустое поле — стандартный текст; {название} — название эфира. */
export default function StreamPushTextEditor() {
  const { data } = useStreams();
  return data ? <Editor title={data.appPushTitle ?? ''} body={data.appPushBody ?? ''} /> : null;
}

function Editor(props: { title: string; body: string }) {
  const router = useRouter();
  const club = useClubKey();
  const [title, setTitle] = useState(props.title);
  const [body, setBody] = useState(props.body);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await setStreamPushText(title.trim(), body.trim());
      haptic.success();
      await queryClient.invalidateQueries({ queryKey: [club, 'telegram', 'streams'] });
      router.back();
    } catch (error) {
      haptic.error();
      Alert.alert('Не сохранилось', errorText(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <EditorToolbar title="Текст уведомления" canSave busy={busy} onSave={() => void submit()} />
      <FormHost>
        <Form>
          <Section title="Заголовок" footer={<Text>{`Пусто — «${DEFAULT_STREAM_PUSH.title}».`}</Text>}>
            <FieldRow value={title} placeholder={DEFAULT_STREAM_PUSH.title} maxLength={80} autoFocus onChange={setTitle} />
          </Section>
          <Section title="Текст" footer={<Text>{'{название} подставит название эфира. Пусто — стандартный текст.'}</Text>}>
            <FieldRow value={body} placeholder={DEFAULT_STREAM_PUSH.body} maxLength={200} multiline onChange={setBody} />
          </Section>
        </Form>
      </FormHost>
    </>
  );
}
