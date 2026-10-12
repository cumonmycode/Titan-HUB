import { ContentUnavailableView, Form, Host, ProgressView, Section, Text } from '@expo/ui/swift-ui';
import { refreshable } from '@expo/ui/swift-ui/modifiers';
import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { Stack, useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { ActionRow } from '@/components/native-form';
import { Text as RNText } from '@/components/text';
import { haptic } from '@/lib/haptics';
import { STORY_KINDS, storyPhotoSrc, useSiteDomain, useSiteStories, type Story } from '@/lib/site-api';
import { colors, space, type } from '@/lib/theme';

const kindTitle = (s: Story) => STORY_KINDS.find((k) => k.id === s.kind)?.title ?? 'Событие';
const dateText = (iso: string | null) =>
  iso ? new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) : null;

/**
 * Публикации сайта — турниры, вечеринки и события с фото и ссылкой на альбом
 * Google Drive. Опубликованные видны на сайте, черновики — только здесь.
 */
export default function SiteStoriesScreen() {
  const router = useRouter();
  const stories = useSiteStories();
  const domain = useSiteDomain();
  const mirror = domain.data?.mirror ?? 'https://site.titanpos.ru';

  if (!stories.data) {
    return (
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        {stories.isError ? <ContentUnavailableView title="Публикации не загрузились" systemImage="wifi.exclamationmark" description={stories.error.message} /> : <ProgressView />}
      </Host>
    );
  }

  const published = stories.data.filter((s) => s.is_published);
  const drafts = stories.data.filter((s) => !s.is_published);
  const open = (id?: string) => router.push((id ? `/manage/settings/site/story?storyId=${id}` : '/manage/settings/site/story') as never);

  return (
    <>
      <Stack.Title>Публикации</Stack.Title>
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <Form modifiers={[refreshable(async () => { await stories.refetch(); })]}>
          <Section>
            <ActionRow title="Новая публикация" icon="plus.circle.fill" onPress={() => open()} />
          </Section>
          {published.length > 0 && (
            <Section title="На сайте" footer={<Text>Сначала идут публикации с большим порядком, затем — по дате события.</Text>}>
              {published.map((s) => <StoryRow key={s.id} story={s} mirror={mirror} onPress={() => open(s.id)} />)}
            </Section>
          )}
          {drafts.length > 0 && (
            <Section title="Черновики" footer={<Text>Черновики не видны на сайте — включите «Показывать на сайте» в публикации.</Text>}>
              {drafts.map((s) => <StoryRow key={s.id} story={s} mirror={mirror} onPress={() => open(s.id)} />)}
            </Section>
          )}
          {stories.data.length === 0 && (
            <Section footer={<Text>Расскажите о турнирах и вечеринках клуба: обложка, фото, цифры и ссылка на альбом.</Text>}>
              <Text>Публикаций пока нет</Text>
            </Section>
          )}
        </Form>
      </Host>
    </>
  );
}

function StoryRow({ story, mirror, onPress }: { story: Story; mirror: string; onPress: () => void }) {
  const cover = story.cover_url ?? story.photos[0] ?? null;
  const meta = [kindTitle(story), dateText(story.event_date), `${story.photos.length} фото`].filter(Boolean).join(' · ');
  return (
    <Pressable
      onPress={() => {
        haptic.selection();
        onPress();
      }}
      accessibilityRole="button"
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      {cover ? (
        <Image source={{ uri: storyPhotoSrc(cover, mirror) }} style={styles.thumb} contentFit="cover" transition={150} />
      ) : (
        <View style={[styles.thumb, styles.placeholder]}>
          <SymbolView name="photo" size={20} tintColor={colors.tertiaryLabel} />
        </View>
      )}
      <View style={styles.flex}>
        <RNText style={[type.body, styles.label]} numberOfLines={2}>
          {story.title}
        </RNText>
        <RNText style={[type.footnote, styles.secondary]} numberOfLines={1}>
          {meta}
        </RNText>
      </View>
      <SymbolView name="chevron.right" size={13} weight="semibold" tintColor={colors.tertiaryLabel} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, gap: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm, minHeight: 64 },
  thumb: { width: 56, height: 56, borderRadius: 10, borderCurve: 'continuous', backgroundColor: colors.fill },
  placeholder: { alignItems: 'center', justifyContent: 'center' },
  label: { color: colors.label },
  secondary: { color: colors.secondaryLabel },
  pressed: { opacity: 0.6 },
});
