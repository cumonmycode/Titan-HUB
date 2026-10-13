import { DatePicker, Form, Picker, Section, Text, Toggle } from '@expo/ui/swift-ui';
import { pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';

import { EditorToolbar } from '@/components/editor-toolbar';
import { FieldRow, FormHost } from '@/components/native-form';
import { ApiError } from '@/lib/api';
import { useClubKey } from '@/lib/queries';
import { DIRECTIONS, FORMAT_LABEL, createPost, mskToPicker, pickerToMsk, type SmmFormat, type SmmPlatform } from '@/lib/smm-api';

const FORMATS: SmmFormat[] = ['post', 'carousel', 'story', 'reel'];

/**
 * Новая публикация вне плана (или идея из «Идей»): площадка, формат, когда, о чём.
 * По умолчанию Tai сразу пишет текст и рисует картинку.
 */
export default function SmmNewPost() {
  const params = useLocalSearchParams<{ topic?: string; brief?: string; platform?: SmmPlatform; format?: SmmFormat; direction?: string }>();
  const router = useRouter();
  const club = useClubKey();
  const [platform, setPlatform] = useState<SmmPlatform>(params.platform ?? 'telegram');
  const [format, setFormat] = useState<SmmFormat>(params.format ?? 'post');
  const [when, setWhen] = useState(() => mskToPicker(null));
  const [topic, setTopic] = useState(params.topic ?? '');
  const [brief, setBrief] = useState(params.brief ?? '');
  const [direction, setDirection] = useState(params.direction ?? '');
  const [write, setWrite] = useState(true);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const post = await createPost(club, { platform, format, ...pickerToMsk(when), topic: topic.trim(), brief: brief.trim() || undefined, direction: direction || undefined, write });
      router.replace({ pathname: '/manage/smm/post', params: { id: post.id } });
    } catch (error) {
      Alert.alert('Не создалось', error instanceof ApiError ? error.message : String(error));
      setSaving(false);
    }
  };

  return (
    <>
      <EditorToolbar title="Публикация" saveLabel="Создать" busyLabel="Создаём…" canSave={topic.trim().length >= 2} busy={saving} onSave={() => void save()} />
      <FormHost>
        <Form>
          <Section title="Где и в каком виде">
            <Picker selection={platform} onSelectionChange={(v) => setPlatform(v as SmmPlatform)} modifiers={[pickerStyle('segmented')]}>
              <Text modifiers={[tag('telegram')]}>Telegram</Text>
              <Text modifiers={[tag('instagram')]}>Instagram</Text>
            </Picker>
            <Picker selection={format} onSelectionChange={(v) => setFormat(v as SmmFormat)} modifiers={[pickerStyle('segmented')]}>
              {FORMATS.map((f) => (
                <Text key={f} modifiers={[tag(f)]}>
                  {FORMAT_LABEL[f]}
                </Text>
              ))}
            </Picker>
            <DatePicker title="Выход" selection={when} displayedComponents={['date', 'hourAndMinute']} range={{ start: new Date() }} onDateChange={setWhen} />
          </Section>
          <Section title="О чём" footer={<Text>Тема — коротко. В идее — что важно сказать, повод, цифры: Tai опирается на это и на данные клуба.</Text>}>
            <FieldRow value={topic} placeholder="Тема, например «Турнир в субботу»" maxLength={160} onChange={setTopic} />
            <FieldRow value={brief} placeholder="Идея и детали (необязательно)" multiline maxLength={800} onChange={setBrief} />
            <Picker label="Направление" selection={direction} onSelectionChange={(v) => setDirection(String(v))} modifiers={[pickerStyle('menu')]}>
              <Text modifiers={[tag('')]}>Не важно</Text>
              {DIRECTIONS.map((d) => (
                <Text key={d.key} modifiers={[tag(d.key)]}>
                  {d.label}
                </Text>
              ))}
            </Picker>
          </Section>
          <Section footer={<Text>Иначе Tai напишет сам заранее — за сутки до выхода (рилс — за трое).</Text>}>
            <Toggle label="Tai пишет сразу" isOn={write} onIsOnChange={setWrite} />
          </Section>
        </Form>
      </FormHost>
    </>
  );
}
