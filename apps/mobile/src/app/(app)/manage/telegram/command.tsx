import { Form, Picker, ProgressView, Section, Text, Toggle } from '@expo/ui/swift-ui';
import { pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';

import { EditorToolbar } from '@/components/editor-toolbar';
import { ActionRow, FieldRow, FormHost } from '@/components/native-form';
import { haptic } from '@/lib/haptics';
import { AUDIENCE_INFO, useTelegramChat, type ChatCommand, type CommandAccess, type MentionAudience } from '@/lib/telegram-api';

const NAME_RE = /^[a-z0-9_]{1,32}$/;
const AUDIENCES: MentionAudience[] = ['all', 'unvoted', 'yes', 'no', 'staff'];
type AccessChoice = 'chat' | CommandAccess;
type SaveAsync = ReturnType<typeof useTelegramChat>['saveAsync'];

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const parseAliases = (text: string) => [...new Set(text.split(/[,\s]+/).map((a) => a.trim().toLowerCase()).filter(Boolean))].slice(0, 8);

/** Команда чата: название для меню «/», другие слова, что делает и кто может вызвать. */
export default function CommandEditor() {
  const { id, commandId } = useLocalSearchParams<{ id: string; commandId?: string }>();
  const editor = useTelegramChat(id);
  const detail = editor.query.data;

  if (!detail) {
    return (
      <FormHost>
        <ProgressView />
      </FormHost>
    );
  }
  const list = detail.config.commands.list;
  const original = commandId ? (list.find((c) => c.id === commandId) ?? null) : null;
  return <CommandForm key={original?.id ?? 'new'} list={list} original={original} save={editor.saveAsync} busy={editor.saving} />;
}

function CommandForm({ list, original, save, busy }: { list: ChatCommand[]; original: ChatCommand | null; save: SaveAsync; busy: boolean }) {
  const router = useRouter();
  const [draft, setDraft] = useState<ChatCommand>(() => original ?? { id: `c${Date.now().toString(36)}`, name: '', aliases: [], description: '', kind: 'text', text: '', enabled: true });
  const [aliasText, setAliasText] = useState(() => draft.aliases.join(', '));
  const patch = (next: Partial<ChatCommand>) => setDraft((current) => ({ ...current, ...next }));
  const builtin = !!original?.builtin;
  const access: AccessChoice = draft.access ?? 'chat';
  const callable = draft.kind === 'mention' || draft.kind === 'text';

  const problem = (): string | null => {
    const name = draft.name.trim().toLowerCase();
    if (!NAME_RE.test(name)) return 'Команда — латиница, цифры и «_», без «/»';
    if (list.some((c) => c.id !== draft.id && c.name === name)) return 'Такая команда уже есть';
    if (!draft.description.trim()) return 'Добавьте описание — оно видно в меню «/»';
    if (draft.kind === 'text' && !draft.text?.trim()) return 'Напишите, что бот ответит';
    return null;
  };

  const persist = async (next: ChatCommand[]) => {
    try {
      await save({ commands: { list: next } });
      haptic.success();
      router.back();
    } catch (error) {
      haptic.error();
      Alert.alert('Не сохранилось', errorText(error));
    }
  };

  const submit = () => {
    const issue = problem();
    if (issue) return Alert.alert(issue);
    const clean: ChatCommand = { ...draft, name: draft.name.trim().toLowerCase(), description: draft.description.trim(), aliases: parseAliases(aliasText) };
    void persist(original ? list.map((c) => (c.id === clean.id ? clean : c)) : [...list, clean]);
  };

  const remove = () =>
    original &&
    Alert.alert(`Удалить /${original.name}?`, 'Команда пропадёт из чата и из меню «/».', [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Удалить', style: 'destructive', onPress: () => void persist(list.filter((c) => c.id !== original.id)) },
    ]);

  const setKind = (value: string) => patch({ kind: value as ChatCommand['kind'], audience: value === 'mention' ? (draft.audience ?? 'all') : undefined });

  return (
    <>
      <EditorToolbar title={original ? `/${original.name}` : 'Новая команда'} canSave={!problem()} busy={busy} onSave={submit} />
      <FormHost>
        <Form>
          <Section footer={<Text>Выключенная команда не отвечает и пропадает из меню «/».</Text>}>
            <Toggle label="Команда включена" isOn={draft.enabled} onIsOnChange={(enabled) => patch({ enabled })} />
          </Section>

          <Section title="Команда" footer={<Text>Латиницей, без «/»: например, rules или schedule. Её видно в меню «/» Telegram.</Text>}>
            <FieldRow value={draft.name} placeholder="schedule" autoFocus={!original} maxLength={32} onChange={(name) => patch({ name: name.replace(/^\//, '') })} />
          </Section>

          <Section title="Другие названия" footer={<Text>Через запятую — на них команда тоже отзовётся: @all, @все, расписание.</Text>}>
            <FieldRow value={aliasText} placeholder="@расписание, расписание" onChange={setAliasText} />
          </Section>

          <Section title="Описание">
            <FieldRow value={draft.description} placeholder="Расписание игр на неделю" maxLength={64} onChange={(description) => patch({ description })} />
          </Section>

          {!builtin ? (
            <Section title="Что делает">
              <Picker selection={draft.kind} onSelectionChange={(value) => setKind(String(value))} modifiers={[pickerStyle('segmented')]}>
                <Text modifiers={[tag('text')]}>Отвечает текстом</Text>
                <Text modifiers={[tag('mention')]}>Отмечает людей</Text>
              </Picker>
            </Section>
          ) : null}

          {draft.kind === 'mention' && !builtin ? (
            <Section title="Кого отметить" footer={<Text>Бот знает тех, кого видел в чате. С правами администратора он видит всех, кто пишет.</Text>}>
              <Picker selection={draft.audience ?? 'all'} onSelectionChange={(value) => patch({ audience: value as MentionAudience })} modifiers={[pickerStyle('inline')]}>
                {AUDIENCES.map((key) => (
                  <Text key={key} modifiers={[tag(key)]}>
                    {AUDIENCE_INFO[key]}
                  </Text>
                ))}
              </Picker>
            </Section>
          ) : null}

          {callable ? (
            <Section title={draft.kind === 'text' ? 'Ответ бота' : 'Заголовок над отметками'}>
              <FieldRow
                value={draft.text ?? ''}
                placeholder={draft.kind === 'text' ? 'Пятница 20:00 — спортивная, суббота 19:00 — городская' : '📣 Участники:'}
                multiline
                maxLength={2000}
                onChange={(text) => patch({ text })}
              />
            </Section>
          ) : null}

          {callable ? (
            <Section title="Кто может вызвать" footer={<Text>«Как в чате» — по общей настройке команд этого чата.</Text>}>
              <Picker selection={access} onSelectionChange={(value) => patch({ access: value === 'chat' ? undefined : (value as CommandAccess) })} modifiers={[pickerStyle('segmented')]}>
                <Text modifiers={[tag('chat')]}>Как в чате</Text>
                <Text modifiers={[tag('admins')]}>Админы</Text>
                <Text modifiers={[tag('everyone')]}>Все</Text>
              </Picker>
            </Section>
          ) : null}

          {original && !builtin ? (
            <Section>
              <ActionRow title="Удалить команду" icon="trash" destructive onPress={remove} />
            </Section>
          ) : null}
        </Form>
      </FormHost>
    </>
  );
}
