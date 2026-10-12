import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';

import { EditorToolbar } from '@/components/editor-toolbar';
import { Text, TextInput } from '@/components/text';
import { useTaiSettingsEditor } from '@/lib/tai-settings';
import { colors, space, type } from '@/lib/theme';

const BRIEF_MAX = 3000;

/**
 * Что Tai рассказывает гостям в Telegram о клубе: форматы игр, школа, мероприятия.
 * Большое поле на весь экран; цены, адрес и расписание Tai берёт из HUB сам.
 */
export default function TaiBriefEditor() {
  const router = useRouter();
  const editor = useTaiSettingsEditor();
  const initial = editor.query.data?.clubBrief ?? '';
  const [text, setText] = useState<string | null>(null);
  const value = text ?? initial;
  const dirty = text !== null && text.trim() !== initial.trim();

  const save = async () => {
    await editor.saveBrief(value.trim());
    router.back();
  };

  return (
    <>
      <EditorToolbar title="О клубе" canSave={dirty && !!value.trim()} busy={editor.briefSaving} onSave={() => void save()} />
      <KeyboardAvoidingView behavior="padding" style={styles.flex}>
        <ScrollView style={styles.flex} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={[type.subhead, styles.secondary]}>
            Tai опирается на этот текст, когда отвечает гостям в Telegram. Опишите форматы игр, школу мафии, мероприятия и особенности клуба. Цены, адрес и расписание он
            берёт из HUB сам.
          </Text>
          <View style={styles.card}>
            <TextInput
              value={value}
              onChangeText={setText}
              multiline
              maxLength={BRIEF_MAX}
              placeholder="Например: спортивная мафия по пятницам, городская по субботам…"
              placeholderTextColor={colors.tertiaryLabel}
              selectionColor={colors.accent}
              style={[type.body, styles.input]}
              textAlignVertical="top"
              accessibilityLabel="Что Tai рассказывает о клубе"
            />
          </View>
          <Text style={[type.footnote, styles.secondary, styles.counter]}>{`${value.length} / ${BRIEF_MAX}`}</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.groupedBackground },
  content: { padding: space.lg, gap: space.md },
  secondary: { color: colors.secondaryLabel },
  card: { backgroundColor: colors.card, borderRadius: 14, borderCurve: 'continuous', padding: space.md },
  input: { color: colors.label, minHeight: 260 },
  counter: { textAlign: 'right' },
});
