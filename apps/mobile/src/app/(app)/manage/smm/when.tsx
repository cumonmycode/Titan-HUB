import { DatePicker, Form, Section, Text } from '@expo/ui/swift-ui';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';

import { EditorToolbar } from '@/components/editor-toolbar';
import { FormHost } from '@/components/native-form';
import { ApiError } from '@/lib/api';
import { useClubKey } from '@/lib/queries';
import { mskToPicker, patchPost, pickerToMsk, useSmmPost } from '@/lib/smm-api';

/** Перенести публикацию: новый день и время выхода. */
export default function SmmWhenScreen() {
  const { postId = '' } = useLocalSearchParams<{ postId: string }>();
  const router = useRouter();
  const club = useClubKey();
  const post = useSmmPost(postId).data?.post;
  const [when, setWhen] = useState<Date | null>(null);
  const [saving, setSaving] = useState(false);
  const value = when ?? mskToPicker(post?.publishAt ?? null);

  const save = async () => {
    setSaving(true);
    try {
      await patchPost(club, postId, pickerToMsk(value));
      router.back();
    } catch (error) {
      Alert.alert('Не перенеслось', error instanceof ApiError ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <EditorToolbar title="Перенести" canSave={!!when} busy={saving} onSave={() => void save()} />
      <FormHost>
        <Form>
          <Section footer={<Text>Время московское. Telegram-пост выйдет сам, остальное Tai передаст выкладывающему в это время.</Text>}>
            <DatePicker title="Выход" selection={value} displayedComponents={['date', 'hourAndMinute']} range={{ start: new Date() }} onDateChange={setWhen} />
          </Section>
        </Form>
      </FormHost>
    </>
  );
}
