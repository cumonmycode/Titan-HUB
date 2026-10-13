import { DatePicker, Form, Section, Text, Toggle } from '@expo/ui/swift-ui';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';

import { EditorToolbar } from '@/components/editor-toolbar';
import { FieldRow, FormHost } from '@/components/native-form';
import { ApiError } from '@/lib/api';
import { useClubKey } from '@/lib/queries';
import { knowledgeRequest } from '@/lib/smm-knowledge';

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Своя дата клуба — день рождения клуба, традиционный турнир, годовщина: Tai ставит на
 * неё тематические посты так же, как на праздники. Каждый год или один раз.
 */
export default function SmmDateScreen() {
  const router = useRouter();
  const club = useClubKey();
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [day, setDay] = useState(() => new Date());
  const [yearly, setYearly] = useState(true);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const md = `${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
      await knowledgeRequest(club, 'post', '/smm/dates', { day: yearly ? md : `${day.getFullYear()}-${md}`, title: title.trim(), note: note.trim() || undefined });
      router.back();
    } catch (error) {
      Alert.alert('Не сохранилось', error instanceof ApiError ? error.message : String(error));
      setSaving(false);
    }
  };

  return (
    <>
      <EditorToolbar title="Своя дата" saveLabel="Добавить" busyLabel="Добавляем…" canSave={title.trim().length >= 2} busy={saving} onSave={() => void save()} />
      <FormHost>
        <Form>
          <Section title="Что за дата" footer={<Text>Tai поставит на этот день тематический пост и сторис, а если повод продающий — расскажет о нём заранее.</Text>}>
            <FieldRow value={title} placeholder="Например, «День рождения клуба»" maxLength={120} onChange={setTitle} />
            <FieldRow value={note} placeholder="Что важно сказать (необязательно)" multiline maxLength={300} onChange={setNote} />
          </Section>
          <Section>
            <DatePicker title="День" selection={day} displayedComponents={['date']} onDateChange={setDay} />
            <Toggle label="Каждый год" isOn={yearly} onIsOnChange={setYearly} />
          </Section>
        </Form>
      </FormHost>
    </>
  );
}
