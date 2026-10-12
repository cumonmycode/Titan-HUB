import { Form, Host, Picker, RNHostView, Section, Text, Toggle } from '@expo/ui/swift-ui';
import { pickerStyle, refreshable, tag } from '@expo/ui/swift-ui/modifiers';
import { useMutation, useQuery } from '@tanstack/react-query';
import { SymbolView } from 'expo-symbols';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';

import { FieldRow, LinkRow, secondary } from '@/components/native-form';
import { Text as RNText } from '@/components/text';
import { haptic } from '@/lib/haptics';
import { queryClient } from '@/lib/query';
import { useClubKey } from '@/lib/queries';
import { getTaiSettings, saveTaiClubBrief, saveTaiSettings, speakTai, type TaiSettings, type TaiSettingsResponse, type TaiVoiceOption } from '@/lib/tai-api';
import { playTaiSample } from '@/lib/tai-voice';
import { colors, space, type } from '@/lib/theme';

const BRIEF_MAX = 3000;
const SAMPLE = 'Привет, это Tai. Сегодня около сорока восьми тысяч выручки и тридцать один чек — для субботы неплохо, дожмём.';

/**
 * Tai — настройки ассистента клуба: голос (с примером), скорость речи, манера,
 * общение с клиентами в Telegram и чаты. Меняет владелец; сохраняется сразу.
 */
export default function TaiSettingsScreen() {
  const club = useClubKey();
  const router = useRouter();
  const key = [club, 'ai', 'settings'];
  const query = useQuery({ queryKey: key, queryFn: getTaiSettings });
  const [previewing, setPreviewing] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: saveTaiSettings,
    onMutate: async (patch: Partial<TaiSettings>) => {
      // Сразу показываем выбор; при ошибке — вернём как было.
      const previous = queryClient.getQueryData<TaiSettingsResponse>(key);
      if (previous) queryClient.setQueryData<TaiSettingsResponse>(key, { ...previous, settings: { ...previous.settings, ...patch } });
      return { previous };
    },
    onError: (error, _patch, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
      Alert.alert('Не сохранилось', error instanceof Error ? error.message : String(error));
    },
    onSuccess: () => haptic.success(),
  });

  const brief = useMutation({
    mutationFn: saveTaiClubBrief,
    onSuccess: (clubBrief) => {
      const previous = queryClient.getQueryData<TaiSettingsResponse>(key);
      if (previous) queryClient.setQueryData<TaiSettingsResponse>(key, { ...previous, clubBrief });
      haptic.success();
    },
    onError: (error) => Alert.alert('Не сохранилось', error instanceof Error ? error.message : String(error)),
  });

  const preview = async (voice: TaiVoiceOption, speed: number) => {
    haptic.light();
    setPreviewing(voice.id);
    const audio = await speakTai(SAMPLE, { voice: voice.id, speed });
    setPreviewing(null);
    if (!audio) return Alert.alert('Не получилось', 'Голос не ответил — попробуйте ещё раз.');
    await playTaiSample(audio).catch(() => undefined);
  };

  const data = query.data;
  const settings = data?.settings;
  const current = data?.voices.find((v) => v.id === settings?.voice);

  return (
    <Host style={{ flex: 1 }} useViewportSizeMeasurement>
      <Form modifiers={[refreshable(async () => void (await query.refetch()))]}>
        {!data || !settings ? (
          <Section>
            <Text modifiers={[secondary]}>{query.error ? (query.error instanceof Error ? query.error.message : 'Не удалось загрузить') : 'Загружаем…'}</Text>
          </Section>
        ) : (
          <>
            <Section title="Голос" footer={<Text>Нажмите ▶ — Tai скажет пример этим голосом и с выбранной скоростью. Выбранный голос отмечен галочкой.</Text>}>
              {data.voices.map((voice) => (
                <RNHostView key={voice.id} matchContents>
                  <VoiceRow
                    voice={voice}
                    selected={voice.id === settings.voice}
                    loading={previewing === voice.id}
                    onSelect={() => {
                      haptic.selection();
                      save.mutate({ voice: voice.id });
                    }}
                    onPreview={() => void preview(voice, settings.speed)}
                  />
                </RNHostView>
              ))}
            </Section>

            <Section
              title="Скорость речи"
              footer={
                <Text>
                  {current?.tunable === false
                    ? 'У этого голоса скорость не настраивается — он говорит в своём темпе.'
                    : 'Как быстро Tai говорит в голосовом режиме.'}
                </Text>
              }
            >
              <Picker
                selection={settings.speed}
                onSelectionChange={(value) => {
                  haptic.selection();
                  save.mutate({ speed: Number(value) });
                }}
                modifiers={[pickerStyle('segmented')]}
              >
                {data.speeds.map((speed) => (
                  <Text key={speed.value} modifiers={[tag(speed.value)]}>
                    {speed.label}
                  </Text>
                ))}
              </Picker>
              {current ? (
                <RNHostView matchContents>
                  <Pressable
                    onPress={() => void preview(current, settings.speed)}
                    style={({ pressed }) => [styles.listen, pressed && styles.pressed]}
                    accessibilityRole="button"
                  >
                    {previewing === current.id ? <ActivityIndicator /> : <SymbolView name="play.circle.fill" size={22} tintColor={colors.accent} />}
                    <RNText style={[type.body, styles.accent]}>Прослушать с этой скоростью</RNText>
                  </Pressable>
                </RNHostView>
              ) : null}
            </Section>

            <Section title="Манера" footer={<Text>С сотрудниками в приложении и в личке Telegram. С клиентами Tai всегда на «ты» и без мата, в группах — своя настройка у каждого чата.</Text>}>
              <Toggle label="Можно материться" isOn={settings.profanity} onIsOnChange={(on) => save.mutate({ profanity: on })} />
            </Section>

            <Section
              title="Клиенты в Telegram"
              footer={<Text>Напоминает в игровой вечер тем, кто ещё не отметился, и тем, кто просил напомнить. Не чаще раза в 3 дня, днём, и никогда тем, кто попросил не писать.</Text>}
            >
              <Toggle label="Пишет клиентам первым" isOn={settings.outreach} onIsOnChange={(on) => save.mutate({ outreach: on })} />
            </Section>

            <Section
              title="Что Tai рассказывает о клубе"
              footer={<Text>{brief.isPending ? 'Сохраняем…' : 'Форматы игр, школа мафии, мероприятия — Tai опирается на этот текст в Telegram. Цены, адрес и расписание он берёт из HUB сам. Сохраняется, когда закончите ввод.'}</Text>}
            >
              <FieldRow value={data.clubBrief} placeholder="Расскажите о форматах и особенностях клуба" multiline maxLength={BRIEF_MAX} onCommit={(text) => brief.mutate(text)} />
            </Section>

            <Section footer={<Text>Режим, стиль общения, жёсткость и мат — у каждой группы свои.</Text>}>
              <LinkRow icon="bubble.left.and.bubble.right.fill" color="#8B5CF6" title="Tai в чатах" onPress={() => router.push('/manage/tai/chats')} />
            </Section>
          </>
        )}
      </Form>
    </Host>
  );
}

function VoiceRow({
  voice,
  selected,
  loading,
  onSelect,
  onPreview,
}: {
  voice: TaiVoiceOption;
  selected: boolean;
  loading: boolean;
  onSelect: () => void;
  onPreview: () => void;
}) {
  return (
    <View style={styles.row}>
      <Pressable onPress={onPreview} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Прослушать голос ${voice.label}`}>
        {loading ? <ActivityIndicator style={styles.play} /> : <SymbolView name="play.circle.fill" size={30} tintColor={colors.accent} />}
      </Pressable>
      <Pressable
        onPress={onSelect}
        style={({ pressed }) => [styles.choose, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityState={{ selected }}
      >
        <View style={styles.flex}>
          <RNText style={[type.body, styles.label]}>{voice.label}</RNText>
          <RNText style={[type.footnote, styles.secondary]}>{voice.hint}</RNText>
        </View>
        {selected ? <SymbolView name="checkmark" size={17} weight="semibold" tintColor={colors.accent} /> : null}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: 10 },
  play: { width: 30, height: 30 },
  choose: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md },
  listen: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.md },
  flex: { flex: 1, minWidth: 0 },
  label: { color: colors.label },
  secondary: { color: colors.secondaryLabel },
  accent: { color: colors.accent },
  pressed: { opacity: 0.6 },
});
