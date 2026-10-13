import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';

import { EditorToolbar } from '@/components/editor-toolbar';
import { Text, TextInput } from '@/components/text';
import { ApiError } from '@/lib/api';
import { useClubKey } from '@/lib/queries';
import { patchPost, saveSettings, useSmmPost, useSmmSettings, type SmmSettings } from '@/lib/smm-api';
import { knowledgeRequest, useSmmKnowledge } from '@/lib/smm-knowledge';
import { colors, space, type } from '@/lib/theme';

type SettingsField = 'voice' | 'audience' | 'goals';

const FIELDS: Record<SettingsField, { title: string; hint: string; max: number }> = {
  voice: { title: 'Голос бренда', hint: 'Как Tai пишет от имени клуба: тон, обращение, юмор, чего избегать.', max: 1500 },
  audience: { title: 'Аудитория', hint: 'Для кого пишем: возраст, интересы, кто приходит на игры и кто заказывает мероприятия.', max: 1500 },
  goals: { title: 'Цели', hint: 'Чего добиваемся соцсетями: гости на вечерах, заявки на ДР и корпоративы, узнаваемость.', max: 1500 },
};

const CLUB_HINT = 'Что Tai важно знать о клубе своими словами: история и чем гордимся, наши правила городской мафии (какие роли, раскрываем ли роли), ведущие и лица клуба, традиции, о чём не писать. Это главнее всего, что Tai соберёт сам.';
const ZONE_HINT = 'Как выглядит зона и для чего она: сколько мест, что стоит, какой свет, что в ней происходит (игры, ДР, бар). Tai дополнит по фото.';

/**
 * Большое поле на весь экран: текст публикации (правка руками, Tai не переписывает),
 * текст настроек СММ — голос бренда, аудитория, цели — или база знаний: слова владельца
 * о клубе и описание зоны интерьера.
 */
export default function SmmTextEditor() {
  const { postId = '', field, knowledge, zoneId = '' } = useLocalSearchParams<{ postId?: string; field?: SettingsField; knowledge?: 'club'; zoneId?: string }>();
  const router = useRouter();
  const club = useClubKey();
  const isPost = !!postId;
  const post = useSmmPost(postId);
  const settings = useSmmSettings(!!field);
  const kn = useSmmKnowledge(knowledge === 'club' || !!zoneId);
  const zone = kn.data?.zones.find((z) => z.id === zoneId);
  const meta = field
    ? FIELDS[field]
    : knowledge === 'club'
      ? { title: 'О клубе — для Tai', hint: CLUB_HINT, max: 8000 }
      : zone
        ? { title: zone.title, hint: ZONE_HINT, max: 3000 }
        : null;
  const initial = isPost ? (post.data?.post.body ?? '') : field ? (settings.data?.settings[field] ?? '') : knowledge === 'club' ? (kn.data?.club.ownerText ?? '') : (zone?.ownerText ?? '');
  const [text, setText] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const value = text ?? initial;
  const dirty = text !== null && text.trim() !== initial.trim();
  const max = meta?.max ?? 4000;

  const save = async () => {
    setSaving(true);
    try {
      if (isPost) await patchPost(club, postId, { body: value.trim() });
      else if (field) await saveSettings(club, { [field]: value.trim() } as Partial<SmmSettings>);
      else if (knowledge === 'club') await knowledgeRequest(club, 'put', '/smm/knowledge/club', { ownerText: value.trim() });
      else if (zoneId) await knowledgeRequest(club, 'patch', `/smm/zones/${zoneId}`, { ownerText: value.trim() });
      router.back();
    } catch (error) {
      Alert.alert('Не сохранилось', error instanceof ApiError ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const hint = isPost
    ? post.data?.post.platform === 'telegram'
      ? 'Можно выделять: <b>жирный</b>, <i>курсив</i>, <a href="https://…">ссылка</a>. Хотите, чтобы переписал Tai, — оставьте замечание в публикации.'
      : 'Простой текст, хэштеги — в конце, не больше пяти. Хотите, чтобы переписал Tai, — оставьте замечание в публикации.'
    : (meta?.hint ?? '');

  return (
    <>
      <EditorToolbar title={isPost ? 'Текст публикации' : (meta?.title ?? 'Текст')} canSave={dirty && (!!value.trim() || !isPost)} busy={saving} onSave={() => void save()} />
      <KeyboardAvoidingView behavior="padding" style={styles.flex}>
        <ScrollView style={styles.flex} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={[type.subhead, styles.secondary]}>{hint}</Text>
          <View style={styles.card}>
            <TextInput
              value={value}
              onChangeText={setText}
              multiline
              maxLength={max}
              placeholderTextColor={colors.tertiaryLabel}
              selectionColor={colors.accent}
              style={[type.body, styles.input]}
              textAlignVertical="top"
              accessibilityLabel={isPost ? 'Текст публикации' : meta?.title}
            />
          </View>
          <Text style={[type.footnote, styles.secondary, styles.counter]}>{`${value.length} / ${max}`}</Text>
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
  input: { color: colors.label, minHeight: 300 },
  counter: { textAlign: 'right' },
});
