import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';

import { BigButton, Card, ChipButton, PlatformBadge } from '@/components/smm/parts';
import { Text, TextInput } from '@/components/text';
import { api, ApiError } from '@/lib/api';
import { haptic } from '@/lib/haptics';
import { usePageGutter } from '@/lib/layout';
import { DIRECTIONS, FORMAT_LABEL, PLATFORM_LOOK, directionLabel, type SmmIdea } from '@/lib/smm-api';
import { colors, space, type, useAccentHex } from '@/lib/theme';

/**
 * Генератор идей: по всем направлениям клуба или по одному, с пожеланием («к Хэллоуину»,
 * «для новичков»). Понравившаяся идея — в план одной кнопкой: остаётся выбрать день.
 */
export default function SmmIdeasScreen() {
  const router = useRouter();
  const gutter = usePageGutter();
  const accent = useAccentHex();
  const [direction, setDirection] = useState<string | null>(null);
  const [wish, setWish] = useState('');
  const [ideas, setIdeas] = useState<SmmIdea[]>([]);
  const [loading, setLoading] = useState(false);

  const generate = async () => {
    setLoading(true);
    try {
      const r = await api.post<{ ideas: SmmIdea[] }>('/smm/ideas', { direction: direction ?? undefined, wish: wish.trim() || undefined });
      setIdeas(r.ideas);
      haptic.success();
    } catch (error) {
      Alert.alert('Идеи не пришли', error instanceof ApiError ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  const take = (idea: SmmIdea) =>
    router.push({ pathname: '/manage/smm/new', params: { topic: idea.topic, brief: idea.brief, platform: idea.platform, format: idea.format, direction: idea.direction } });

  return (
    <View style={styles.screen}>
      <Stack.Title>Идеи</Stack.Title>
      <KeyboardAvoidingView behavior="padding" style={styles.flex}>
        <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={[styles.content, gutter]} keyboardShouldPersistTaps="handled">
          <Text style={[type.subhead, styles.secondary]}>Tai придумывает публикации из жизни клуба: вечера, турниры, люди, бар, мероприятия — и под тренды рилс.</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {[{ key: '', label: 'Все направления' }, ...DIRECTIONS].map((d) => {
              const on = (direction ?? '') === d.key;
              return (
                <Pressable
                  key={d.key || 'all'}
                  onPress={() => {
                    haptic.selection();
                    setDirection(d.key || null);
                  }}
                  style={[styles.chip, on && { backgroundColor: accent }]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}>
                  <Text style={[type.subhead, { color: on ? 'white' : colors.label }]}>{d.label}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
          <View style={styles.wish}>
            <TextInput
              value={wish}
              onChangeText={setWish}
              placeholder="Пожелание: к Хэллоуину, для новичков, про бар…"
              placeholderTextColor={colors.tertiaryLabel}
              selectionColor={colors.accent}
              maxLength={300}
              style={[type.body, styles.input]}
              accessibilityLabel="Пожелание к идеям"
            />
          </View>
          <BigButton title={loading ? 'Tai думает…' : ideas.length ? 'Ещё идеи' : 'Придумать идеи'} icon="lightbulb" busy={loading} onPress={() => void generate()} />
          {ideas.map((idea) => (
            <Card key={`${idea.topic}-${idea.format}`}>
              <View style={styles.meta}>
                <PlatformBadge platform={idea.platform} size={20} />
                <Text style={[type.footnote, styles.secondary, styles.flex]} numberOfLines={1}>
                  {[PLATFORM_LOOK[idea.platform].label, FORMAT_LABEL[idea.format], directionLabel(idea.direction)].filter(Boolean).join(' · ')}
                </Text>
              </View>
              <Text style={[type.headline, styles.label]} selectable>
                {idea.topic}
              </Text>
              <Text style={[type.subhead, styles.secondary]} selectable>
                {idea.brief}
              </Text>
              <View style={styles.row}>
                <ChipButton title="В план" icon="calendar.badge.plus" onPress={() => take(idea)} />
              </View>
            </Card>
          ))}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.groupedBackground },
  flex: { flex: 1, minWidth: 0 },
  content: { gap: space.md, paddingTop: space.md, paddingBottom: space.xxxl },
  label: { color: colors.label },
  secondary: { color: colors.secondaryLabel },
  chips: { gap: space.sm, paddingVertical: 2 },
  chip: { paddingHorizontal: space.md, height: 34, borderRadius: 17, justifyContent: 'center', backgroundColor: colors.card },
  wish: { backgroundColor: colors.card, borderRadius: 14, borderCurve: 'continuous', paddingHorizontal: space.md },
  input: { color: colors.label, minHeight: 44 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  row: { flexDirection: 'row', gap: space.sm },
});
