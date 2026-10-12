import { Button, DatePicker, Form, Picker, ProgressView, Section, Text, Toggle } from '@expo/ui/swift-ui';
import { pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, useWindowDimensions } from 'react-native';

import { EditorToolbar } from '@/components/editor-toolbar';
import { ActionRow, FieldRow, FormHost } from '@/components/native-form';
import { PhotoGrid } from '@/components/site/photo-grid';
import { haptic } from '@/lib/haptics';
import {
  EMPTY_STORY, STORY_KINDS, deleteStory, draftOfStory, saveStory, slugify, storyPhotoSrc, useSiteDomain, useSiteStories,
  type Story, type StoryDraft, type StoryKind, type StoryStat,
} from '@/lib/site-api';

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,39}$/;
const MAX_STATS = 4;
/** Отступы формы и карточки секции: ширина сетки фото внутри строки. */
const GRID_INSET = 64;

const toIso = (d: Date) => d.toISOString().slice(0, 10);
const fromIso = (iso: string | null) => (iso ? new Date(`${iso}T12:00:00Z`) : new Date());
/** «30 участников» → { value: '30', label: 'участников' }. */
function parseStat(text: string): StoryStat | null {
  const m = text.trim().match(/^(\S+)\s+(.+)$/);
  return m ? { value: m[1]!.slice(0, 24), label: m[2]!.trim().slice(0, 40) } : null;
}
const isHttps = (v: string) => v.trim() === '' || /^https:\/\/\S+$/.test(v.trim());

/** Публикация сайта: турнир, вечеринка или событие — текст, цифры, фото и альбом. */
export default function StoryEditor() {
  const { storyId } = useLocalSearchParams<{ storyId?: string }>();
  const stories = useSiteStories();
  if (storyId && !stories.data) {
    return (
      <FormHost>
        <ProgressView />
      </FormHost>
    );
  }
  const original = storyId ? (stories.data?.find((s) => s.id === storyId) ?? null) : null;
  return <StoryForm key={original?.id ?? 'new'} original={original} />;
}

function StoryForm({ original }: { original: Story | null }) {
  const router = useRouter();
  const domain = useSiteDomain();
  const { width } = useWindowDimensions();
  const mirror = domain.data?.mirror ?? 'https://site.titanpos.ru';
  const [draft, setDraft] = useState<StoryDraft>(() => (original ? draftOfStory(original) : EMPTY_STORY));
  const [slugTouched, setSlugTouched] = useState(!!original);
  const [stats, setStats] = useState<string[]>(() => (original?.stats ?? []).map((s) => `${s.value} ${s.label}`));
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof StoryDraft>(key: K, value: StoryDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const parsedStats = stats.map((s) => s.trim()).filter(Boolean).map(parseStat);
  const statsValid = parsedStats.every(Boolean);
  const linksValid = isHttps(draft.galleryUrl) && isHttps(draft.resultsUrl);
  const canSave = draft.title.trim().length > 0 && SLUG_RE.test(draft.slug) && statsValid && linksValid;

  const setTitle = (title: string) => setDraft((d) => ({ ...d, title, slug: slugTouched ? d.slug : slugify(title) }));

  const save = async () => {
    if (!canSave) return;
    haptic.medium();
    setBusy(true);
    try {
      await saveStory(original?.id ?? null, {
        ...draft,
        title: draft.title.trim(),
        stats: parsedStats as StoryStat[],
        coverUrl: draft.photos[0] ?? null,
        galleryUrl: draft.galleryUrl.trim(),
        resultsUrl: draft.resultsUrl.trim(),
      });
      haptic.success();
      router.back();
    } catch (error) {
      haptic.error();
      Alert.alert('Публикация не сохранена', errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const remove = () =>
    original &&
    Alert.alert(`Удалить «${original.title}»?`, 'Публикация исчезнет с сайта. Фото в хранилище останутся.', [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Удалить',
        style: 'destructive',
        onPress: () =>
          void deleteStory(original.id)
            .then(() => {
              haptic.success();
              router.back();
            })
            .catch((error: unknown) => Alert.alert('Публикация не удалена', errorText(error))),
      },
    ]);

  return (
    <>
      <EditorToolbar title={original ? 'Публикация' : 'Новая публикация'} canSave={canSave} busy={busy} onSave={() => void save()} />
      <FormHost>
        <Form>
          <Section title="Название">
            <FieldRow value={draft.title} placeholder="Society Mafia Cup 2026" autoFocus={!original} maxLength={120} onChange={setTitle} />
            <FieldRow value={draft.tagline} placeholder="Подзаголовок — одна строка о событии" maxLength={160} onChange={(v) => set('tagline', v)} />
            <Picker
              selection={draft.kind}
              onSelectionChange={(next) => {
                haptic.selection();
                set('kind', next as StoryKind);
              }}
              modifiers={[pickerStyle('segmented')]}>
              {STORY_KINDS.map((k) => (
                <Text key={k.id} modifiers={[tag(k.id)]}>
                  {k.title}
                </Text>
              ))}
            </Picker>
            <Toggle label="Дата события" isOn={draft.eventDate !== null} onIsOnChange={(on) => set('eventDate', on ? toIso(new Date()) : null)} />
            {draft.eventDate !== null && (
              <DatePicker title="Когда" selection={fromIso(draft.eventDate)} displayedComponents={['date']} onDateChange={(d) => set('eventDate', toIso(d))} />
            )}
          </Section>

          <Section title="Фото" footer={<Text>Первое фото — обложка. Нажмите на фото, чтобы сделать его обложкой или убрать.</Text>}>
            <PhotoGrid photos={draft.photos} onChange={(photos) => set('photos', photos)} resolve={(u) => storyPhotoSrc(u, mirror)} width={width - GRID_INSET} />
          </Section>

          <Section title="Рассказ" footer={<Text>Абзацы разделяйте пустой строкой.</Text>}>
            <FieldRow value={draft.body} placeholder="Как прошёл вечер, кто победил, что запомнилось" multiline maxLength={6000} onChange={(v) => set('body', v)} />
          </Section>

          <Section title="Цифры" footer={<Text>{statsValid ? 'Число и подпись через пробел: «30 участников», «12 игр».' : 'Нужны число и подпись через пробел — например, «30 участников».'}</Text>}>
            {stats.map((s, i) => (
              <FieldRow key={i} value={s} placeholder="30 участников" maxLength={64} onChange={(v) => setStats((list) => list.map((x, j) => (j === i ? v : x)))} />
            ))}
            {stats.length < MAX_STATS && <Button label="Добавить цифру" systemImage="plus" onPress={() => setStats((list) => [...list, ''])} />}
          </Section>

          <Section title="Ссылки" footer={<Text>{linksValid ? 'Альбом Google Drive с полными фото и таблица результатов турнира.' : 'Ссылки должны начинаться с https://'}</Text>}>
            <FieldRow value={draft.galleryUrl} placeholder="Альбом: https://drive.google.com/…" keyboard="url" maxLength={500} onChange={(v) => set('galleryUrl', v)} />
            <FieldRow value={draft.resultsUrl} placeholder="Результаты: https://…" keyboard="url" maxLength={500} onChange={(v) => set('resultsUrl', v)} />
          </Section>

          <Section title="На сайте" footer={<Text>{`Адрес: ${mirror.replace('https://', '')}/${draft.slug || '…'}${SLUG_RE.test(draft.slug) || !draft.slug ? '' : ' — только латиница, цифры и дефис'}`}</Text>}>
            <Toggle label="Показывать на сайте" isOn={draft.isPublished} onIsOnChange={(on) => set('isPublished', on)} />
            <FieldRow
              value={draft.slug}
              placeholder="адрес-публикации"
              keyboard="url"
              maxLength={40}
              onChange={(v) => {
                setSlugTouched(true);
                set('slug', v.trim().toLowerCase());
              }}
            />
          </Section>

          {original && (
            <Section>
              <ActionRow title="Удалить публикацию" icon="trash" destructive disabled={busy} onPress={remove} />
            </Section>
          )}
        </Form>
      </FormHost>
    </>
  );
}
