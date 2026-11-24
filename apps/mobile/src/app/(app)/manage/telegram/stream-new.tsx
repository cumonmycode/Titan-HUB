import { Form, Section, Text } from '@expo/ui/swift-ui';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';

import { EditorToolbar } from '@/components/editor-toolbar';
import { FieldRow, FormHost } from '@/components/native-form';
import { haptic } from '@/lib/haptics';
import { queryClient } from '@/lib/query';
import { useClubKey } from '@/lib/queries';
import { startManualStream, type StreamLink } from '@/lib/telegram-api';

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const isHttps = (url: string) => /^https:\/\/\S+\.\S+/i.test(url.trim());

/** Стрим вручную: название, ссылка на эфир и (по желанию) на донаты — Tai публикует сразу. */
export default function StreamNewEditor() {
  const router = useRouter();
  const club = useClubKey();
  const [title, setTitle] = useState('');
  const [watch, setWatch] = useState('');
  const [donate, setDonate] = useState('');
  const [busy, setBusy] = useState(false);
  const valid = isHttps(watch) && (!donate.trim() || isHttps(donate));

  const submit = async () => {
    const links: StreamLink[] = [{ kind: 'watch', label: 'Смотреть', url: watch.trim() }, ...(donate.trim() ? [{ kind: 'donate' as const, label: 'Донат', url: donate.trim() }] : [])];
    setBusy(true);
    try {
      await startManualStream(title.trim(), links);
      haptic.success();
      await queryClient.invalidateQueries({ queryKey: [club, 'telegram', 'streams'] });
      router.back();
    } catch (error) {
      haptic.error();
      Alert.alert('Не опубликовалось', errorText(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <EditorToolbar title="Новый стрим" canSave={valid} busy={busy} onSave={() => void submit()} />
      <FormHost>
        <Form>
          <Section title="Название">
            <FieldRow value={title} placeholder="Финал турнира" maxLength={120} autoFocus onChange={setTitle} />
          </Section>
          <Section title="Ссылка на эфир" footer={<Text>Только https: VK Видео, YouTube, Twitch…</Text>}>
            <FieldRow value={watch} placeholder="https://live.vkvideo.ru/…" keyboard="url" maxLength={500} onChange={setWatch} />
          </Section>
          <Section title="Ссылка на донаты" footer={<Text>Необязательно.</Text>}>
            <FieldRow value={donate} placeholder="https://www.donationalerts.com/r/…" keyboard="url" maxLength={500} onChange={setDonate} />
          </Section>
        </Form>
      </FormHost>
    </>
  );
}
