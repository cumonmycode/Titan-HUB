import { Button, Form, Picker, ProgressView, Section, Text } from '@expo/ui/swift-ui';
import { pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';

import { EditorToolbar } from '@/components/editor-toolbar';
import { ActionRow, FieldRow, FormHost, TimeRow } from '@/components/native-form';
import { haptic } from '@/lib/haptics';
import { DEFAULT_SCHEDULE, saveSite, useSiteConfig, type SiteScheduleDay } from '@/lib/site-api';
import { EVENING_TITLES, WEEKDAYS } from '@/lib/site-looks';

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Вечер расписания сайта: день недели, что играем и во сколько. Без index — новый вечер. */
export default function EveningEditor() {
  const { index } = useLocalSearchParams<{ index?: string }>();
  const config = useSiteConfig();
  if (!config.data) {
    return (
      <FormHost>
        <ProgressView />
      </FormHost>
    );
  }
  const rows = config.data.schedule ?? DEFAULT_SCHEDULE;
  const i = index !== undefined ? Number(index) : null;
  const original = i !== null && Number.isInteger(i) ? (rows[i] ?? null) : null;
  return <EveningForm key={original ? `${i}` : 'new'} rows={rows} index={original ? i : null} original={original} />;
}

function EveningForm({ rows, index, original }: { rows: SiteScheduleDay[]; index: number | null; original: SiteScheduleDay | null }) {
  const router = useRouter();
  const [day, setDay] = useState(original?.day ?? 5);
  const [title, setTitle] = useState(original?.title ?? 'Городская мафия');
  const [time, setTime] = useState(original?.time ?? '19:00');
  const [busy, setBusy] = useState(false);
  const canSave = title.trim().length > 0;

  const commit = async (next: SiteScheduleDay[], failTitle: string) => {
    setBusy(true);
    try {
      await saveSite({ schedule: [...next].sort((a, b) => a.day - b.day) });
      haptic.success();
      router.back();
    } catch (error) {
      haptic.error();
      Alert.alert(failTitle, errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    if (!canSave) return;
    haptic.medium();
    const evening: SiteScheduleDay = { day, title: title.trim(), time };
    const next = index !== null ? rows.map((r, j) => (j === index ? evening : r)) : [...rows, evening];
    void commit(next, 'Вечер не сохранён');
  };

  const remove = () =>
    index !== null &&
    Alert.alert('Убрать вечер?', `${WEEKDAYS[day]} — ${title}. Сайт перестанет показывать его в календаре игр.`, [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Убрать', style: 'destructive', onPress: () => void commit(rows.filter((_, j) => j !== index), 'Вечер не убран') },
    ]);

  return (
    <>
      <EditorToolbar title={original ? 'Вечер' : 'Новый вечер'} canSave={canSave} busy={busy} onSave={save} />
      <FormHost>
        <Form>
          <Section title="День недели">
            <Picker
              label="День"
              selection={day}
              onSelectionChange={(next) => {
                haptic.selection();
                setDay(Number(next));
              }}
              modifiers={[pickerStyle('menu')]}>
              {WEEKDAYS.slice(1).map((name, k) => (
                <Text key={name} modifiers={[tag(k + 1)]}>
                  {name}
                </Text>
              ))}
            </Picker>
            <TimeRow label="Начало" value={time} fallback="19:00" onChange={setTime} />
          </Section>

          <Section title="Что играем" footer={<Text>Так вечер называется в календаре игр и в заявке на сайте.</Text>}>
            <FieldRow value={title} placeholder="Городская мафия" maxLength={60} onChange={setTitle} />
            {EVENING_TITLES.filter((t) => t !== title.trim()).map((t) => (
              <Button
                key={t}
                label={t}
                systemImage="arrow.up.left"
                onPress={() => {
                  haptic.selection();
                  setTitle(t);
                }}
              />
            ))}
          </Section>

          {original && (
            <Section>
              <ActionRow title="Убрать вечер" icon="minus.circle" destructive disabled={busy} onPress={remove} />
            </Section>
          )}
        </Form>
      </FormHost>
    </>
  );
}
