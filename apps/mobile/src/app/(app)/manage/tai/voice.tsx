import { Form, Host, Picker, ProgressView, RNHostView, Section, Text } from '@expo/ui/swift-ui';
import { pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import { Stack } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';

import { Text as RNText } from '@/components/text';
import { haptic } from '@/lib/haptics';
import { speakTai, type TaiVoiceOption } from '@/lib/tai-api';
import { useTaiSettingsEditor } from '@/lib/tai-settings';
import { playTaiSample } from '@/lib/tai-voice';
import { colors, space, type } from '@/lib/theme';

const SAMPLE = 'Привет, это Tai. Сегодня около сорока восьми тысяч выручки и тридцать один чек — для субботы неплохо, дожмём.';

/** Голос Tai: ▶ — пример этим голосом, нажатие на строку — выбрать; ниже скорость речи. */
export default function TaiVoiceScreen() {
  const editor = useTaiSettingsEditor();
  const data = editor.query.data;
  const [previewing, setPreviewing] = useState<string | null>(null);

  const preview = async (voice: TaiVoiceOption, speed: number) => {
    haptic.light();
    setPreviewing(voice.id);
    const audio = await speakTai(SAMPLE, { voice: voice.id, speed });
    setPreviewing(null);
    if (!audio) return Alert.alert('Не получилось', 'Голос не ответил — попробуйте ещё раз.');
    await playTaiSample(audio).catch(() => undefined);
  };

  if (!data) {
    return (
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <ProgressView />
      </Host>
    );
  }
  const { settings } = data;
  const current = data.voices.find((v) => v.id === settings.voice);

  return (
    <>
      <Stack.Title>Голос</Stack.Title>
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <Form>
          <Section title="Голос" footer={<Text>▶ — Tai скажет пример этим голосом с выбранной скоростью.</Text>}>
            {data.voices.map((voice) => (
              <RNHostView key={voice.id} matchContents>
                <VoiceRow
                  voice={voice}
                  selected={voice.id === settings.voice}
                  loading={previewing === voice.id}
                  onSelect={() => {
                    haptic.selection();
                    editor.save({ voice: voice.id });
                  }}
                  onPreview={() => void preview(voice, settings.speed)}
                />
              </RNHostView>
            ))}
          </Section>

          <Section
            title="Скорость речи"
            footer={<Text>{current?.tunable === false ? 'У этого голоса скорость не настраивается — он говорит в своём темпе.' : 'Как быстро Tai говорит в голосовых ответах.'}</Text>}
          >
            <Picker
              selection={settings.speed}
              onSelectionChange={(value) => {
                haptic.selection();
                editor.save({ speed: Number(value) });
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
                <Pressable onPress={() => void preview(current, settings.speed)} style={({ pressed }) => [styles.listen, pressed && styles.pressed]} accessibilityRole="button">
                  {previewing === current.id ? <ActivityIndicator /> : <SymbolView name="play.circle.fill" size={22} tintColor={colors.accent} />}
                  <RNText style={[type.body, styles.accent]}>Прослушать с этой скоростью</RNText>
                </Pressable>
              </RNHostView>
            ) : null}
          </Section>
        </Form>
      </Host>
    </>
  );
}

function VoiceRow({ voice, selected, loading, onSelect, onPreview }: { voice: TaiVoiceOption; selected: boolean; loading: boolean; onSelect: () => void; onPreview: () => void }) {
  return (
    <View style={styles.row}>
      <Pressable onPress={onPreview} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Прослушать голос ${voice.label}`}>
        {loading ? <ActivityIndicator style={styles.play} /> : <SymbolView name="play.circle.fill" size={30} tintColor={colors.accent} />}
      </Pressable>
      <Pressable onPress={onSelect} style={({ pressed }) => [styles.choose, pressed && styles.pressed]} accessibilityRole="button" accessibilityState={{ selected }}>
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
