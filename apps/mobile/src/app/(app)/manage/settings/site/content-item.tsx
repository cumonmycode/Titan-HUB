import { Form, Picker, ProgressView, Section, Text, Toggle } from '@expo/ui/swift-ui';
import { pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';

import { EditorToolbar } from '@/components/editor-toolbar';
import { ActionRow, FieldRow, FormHost, InputRow, LinkRow } from '@/components/native-form';
import { chooseAction } from '@/lib/dialog';
import { haptic } from '@/lib/haptics';
import { CHAT_PHOTO_FIT, pickChatPhoto, uploadImage } from '@/lib/photo';
import {
  blankItem,
  PAGE_IDS,
  PAGE_LOOK,
  saveContentSection,
  SECTION_LOOK,
  useSiteContent,
  type DocItem,
  type FormatItem,
  type ListItem,
  type ListSectionId,
  type PageId,
  type PageItem,
  type ReviewItem,
  type SectionId,
  type SiteContentState,
  type TeamItem,
  type ValueItem,
} from '@/lib/site-content-api';

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const LIST_SECTIONS: ListSectionId[] = ['formats', 'team', 'reviews', 'values', 'docs'];
const NO_STAFF = '';
/** Абзацы страницы — через пустую строку в одном поле. */
const PARAGRAPH_SPLIT = /\n\s*\n/;
const HREF_RE = /^(https:\/\/\S+|\/[\w\-./]*)$/;

/** Элемент содержимого сайта: index — номер в списке, «new» — новый, для страниц — id страницы. */
export default function ContentItemEditor() {
  const { section, index } = useLocalSearchParams<{ section: string; index: string }>();
  const content = useSiteContent();
  if (!content.data) {
    return (
      <FormHost>
        <ProgressView />
      </FormHost>
    );
  }
  if (section === 'pages' && PAGE_IDS.includes(index as PageId)) {
    return <PageForm key={index} state={content.data} pageId={index as PageId} />;
  }
  if (!LIST_SECTIONS.includes(section as ListSectionId)) return null;
  return <ItemForm key={`${section}-${index}`} state={content.data} section={section as ListSectionId} index={index === 'new' ? null : Number(index)} />;
}

function useSave(onDone: () => void) {
  const [busy, setBusy] = useState(false);
  const run = async (section: SectionId, value: unknown) => {
    setBusy(true);
    try {
      await saveContentSection(section, value);
      haptic.success();
      onDone();
    } catch (error) {
      haptic.error();
      Alert.alert('Не сохранилось', errorText(error));
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}

/** Строка фото: снять, выбрать или убрать; загружается в хранилище клуба. */
function PhotoRow({ value, onChange, label = 'Фото' }: { value: string; onChange: (next: string) => void; label?: string }) {
  const [loading, setLoading] = useState(false);
  const pick = async (source: 'camera' | 'library') => {
    const asset = await pickChatPhoto(source);
    if (!asset) return;
    setLoading(true);
    try {
      onChange(await uploadImage(asset, CHAT_PHOTO_FIT));
      haptic.success();
    } catch (error) {
      haptic.error();
      Alert.alert('Фото не загрузилось', errorText(error));
    } finally {
      setLoading(false);
    }
  };
  const state = loading ? 'загружаем…' : !value ? 'нет' : /^https?:\/\//.test(value) ? 'своё' : 'с сайта';
  return (
    <LinkRow
      icon="photo"
      color="#34C759"
      title={label}
      value={state}
      onPress={() =>
        chooseAction(label, undefined, [
          { text: 'Снять', onPress: () => void pick('camera') },
          { text: 'Из галереи', onPress: () => void pick('library') },
          ...(value ? [{ text: 'Убрать', style: 'destructive' as const, onPress: () => onChange('') }] : []),
          { text: 'Отмена', style: 'cancel' as const },
        ])
      }
    />
  );
}

function problemOf(section: ListSectionId, draft: ListItem): string | null {
  switch (section) {
    case 'formats':
      return (draft as FormatItem).title.trim() ? null : 'Укажите название';
    case 'team':
      return (draft as TeamItem).name.trim() || (draft as TeamItem).profileId ? null : 'Выберите сотрудника или впишите имя';
    case 'reviews':
      return (draft as ReviewItem).author.trim() && (draft as ReviewItem).text.trim() ? null : 'Нужны автор и текст';
    case 'values':
      return (draft as ValueItem).title.trim() ? null : 'Укажите название';
    case 'docs': {
      const d = draft as DocItem;
      if (!d.title.trim()) return 'Укажите название';
      return HREF_RE.test(d.href.trim()) ? null : 'Ссылка на файл — https://… или /docs/…';
    }
  }
}

function ItemForm({ state, section, index }: { state: SiteContentState; section: ListSectionId; index: number | null }) {
  const router = useRouter();
  const list = state.content[section] as ListItem[];
  const original = index !== null ? (list[index] ?? null) : null;
  const [draft, setDraft] = useState<ListItem>(() => original ?? blankItem(section as Exclude<ListSectionId, 'formats'>));
  const { busy, run } = useSave(() => router.back());
  const look = SECTION_LOOK[section];
  const patch = (next: Partial<FormatItem & TeamItem & ReviewItem & ValueItem & DocItem>) => setDraft((d) => ({ ...d, ...next }) as ListItem);
  const issue = problemOf(section, draft);

  const save = () => {
    if (issue) {
      Alert.alert(issue);
      return;
    }
    haptic.medium();
    const next = index !== null ? list.map((it, i) => (i === index ? draft : it)) : [...list, draft];
    void run(section, next);
  };

  const remove = () => {
    if (index === null) return;
    Alert.alert('Убрать с сайта?', undefined, [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Убрать', style: 'destructive', onPress: () => void run(section, list.filter((_, i) => i !== index)) },
    ]);
  };

  const moveUp = () => {
    if (index === null || index === 0) return;
    const next = [...list];
    const above = next[index - 1]!;
    next[index - 1] = next[index]!;
    next[index] = above;
    void run(section, next);
  };

  return (
    <>
      <EditorToolbar title={original ? look.item : `Новый: ${look.item.toLowerCase()}`} canSave={!issue} busy={busy} onSave={save} />
      <FormHost>
        <Form>
          {section === 'formats' ? <FormatFields item={draft as FormatItem} patch={patch} /> : null}
          {section === 'team' ? <TeamFields item={draft as TeamItem} patch={patch} state={state} /> : null}
          {section === 'reviews' ? (
            <Section title="Отзыв">
              <InputRow label="Автор" value={(draft as ReviewItem).author} placeholder="Имя гостя" onChange={(author) => patch({ author })} />
              <FieldRow value={(draft as ReviewItem).text} placeholder="Текст отзыва" multiline maxLength={600} onChange={(text) => patch({ text })} />
            </Section>
          ) : null}
          {section === 'values' ? (
            <Section title="Ценность">
              <InputRow label="Название" value={(draft as ValueItem).title} placeholder="Драйв" onChange={(title) => patch({ title })} />
              <FieldRow value={(draft as ValueItem).text} placeholder="Одной фразой" multiline maxLength={160} onChange={(text) => patch({ text })} />
            </Section>
          ) : null}
          {section === 'docs' ? (
            <Section title="Документ" footer={<Text>Ссылка на PDF: https://… или файл сайта /docs/….</Text>}>
              <InputRow label="Название" value={(draft as DocItem).title} placeholder="Правила игры" onChange={(title) => patch({ title })} />
              <FieldRow value={(draft as DocItem).text} placeholder="О чём документ" multiline maxLength={300} onChange={(text) => patch({ text })} />
              <InputRow label="Ссылка" value={(draft as DocItem).href} placeholder="https://…" keyboard="url" onChange={(href) => patch({ href })} />
              <PhotoRow label="Обложка" value={(draft as DocItem).cover} onChange={(cover) => patch({ cover })} />
            </Section>
          ) : null}

          {original ? (
            <Section>
              {index !== null && index > 0 ? <ActionRow title="Поставить выше" icon="arrow.up" disabled={busy} onPress={moveUp} /> : null}
              {section !== 'formats' ? <ActionRow title="Убрать с сайта" icon="minus.circle" destructive disabled={busy} onPress={remove} /> : null}
            </Section>
          ) : null}
        </Form>
      </FormHost>
    </>
  );
}

function FormatFields({ item, patch }: { item: FormatItem; patch: (next: Partial<FormatItem>) => void }) {
  return (
    <>
      <Section title="Карточка">
        <InputRow label="Название" value={item.title} placeholder="Городская мафия" onChange={(title) => patch({ title })} />
        <InputRow label="Коротко" value={item.short} placeholder="Психологическая игра для всех" onChange={(short) => patch({ short })} />
        <FieldRow value={item.text} placeholder="Описание формата" multiline maxLength={600} onChange={(text) => patch({ text })} />
        <PhotoRow value={item.photo} onChange={(photo) => patch({ photo })} />
      </Section>
      <Section footer={<Text>Скрытый формат пропадает с сайта, остальные остаются на своих местах.</Text>}>
        <Toggle label="Показывать на сайте" isOn={!item.hidden} onIsOnChange={(on) => patch({ hidden: !on })} />
      </Section>
    </>
  );
}

function TeamFields({ item, patch, state }: { item: TeamItem; patch: (next: Partial<TeamItem>) => void; state: SiteContentState }) {
  const staff = state.staff.find((s) => s.id === item.profileId) ?? null;
  return (
    <Section title="Кто" footer={<Text>Сотрудник клуба — имя и фото на сайте берутся из его карточки и меняются вместе с ней.</Text>}>
      <Picker
        label="Сотрудник"
        selection={item.profileId ?? NO_STAFF}
        onSelectionChange={(next) => {
          haptic.selection();
          const id = String(next) || null;
          patch({ profileId: id, ...(id ? { name: '', photo: '' } : {}) });
        }}
        modifiers={[pickerStyle('menu')]}>
        <Text modifiers={[tag(NO_STAFF)]}>Не из сотрудников</Text>
        {state.staff.map((s) => (
          <Text key={s.id} modifiers={[tag(s.id)]}>
            {s.fullName || s.nickname}
          </Text>
        ))}
      </Picker>
      <InputRow label="Имя" value={item.name} placeholder={staff ? staff.fullName || staff.nickname : 'Имя и фамилия'} onChange={(name) => patch({ name })} />
      <InputRow label="Роль" value={item.role} placeholder="Ведущий" onChange={(role) => patch({ role })} />
      <PhotoRow label={staff ? 'Своё фото' : 'Фото'} value={item.photo} onChange={(photo) => patch({ photo })} />
    </Section>
  );
}

function PageForm({ state, pageId }: { state: SiteContentState; pageId: PageId }) {
  const router = useRouter();
  const page = state.content.pages[pageId];
  const [title, setTitle] = useState(page.title);
  const [lead, setLead] = useState(page.lead);
  const [text, setText] = useState(page.text.join('\n\n'));
  const { busy, run } = useSave(() => router.back());
  const look = PAGE_LOOK[pageId];

  const save = () => {
    if (!title.trim()) {
      Alert.alert('Укажите заголовок');
      return;
    }
    haptic.medium();
    const next: PageItem = {
      title: title.trim(),
      lead: lead.trim(),
      text: text
        .split(PARAGRAPH_SPLIT)
        .map((p) => p.trim())
        .filter(Boolean),
    };
    void run('pages', { ...state.content.pages, [pageId]: next });
  };

  return (
    <>
      <EditorToolbar title={look.title} canSave={title.trim().length > 0} busy={busy} onSave={save} />
      <FormHost>
        <Form>
          <Section title="Заголовок" footer={<Text>{look.about}</Text>}>
            <FieldRow value={title} placeholder="Заголовок" maxLength={80} onChange={setTitle} />
          </Section>
          <Section title="Подзаголовок">
            <FieldRow value={lead} placeholder="Пара фраз под заголовком" multiline maxLength={400} onChange={setLead} />
          </Section>
          {pageId === 'kids' || pageId === 'studio' ? (
            <Section title="Текст" footer={<Text>Абзацы разделяйте пустой строкой.</Text>}>
              <FieldRow value={text} placeholder="Текст страницы" multiline maxLength={4000} onChange={setText} />
            </Section>
          ) : null}
        </Form>
      </FormHost>
    </>
  );
}
